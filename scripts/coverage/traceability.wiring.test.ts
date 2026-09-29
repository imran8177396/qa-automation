import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths';

/**
 * Static wiring: run-coverage writes test-case-trace beside the screen matrix.
 * Does not execute coverage or invent PASS/example ids.
 */
test('run-coverage imports buildTestCaseTraces and writes testCaseTraceFile', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'coverage', 'run-coverage.ts'), 'utf8');
  assert.match(src, /from\s*['"]\.\.\/planning\/traceability['"]/);
  assert.match(src, /buildTestCaseTraces\s*\(/);
  assert.match(src, /PATHS\.testCaseTraceFile/);
  assert.match(src, /writeJson\s*\(\s*PATHS\.testCaseTraceFile/);
  assert.doesNotMatch(src, /SCREEN-004/);
  assert.doesNotMatch(src, /ELEMENT-007/);
  assert.doesNotMatch(src, /email-input/);
  assert.doesNotMatch(src, /RESULT=PASS/);
});

test('run-coverage dedupes planned checks into unique-test-cases and unique matrix/traces', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'coverage', 'run-coverage.ts'), 'utf8');
  assert.match(src, /from\s*['"]\.\.\/planning\/test-case-uniqueness['"]/);
  assert.match(src, /deduplicateTestCases\s*\(/);
  assert.match(src, /PATHS\.uniqueTestCasesFile/);
  assert.match(src, /writeJson\s*\(\s*PATHS\.uniqueTestCasesFile/);
  assert.match(src, /uniquePlannedChecks/);
  assert.match(src, /rawPlannedChecksRetained:\s*true/);
  assert.doesNotMatch(src, /saucedemo|swag.?labs/i);
});

test('paths defines testCaseTraceFile and uniqueTestCasesFile under reports/coverage', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'paths.ts'), 'utf8');
  assert.match(src, /testCaseTraceFile:\s*path\.join\(ROOT,\s*'reports',\s*'coverage',\s*'test-case-trace\.json'\)/);
  assert.match(
    src,
    /uniqueTestCasesFile:\s*path\.join\(ROOT,\s*'reports',\s*'coverage',\s*'unique-test-cases\.json'\)/
  );
  assert.match(
    src,
    /completenessReportFile:\s*path\.join\(ROOT,\s*'reports',\s*'coverage',\s*'completeness-report\.json'\)/
  );
  assert.match(
    src,
    /completenessReportDoc:\s*path\.join\(ROOT,\s*'reports',\s*'coverage',\s*'completeness-report\.txt'\)/
  );
});

test('run-coverage writes completeness report from unique cases when planned-checks exist', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'coverage', 'run-coverage.ts'), 'utf8');
  assert.match(src, /from\s*['"]\.\/completeness-report['"]/);
  assert.match(src, /buildCompletenessReport\s*\(/);
  assert.match(src, /renderCompletenessReport\s*\(/);
  assert.match(src, /PATHS\.completenessReportFile/);
  assert.match(src, /PATHS\.completenessReportDoc/);
  assert.match(src, /generatedTestCases:\s*uniqueCases\.length/);
  assert.match(src, /rawGeneratedTestCases:\s*plannedChecks\.length/);
  assert.doesNotMatch(src, /\b4382\b/);
  assert.doesNotMatch(src, /ELEMENT-093|SCREEN-027/);
  assert.doesNotMatch(src, /saucedemo|swag.?labs/i);
});

test('run-coverage writes coverage-separation from real inputs only', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'coverage', 'run-coverage.ts'), 'utf8');
  assert.match(src, /from\s*['"]\.\/coverage-separation['"]/);
  assert.match(src, /buildCoverageSeparation\s*\(/);
  assert.match(src, /PATHS\.coverageSeparationFile/);
  assert.match(src, /knownScreenCount:\s*null/);
  assert.match(src, /requirementCount:\s*null/);
  assert.doesNotMatch(src, /knownScreenCount:\s*completeness\.discoveredScreens/);
  assert.doesNotMatch(src, /knownScreenCount:\s*screensForMatrix\.length/);
  assert.doesNotMatch(src, /\b98\b/);
  assert.doesNotMatch(src, /\b92\b/);
  assert.doesNotMatch(src, /\b87\b/);
  assert.doesNotMatch(src, /qualityScore/);
});

test('paths defines coverageSeparationFile under reports/coverage', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'paths.ts'), 'utf8');
  assert.match(
    src,
    /coverageSeparationFile:\s*path\.join\(ROOT,\s*'reports',\s*'coverage',\s*'coverage-separation\.json'\)/
  );
});
