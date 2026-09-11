import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import type { ClassifiedFailure, FailureClass } from '../failures/types';
import { isRetestCandidate, selectRetestCandidates, RETEST_SELECTABLE_CLASSES } from './select';

function classified(classification: FailureClass, id = 'PW-0001'): ClassifiedFailure {
  return {
    id,
    testId: `tests/e2e/example.spec.ts::${id}::chromium`,
    source: 'e2e',
    title: id,
    classification,
    ruleFired: 'INSUFFICIENT_EVIDENCE',
    evidenceExcerpt: NOT_AVAILABLE,
    confidence: 'low',
    rationale: 'test fixture',
    evidence: {
      id,
      source: 'e2e',
      title: id,
      testId: `tests/e2e/example.spec.ts::${id}::chromium`,
      specFile: 'tests/e2e/example.spec.ts',
      projectName: 'chromium',
      errorMessage: NOT_AVAILABLE,
      stackTrace: NOT_AVAILABLE,
      durationMs: NOT_AVAILABLE,
      retryCount: 0,
      attemptStatuses: ['failed'],
      screenshotPath: null,
      screenshotPresent: false,
      tracePath: null,
      videoPath: null,
    },
  };
}

describe('retest selection', () => {
  it('selects FLAKY and NAVIGATION_TIMEOUT only', () => {
    assert.deepEqual([...RETEST_SELECTABLE_CLASSES], ['FLAKY', 'NAVIGATION_TIMEOUT']);
    assert.equal(isRetestCandidate('FLAKY'), true);
    assert.equal(isRetestCandidate('NAVIGATION_TIMEOUT'), true);
    assert.equal(isRetestCandidate('ELEMENT_TIMEOUT'), false);
    assert.equal(isRetestCandidate('ASSERTION_FAILURE'), false);
    assert.equal(isRetestCandidate('UNKNOWN'), false);
  });

  it('with --automation-only selects only FLAKY', () => {
    assert.equal(isRetestCandidate('FLAKY', { automationOnly: true }), true);
    assert.equal(isRetestCandidate('NAVIGATION_TIMEOUT', { automationOnly: true }), false);
  });

  it('partitions classified failures into selected and not selected', () => {
    const { selected, notSelected } = selectRetestCandidates([
      classified('FLAKY', 'A'),
      classified('NAVIGATION_TIMEOUT', 'B'),
      classified('ASSERTION_FAILURE', 'C'),
      classified('ELEMENT_TIMEOUT', 'D'),
    ]);
    assert.deepEqual(
      selected.map((row) => row.id),
      ['A', 'B']
    );
    assert.deepEqual(
      notSelected.map((row) => row.id),
      ['C', 'D']
    );
  });
});
