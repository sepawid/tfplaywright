// Tests for scripts/verify_test_results.js (node:test, run in this repository's CI).
// Risk protected: a skipped or failed live step being reported as success, or the gate
// pointing at the skips instead of the failure that caused them (serial mode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify_test_results.js');

function run(xml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
  if (xml !== null) {
    fs.mkdirSync(path.join(dir, 'playwright-report'));
    fs.writeFileSync(path.join(dir, 'playwright-report', 'results.xml'), xml);
  }
  try {
    const stdout = execFileSync('node', [script], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

const suite = (tests, failures, skipped) =>
  `<testsuites tests="${tests}" failures="${failures}" errors="0" skipped="${skipped}"></testsuites>`;

test('all passed', () => {
  const result = run(suite(10, 0, 0));
  assert.equal(result.code, 0);
  assert.match(result.stdout, /\[GATE SUCCESS\]/);
});

test('serial run: the failure is reported before the skips it caused', () => {
  const result = run(suite(10, 1, 7));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\[QUALITY GATE FAILED\] Test run had 1 failure/);
  assert.match(result.stderr, /7 skipped test\(s\): in serial mode/);
  assert.doesNotMatch(result.stderr, /\[SECURITY \/ QUALITY GATE FAILED\]/);
});

test('skips alone fail the gate (skip != pass)', () => {
  const result = run(suite(10, 0, 1));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Detected 1 skipped test\(s\)/);
});

test('empty suite and missing report fail', () => {
  assert.equal(run(suite(0, 0, 0)).code, 1);
  assert.equal(run(null).code, 1);
});
