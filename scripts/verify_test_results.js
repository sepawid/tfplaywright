#!/usr/bin/env node
/**
 * Test Results Verifier (AUTO-007 Quality Gate)
 *
 * Enforces strict test outcome policy:
 * 1. Reads JUnit XML report (playwright-report/results.xml).
 * 2. Parses total tests, passes, failures, errors, and skips.
 * 3. Invariant: Skipped tests are NEVER reported as passed (skip != pass).
 *    Any skipped test fails the gate with exit code 1.
 * 4. Invariant: At least one test must have executed (empty suite fails).
 * 5. Invariant: Failures or errors fail the gate with exit code 1.
 */

import fs from 'fs';
import path from 'path';

const reportPath = path.resolve(process.cwd(), 'playwright-report/results.xml');

function parseJUnitXml(xmlContent) {
  // Extract testsuites summary attributes
  const testsuitesMatch = xmlContent.match(/<testsuites\b([^>]*)>/i);
  let totalTests = 0;
  let totalFailures = 0;
  let totalErrors = 0;
  let totalSkipped = 0;

  if (testsuitesMatch) {
    const attrs = testsuitesMatch[1];
    const testsAttr = attrs.match(/tests="(\d+)"/i);
    const failuresAttr = attrs.match(/failures="(\d+)"/i);
    const errorsAttr = attrs.match(/errors="(\d+)"/i);
    const skippedAttr = attrs.match(/skipped="(\d+)"/i);

    if (testsAttr) totalTests = parseInt(testsAttr[1], 10);
    if (failuresAttr) totalFailures = parseInt(failuresAttr[1], 10);
    if (errorsAttr) totalErrors = parseInt(errorsAttr[1], 10);
    if (skippedAttr) totalSkipped = parseInt(skippedAttr[1], 10);
  } else {
    // Fallback: search individual testsuite elements
    const suiteMatches = xmlContent.matchAll(/<testsuite\b([^>]*)>/gi);
    for (const match of suiteMatches) {
      const attrs = match[1];
      const testsAttr = attrs.match(/tests="(\d+)"/i);
      const failuresAttr = attrs.match(/failures="(\d+)"/i);
      const errorsAttr = attrs.match(/errors="(\d+)"/i);
      const skippedAttr = attrs.match(/skipped="(\d+)"/i);

      if (testsAttr) totalTests += parseInt(testsAttr[1], 10);
      if (failuresAttr) totalFailures += parseInt(failuresAttr[1], 10);
      if (errorsAttr) totalErrors += parseInt(errorsAttr[1], 10);
      if (skippedAttr) totalSkipped += parseInt(skippedAttr[1], 10);
    }
  }

  // Count explicit <skipped> and <failure> tags as secondary validation
  const explicitSkippedTags = (xmlContent.match(/<skipped\b/gi) || []).length;
  const explicitFailureTags = (xmlContent.match(/<failure\b/gi) || []).length;
  const explicitErrorTags = (xmlContent.match(/<error\b/gi) || []).length;

  const resolvedSkipped = Math.max(totalSkipped, explicitSkippedTags);
  const resolvedFailures = Math.max(totalFailures, explicitFailureTags);
  const resolvedErrors = Math.max(totalErrors, explicitErrorTags);
  const passed = Math.max(0, totalTests - resolvedFailures - resolvedErrors - resolvedSkipped);

  return {
    total: totalTests,
    passed,
    skipped: resolvedSkipped,
    failures: resolvedFailures,
    errors: resolvedErrors,
  };
}

function main() {
  console.log('=== [AUTO-007 QUALITY GATE] Test Results Verification ===');

  if (!fs.existsSync(reportPath)) {
    console.error(`[GATE FAILURE] Report file not found at: ${reportPath}`);
    console.error('Playwright execution did not generate a JUnit results.xml report.');
    process.exit(1);
  }

  const xmlContent = fs.readFileSync(reportPath, 'utf-8');
  const results = parseJUnitXml(xmlContent);

  console.log(`Total tests recorded: ${results.total}`);
  console.log(`Passed:               ${results.passed}`);
  console.log(`Skipped:              ${results.skipped}`);
  console.log(`Failures:             ${results.failures}`);
  console.log(`Errors:               ${results.errors}`);

  if (results.total === 0) {
    console.error('[GATE FAILURE] No tests were recorded in results.xml! Test suite was empty or failed before launch.');
    process.exit(1);
  }

  // Invariant: skipped tests are NEVER reported as passed (skip != pass)
  if (results.skipped > 0) {
    console.error(`\n[SECURITY / QUALITY GATE FAILED] Detected ${results.skipped} skipped test(s)!`);
    console.error('RULE ENFORCEMENT: In this repository, skipped tests are NEVER reported as passed (skip != pass).');
    console.error('A skip indicates an unexecuted assertion, missing secret, or bypassed security check.');
    process.exit(1);
  }

  if (results.failures > 0 || results.errors > 0) {
    console.error(`\n[QUALITY GATE FAILED] Test run had ${results.failures} failure(s) and ${results.errors} error(s).`);
    process.exit(1);
  }

  console.log(`\n[GATE SUCCESS] All ${results.total} test(s) passed successfully with 0 skipped and 0 failures.`);
  process.exit(0);
}

main();
