"""Tests for scripts/sanitize_artifacts.py (stdlib unittest, run in this repository's CI).

Risk protected: a demo session token or DEMO_SECRET reaching a public artifact. The HTML
reporter stores results as a base64 zip inside the page, which plain regexes cannot see.
"""

from __future__ import annotations

import base64
import io
import os
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sanitize_artifacts as sa  # noqa: E402

TOKEN = "synthetic-demo-" + "a1" * 24
SECRET = "unit-test-demo-secret"  # synthetic value


def _embedded_report(entries: dict[str, str]) -> str:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    payload = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f'<html><body></body></html>\n<template id="playwrightReportBase64">data:application/zip;base64,{payload}</template>'


def _decoded_entries(html: str) -> dict[str, str]:
    match = re.search(r"base64,([A-Za-z0-9+/=]+)</template>", html)
    assert match
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(match.group(1)))) as archive:
        return {name: archive.read(name).decode("utf-8") for name in archive.namelist()}


class EmbeddedReportTest(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["DEMO_SECRET"] = SECRET
        self.patterns = sa.get_secret_patterns()

    def tearDown(self) -> None:
        os.environ.pop("DEMO_SECRET", None)

    def test_token_and_headers_inside_embedded_zip_are_scrubbed(self) -> None:
        html = _embedded_report(
            {
                "report.json": f'{{"error": "got {TOKEN}", "headers": {{"authorization": "Bearer {TOKEN}"}}}}',
                "calls.log": f"x-demo-secret: {SECRET}\n",
            }
        )
        sanitized, count = sa.sanitize_embedded_report(html, self.patterns)
        entries = _decoded_entries(sanitized)
        joined = "".join(entries.values())
        self.assertGreater(count, 0)
        self.assertNotIn(TOKEN, joined)
        self.assertNotIn(SECRET, joined)
        self.assertEqual(set(entries), {"report.json", "calls.log"})

    def test_corrupt_embedded_report_raises(self) -> None:
        html = '<template id="playwrightReportBase64">data:application/zip;base64,bm90LWEtemlw</template>'
        with self.assertRaises(zipfile.BadZipFile):
            sa.sanitize_embedded_report(html, self.patterns)

    def test_main_fails_closed_on_corrupt_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "playwright-report"
            report.mkdir()
            (report / "index.html").write_text(
                '<template id="playwrightReportBase64">data:application/zip;base64,bm90LWEtemlw</template>',
                encoding="utf-8",
            )
            script = Path(__file__).resolve().parent / "sanitize_artifacts.py"
            result = subprocess.run([sys.executable, str(script)], cwd=tmp, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("[SANITIZE FAILED]", result.stderr)

    def test_plain_html_without_embedded_report_is_unchanged(self) -> None:
        html = "<html><body>no report</body></html>"
        self.assertEqual(sa.sanitize_embedded_report(html, self.patterns), (html, 0))


if __name__ == "__main__":
    unittest.main()
