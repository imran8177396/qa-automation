import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths';
import {
  buildCompletenessReport,
  renderCompletenessReport,
} from './completeness-report';

test('excluded REQUIRES_CONFIGURATION screen + testable screen with case', () => {
  const report = buildCompletenessReport({
    screens: [
      {
        screenId: 'SCREEN-A',
        excluded: true,
        exclusionStatus: 'REQUIRES_CONFIGURATION',
        exclusionReason: 'Requires unavailable authentication configuration.',
      },
      { screenId: 'SCREEN-B' },
    ],
    elements: [],
    testCaseScreenIds: ['SCREEN-B'],
    testCaseElementIds: [],
    generatedTestCases: 1,
  });

  assert.equal(report.discoveredScreens, 2);
  assert.equal(report.testableScreens, 1);
  assert.equal(report.excludedScreens, 1);
  assert.equal(report.screensWithoutTestCases, 0);

  const excludedGap = report.gaps.find((g) => g.id === 'SCREEN-A');
  assert.ok(excludedGap);
  assert.equal(excludedGap!.kind, 'screen');
  assert.equal(excludedGap!.status, 'REQUIRES_CONFIGURATION');
  assert.equal(excludedGap!.reason, 'Requires unavailable authentication configuration.');
  assert.ok(!report.gaps.some((g) => g.id === 'SCREEN-B'));
});

test('decorative + testable with case + testable without case', () => {
  const report = buildCompletenessReport({
    screens: [{ screenId: 'SCREEN-1' }],
    elements: [
      { elementId: 'EL-DECOR', screenId: 'SCREEN-1', decorative: true },
      { elementId: 'EL-OK', screenId: 'SCREEN-1' },
      { elementId: 'EL-MISS', screenId: 'SCREEN-1' },
    ],
    testCaseScreenIds: ['SCREEN-1'],
    testCaseElementIds: ['EL-OK'],
    generatedTestCases: 1,
  });

  assert.equal(report.discoveredElements, 3);
  assert.equal(report.testableElements, 2);
  assert.equal(report.nonTestableElements, 1);
  assert.equal(report.testableElementsWithoutTestCases, 1);

  const decorativeGap = report.gaps.find((g) => g.id === 'EL-DECOR');
  assert.ok(decorativeGap);
  assert.equal(decorativeGap!.status, 'NOT_APPLICABLE');
  assert.match(decorativeGap!.reason, /Decorative/i);

  const missGap = report.gaps.find((g) => g.id === 'EL-MISS');
  assert.ok(missGap, 'testable element without a case must appear in gaps — no silent drop');
  assert.equal(missGap!.status, 'NOT_TESTED');
  assert.equal(missGap!.reason, 'no test case was generated for this element');

  assert.ok(!report.gaps.some((g) => g.id === 'EL-OK'));
});

test('empty input → all zeros and empty gaps', () => {
  const report = buildCompletenessReport({
    screens: [],
    elements: [],
    testCaseScreenIds: [],
    testCaseElementIds: [],
    generatedTestCases: 0,
  });

  assert.equal(report.discoveredScreens, 0);
  assert.equal(report.testableScreens, 0);
  assert.equal(report.excludedScreens, 0);
  assert.equal(report.discoveredElements, 0);
  assert.equal(report.testableElements, 0);
  assert.equal(report.nonTestableElements, 0);
  assert.equal(report.generatedTestCases, 0);
  assert.equal(report.screensWithoutTestCases, 0);
  assert.equal(report.testableElementsWithoutTestCases, 0);
  assert.deepEqual(report.gaps, []);

  const text = renderCompletenessReport(report);
  assert.match(text, /DISCOVERED SCREENS: 0/);
  assert.match(text, /GENERATED TEST CASES: 0/);
  assert.doesNotMatch(text, /4382/);
  assert.doesNotMatch(text, /ELEMENT-093/);
  assert.doesNotMatch(text, /SCREEN-027/);
  assert.doesNotMatch(text, /\b42\b/);
  assert.doesNotMatch(text, /\b684\b/);
});

test('invariant: testable element absent from cases must appear in gaps', () => {
  const report = buildCompletenessReport({
    screens: [{ screenId: 'S1' }],
    elements: [{ elementId: 'MISSING-EL', screenId: 'S1' }],
    testCaseScreenIds: ['S1'],
    testCaseElementIds: [],
    generatedTestCases: 0,
  });

  assert.equal(report.testableElementsWithoutTestCases, 1);
  assert.ok(
    report.gaps.some((g) => g.kind === 'element' && g.id === 'MISSING-EL' && g.status === 'NOT_TESTED')
  );
});

test('excluded/decorative gaps remain when without-case counters are zero', () => {
  const report = buildCompletenessReport({
    screens: [
      {
        screenId: 'S-EX',
        exclusionStatus: 'BLOCKED',
        exclusionReason: 'safety policy blocked this screen',
      },
      { screenId: 'S-OK' },
    ],
    elements: [
      { elementId: 'E-DECOR', screenId: 'S-OK', decorative: true },
      { elementId: 'E-OK', screenId: 'S-OK' },
    ],
    testCaseScreenIds: ['S-OK'],
    testCaseElementIds: ['E-OK'],
    generatedTestCases: 1,
  });

  assert.equal(report.screensWithoutTestCases, 0);
  assert.equal(report.testableElementsWithoutTestCases, 0);
  assert.ok(report.gaps.some((g) => g.id === 'S-EX'));
  assert.ok(report.gaps.some((g) => g.id === 'E-DECOR'));
});

test('renderer labels match user vocabulary; no demo hosts', () => {
  const report = buildCompletenessReport({
    screens: [{ screenId: 'S1' }],
    elements: [{ elementId: 'E1', screenId: 'S1', decorative: true }],
    testCaseScreenIds: [],
    testCaseElementIds: [],
    generatedTestCases: 0,
    rawGeneratedTestCases: 0,
  });
  const text = renderCompletenessReport(report);
  assert.match(text, /DISCOVERED SCREENS:/);
  assert.match(text, /TESTABLE SCREENS:/);
  assert.match(text, /EXCLUDED SCREENS:/);
  assert.match(text, /DISCOVERED ELEMENTS:/);
  assert.match(text, /TESTABLE ELEMENTS:/);
  assert.match(text, /NON-TESTABLE ELEMENTS:/);
  assert.match(text, /GENERATED TEST CASES:/);
  assert.match(text, /SCREENS WITHOUT TEST CASES:/);
  assert.match(text, /TESTABLE ELEMENTS WITHOUT TEST CASES:/);
  assert.doesNotMatch(text, /saucedemo|swag.?labs|example\.com/i);
});

test('source must not hard-code example totals 42 / 684 / 4382', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'coverage', 'completeness-report.ts'), 'utf8');
  assert.doesNotMatch(src, /\b4382\b/);
  assert.doesNotMatch(src, /\b684\b/);
  // Allow "42" only inside non-literal contexts; ban the demo triple as literals.
  assert.doesNotMatch(src, /discoveredScreens:\s*42|generatedTestCases:\s*4382|discoveredElements:\s*684/);
  assert.doesNotMatch(src, /ELEMENT-093|SCREEN-027/);
});
