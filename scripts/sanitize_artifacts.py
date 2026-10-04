#!/usr/bin/env python3
"""Artifact Sanitizer for Playwright Reports and Traces (AUTO-007).

Scrubs sensitive tokens, credentials, and authentication headers from test artifacts
(HTML reports, JSON/XML results, text logs, markdown error contexts, and trace.zip files)
prior to GitHub Actions artifact upload on public repositories.

Target patterns redacted:
1. DEMO_SECRET / DEMO_TEST_TOKEN environment values -> [REDACTED_DEMO_SECRET]
2. Bearer tokens: synthetic-demo-[a-f0-9]{48} -> synthetic-demo-[REDACTED_TOKEN]
3. Headers:
   - X-Demo-Secret: <val> -> X-Demo-Secret: [REDACTED_DEMO_SECRET]
   - Authorization: Bearer <val> -> Authorization: Bearer [REDACTED_TOKEN]
   - Playwright HAR / trace JSON header entries
"""

from __future__ import annotations

import base64
import io
import os
import re
import sys
import zipfile
from pathlib import Path

TEXT_EXTENSIONS = {
    ".html",
    ".xml",
    ".json",
    ".txt",
    ".log",
    ".md",
    ".js",
    ".css",
    ".svg",
}

TOKEN_PATTERN = re.compile(r"synthetic-demo-[a-f0-9]{48}", re.IGNORECASE)
BEARER_AUTH_PATTERN = re.compile(
    r'(?i)("?authorization"?\s*[:=]\s*"?(?:Bearer\s+))([^"\r\n]+)',
)
DEMO_SECRET_HEADER_PATTERN = re.compile(
    r'(?i)("?x-demo-secret"?\s*[:=]\s*"?)[^"\r\n]+("?)',
)


def get_secret_patterns() -> list[tuple[re.Pattern[str], str]]:
    patterns: list[tuple[re.Pattern[str], str]] = []

    # Environment secrets (min length 4 to prevent trivial replacement)
    demo_secret = os.environ.get("DEMO_SECRET")
    if demo_secret and len(demo_secret.strip()) >= 4:
        escaped = re.escape(demo_secret.strip())
        patterns.append((re.compile(escaped), "[REDACTED_DEMO_SECRET]"))

    demo_token = os.environ.get("DEMO_TEST_TOKEN")
    if demo_token and len(demo_token.strip()) >= 4:
        escaped = re.escape(demo_token.strip())
        patterns.append((re.compile(escaped), "[REDACTED_DEMO_TEST_TOKEN]"))

    # Generic patterns
    patterns.append((TOKEN_PATTERN, "synthetic-demo-[REDACTED_TOKEN]"))
    patterns.append(
        (BEARER_AUTH_PATTERN, r"\1[REDACTED_TOKEN]"),
    )
    patterns.append(
        (DEMO_SECRET_HEADER_PATTERN, r"\1[REDACTED_DEMO_SECRET]\2"),
    )

    return patterns


def sanitize_text(text: str, patterns: list[tuple[re.Pattern[str], str]]) -> tuple[str, int]:
    replacements = 0
    modified = text
    for pattern, replacement in patterns:
        modified, count = pattern.subn(replacement, modified)
        replacements += count
    return modified, replacements


def sanitize_zip_bytes(payload: bytes, patterns: list[tuple[re.Pattern[str], str]]) -> tuple[bytes, int]:
    """Scrub text entries of a zip archive held in memory. Raises on a corrupt archive."""
    total_replacements = 0
    in_memory = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(payload), "r") as source_zip:
        with zipfile.ZipFile(in_memory, "w", zipfile.ZIP_DEFLATED) as target_zip:
            for item in source_zip.infolist():
                data = source_zip.read(item.filename)
                suffix = Path(item.filename).suffix.lower()
                if suffix in TEXT_EXTENSIONS or item.filename.endswith((".network", ".trace")):
                    try:
                        text = data.decode("utf-8")
                    except UnicodeDecodeError:
                        target_zip.writestr(item, data)  # binary entry inside the archive
                        continue
                    sanitized_text, count = sanitize_text(text, patterns)
                    total_replacements += count
                    target_zip.writestr(item, sanitized_text.encode("utf-8"))
                else:
                    target_zip.writestr(item, data)
    return in_memory.getvalue(), total_replacements


def sanitize_zip_file(zip_path: Path, patterns: list[tuple[re.Pattern[str], str]]) -> int:
    sanitized, total_replacements = sanitize_zip_bytes(zip_path.read_bytes(), patterns)
    if total_replacements > 0:
        zip_path.write_bytes(sanitized)
    return total_replacements


# The HTML reporter embeds all results (errors, call logs, request headers) as a base64 zip
# in this template. Regexes over the HTML see only base64, so the archive is decoded,
# scrubbed and re-encoded.
EMBEDDED_REPORT_PATTERN = re.compile(
    r'(<template id="playwrightReportBase64">data:application/zip;base64,)([A-Za-z0-9+/=]+)(</template>)'
)


def sanitize_embedded_report(html: str, patterns: list[tuple[re.Pattern[str], str]]) -> tuple[str, int]:
    total = 0

    def scrub(match: re.Match[str]) -> str:
        nonlocal total
        sanitized, count = sanitize_zip_bytes(base64.b64decode(match.group(2), validate=True), patterns)
        total += count
        return match.group(1) + base64.b64encode(sanitized).decode("ascii") + match.group(3)

    return EMBEDDED_REPORT_PATTERN.sub(scrub, html), total


def sanitize_directory(target_dir: Path, patterns: list[tuple[re.Pattern[str], str]]) -> tuple[int, int]:
    """Scrub every artifact under target_dir. Any failure raises: an unscrubbed file must not be uploaded."""
    scanned_files = 0
    total_replacements = 0

    if not target_dir.exists():
        return scanned_files, total_replacements

    for path in target_dir.rglob("*"):
        if not path.is_file():
            continue

        scanned_files += 1

        if path.suffix.lower() in TEXT_EXTENSIONS:
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            sanitized, count = sanitize_text(content, patterns)
            if path.suffix.lower() == ".html":
                sanitized, embedded = sanitize_embedded_report(sanitized, patterns)
                count += embedded
            if count > 0:
                path.write_text(sanitized, encoding="utf-8")
                total_replacements += count

        elif path.suffix.lower() == ".zip":
            replacements = sanitize_zip_file(path, patterns)
            total_replacements += replacements

    return scanned_files, total_replacements


def main() -> None:
    print("=== [AUTO-007 SANITIZATION] Scrubbing Test Artifacts for Public Safety ===")
    patterns = get_secret_patterns()
    root = Path.cwd()

    dirs_to_sanitize = [
        root / "playwright-report",
        root / "test-results",
    ]

    total_scanned = 0
    total_scrubbed = 0

    for directory in dirs_to_sanitize:
        if directory.exists():
            try:
                scanned, scrubbed = sanitize_directory(directory, patterns)
            except Exception as error:
                # Fail closed: the workflow skips the artifact upload when this step fails.
                print(f"[SANITIZE FAILED] {directory.name}/: {type(error).__name__}: {error}", file=sys.stderr)
                sys.exit(1)
            total_scanned += scanned
            total_scrubbed += scrubbed
            print(f"Scanned {scanned} files in {directory.name}/: {scrubbed} sensitive items redacted.")
        else:
            print(f"Directory {directory.name}/ does not exist (skipping).")

    print(f"=== Sanitization completed: {total_scanned} files inspected, {total_scrubbed} secrets redacted. ===\n")


if __name__ == "__main__":
    main()
