import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths';
import {
  assertNotGenerationEqualsCoverage,
  buildCoverageSeparation,
  renderCoverageSeparation,
} from './coverage-separation';

/** Example illustration numbers from the request — must never appear as hard-coded data. */
const EXAMPLE_QUARTET = [98, 92, 87] as const;

test('generated 10 executed 0, no known screens, no requirements, testable 4/4 → generation 100 only', () => {
  const report = buildCoverageSeparation({
    knownScreenCount: null,
    discoveredScreenCount: 4,
    testableElementCount: 4,
    testableElementsWithCase: 4,
    generatedCaseCount: 10,
    executedCaseCount: 0,
    passedCaseCount: 0,
    requirementCount: null,
    requirementsCovered: null,
  });

  assert.equal(report.testGeneration.status, 'MEASURED');
  assert.equal(report.testGeneration.percent, 100);
  assert.match(
    report.testGeneration.reason,
    /share of testable elements that have at least one generated case/
  );

  assert.equal(report.discovery.status, 'NOT_MEASURED');
  assert.equal(report.discovery.percent, null);

  assert.equal(report.execution.status, 'MEASURED');
  assert.equal(report.execution.percent, 0);
  assert.match(report.execution.reason, /no generated case has been executed/);

  assert.equal(report.passRate.status, 'NOT_MEASURED');
  assert.equal(report.passRate.percent, null);
  assert.match(report.passRate.reason, /pass rate is undefined until a case is executed/);

  assert.equal(report.requirement.status, 'NOT_MEASURED');
  assert.equal(report.requirement.percent, null);

  const json = JSON.stringify(report);
  for (const n of EXAMPLE_QUARTET) {
    assert.doesNotMatch(json, new RegExp(`\\b${n}\\b`));
  }
  // Generation 100 must not appear as discovery/execution/passRate/requirement percent.
  assert.equal(report.discovery.percent, null);
  assert.notEqual(report.execution.percent, 100);
  assert.equal(report.passRate.percent, null);
  assert.equal(report.requirement.percent, null);

  assertNotGenerationEqualsCoverage(report);
});

test('withCase === testable does not set discovery or execution to 100', () => {
  const report = buildCoverageSeparation({
    knownScreenCount: null,
    testableElementCount: 5,
    testableElementsWithCase: 5,
    generatedCaseCount: 12,
    executedCaseCount: 0,
  });

  assert.equal(report.testGeneration.percent, 100);
  assert.equal(report.discovery.status, 'NOT_MEASURED');
  assert.equal(report.discovery.percent, null);
  assert.equal(report.execution.percent, 0);
  assert.notEqual(report.execution.percent, 100);
  assertNotGenerationEqualsCoverage(report);
});

test('executed 4 passed 2 of generated 10 → execution 40, passRate 50 (not 20)', () => {
  const report = buildCoverageSeparation({
    generatedCaseCount: 10,
    executedCaseCount: 4,
    passedCaseCount: 2,
  });

  assert.equal(report.execution.status, 'MEASURED');
  assert.equal(report.execution.percent, 40);
  assert.equal(report.passRate.status, 'MEASURED');
  assert.equal(report.passRate.percent, 50);
  assert.notEqual(report.passRate.percent, 20);
  assert.notEqual(report.execution.percent, 20);
});

test('requirementCount absent → requirement NOT_MEASURED', () => {
  const report = buildCoverageSeparation({
    testableElementCount: 2,
    testableElementsWithCase: 1,
    generatedCaseCount: 3,
    executedCaseCount: 1,
    passedCaseCount: 1,
  });

  assert.equal(report.requirement.status, 'NOT_MEASURED');
  assert.equal(report.requirement.percent, null);
  assert.match(report.requirement.reason, /no requirements were supplied/);
});

test('known 10 discovered 8 → discovery 80', () => {
  const report = buildCoverageSeparation({
    knownScreenCount: 10,
    discoveredScreenCount: 8,
  });

  assert.equal(report.discovery.status, 'MEASURED');
  assert.equal(report.discovery.percent, 80);
});

test('discovered > known → discovery NOT_MEASURED', () => {
  const report = buildCoverageSeparation({
    knownScreenCount: 5,
    discoveredScreenCount: 9,
  });

  assert.equal(report.discovery.status, 'NOT_MEASURED');
  assert.equal(report.discovery.percent, null);
  assert.match(report.discovery.reason, /discovered count exceeds the known screen count/);
});

test('renderCoverageSeparation prints NOT_MEASURED without a fake 100%', () => {
  const report = buildCoverageSeparation({
    knownScreenCount: null,
    testableElementCount: 2,
    testableElementsWithCase: 1,
    generatedCaseCount: 5,
    executedCaseCount: 0,
  });
  const text = renderCoverageSeparation(report);

  assert.match(text, /Discovery Coverage: NOT_MEASURED/);
  assert.match(text, /Test Generation Coverage: 50%/);
  assert.match(text, /Execution Coverage: 0%/);
  assert.match(text, /Pass Rate: NOT_MEASURED/);
  assert.match(text, /Requirement Coverage: NOT_MEASURED/);
  assert.doesNotMatch(text, /Discovery Coverage: 100%/);
  assert.doesNotMatch(text, /Pass Rate: 100%/);
  assert.doesNotMatch(text, /Requirement Coverage: 100%/);
});

test('no quality score field on CoverageSeparation', () => {
  const report = buildCoverageSeparation({});
  assert.equal('qualityScore' in report, false);
  assert.equal('quality' in report, false);
  const keys = Object.keys(report).sort();
  assert.deepEqual(keys, [
    'discovery',
    'execution',
    'passRate',
    'requirement',
    'testGeneration',
  ]);
});

test('assertNotGenerationEqualsCoverage throws when another field copies generation percent', () => {
  const forged = buildCoverageSeparation({
    testableElementCount: 4,
    testableElementsWithCase: 4,
    generatedCaseCount: 10,
    executedCaseCount: 0,
  });
  // Illegally mirror generation 100 onto discovery with a different reason.
  forged.discovery = {
    status: 'MEASURED',
    percent: 100,
    reason: 'copied from generation',
  };
  assert.throws(() => assertNotGenerationEqualsCoverage(forged), /discovery must not reuse/);
});

test('source module has no hard-coded example quartet 100/98/92/87 as sample data', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'scripts', 'coverage', 'coverage-separation.ts'),
    'utf8'
  );
  assert.doesNotMatch(src, /\b98\b/);
  assert.doesNotMatch(src, /\b92\b/);
  assert.doesNotMatch(src, /\b87\b/);
  // Literal 100 may appear only as equality checks / rounding outcomes, not as example data rows.
  assert.doesNotMatch(src, /discovery:\s*100|execution:\s*100|passRate:\s*100|requirement:\s*100/);
  assert.doesNotMatch(src, /qualityScore|quality.?score/i);
});
