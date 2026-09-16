import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import type { ClassifiedFailure, FailureClass, OwnerFailureClass } from '../failures/types';
import { isRetestCandidate, selectRetestCandidates, RETEST_SELECTABLE_CLASSES } from './select';

function classified(
  classification: FailureClass,
  id = 'PW-0001',
  owner: OwnerFailureClass = 'APPLICATION'
): ClassifiedFailure {
  return {
    id,
    testId: `tests/e2e/example.spec.ts::${id}::chromium`,
    source: 'e2e',
    title: id,
    classification,
    ownerClassification: owner,
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
  it('selects every classified failure by default (owner-aware, not FLAKY-only)', () => {
    assert.deepEqual([...RETEST_SELECTABLE_CLASSES], ['FLAKY']);
    assert.equal(isRetestCandidate('FLAKY'), true);
    assert.equal(isRetestCandidate('NAVIGATION_TIMEOUT'), true);
    assert.equal(isRetestCandidate('ELEMENT_TIMEOUT'), true);
    assert.equal(isRetestCandidate('ASSERTION_FAILURE'), true);
    assert.equal(isRetestCandidate(classified('ASSERTION_FAILURE', 'A', 'APPLICATION')), true);
    assert.equal(isRetestCandidate(classified('NAVIGATION_TIMEOUT', 'B', 'BROWSER')), true);
  });

  it('with --automation-only selects AUTOMATION owner or FLAKY mechanism only', () => {
    assert.equal(isRetestCandidate('FLAKY', { automationOnly: true }), true);
    assert.equal(isRetestCandidate('NAVIGATION_TIMEOUT', { automationOnly: true }), false);
    assert.equal(
      isRetestCandidate(classified('ELEMENT_TIMEOUT', 'AUTO', 'AUTOMATION'), { automationOnly: true }),
      true
    );
    assert.equal(
      isRetestCandidate(classified('ASSERTION_FAILURE', 'APP', 'APPLICATION'), { automationOnly: true }),
      false
    );
    assert.equal(
      isRetestCandidate(classified('NAVIGATION_TIMEOUT', 'BR', 'BROWSER'), { automationOnly: true }),
      false
    );
  });

  it('does not select heavy JMeter/performance sources', () => {
    const jmeter = classified('ASSERTION_FAILURE', 'J1');
    jmeter.source = 'jmeter';
    assert.equal(isRetestCandidate(jmeter), false);
  });

  it('partitions classified failures and honors --source', () => {
    const { selected, notSelected } = selectRetestCandidates([
      classified('FLAKY', 'A', 'AUTOMATION'),
      classified('NAVIGATION_TIMEOUT', 'B', 'BROWSER'),
      classified('ASSERTION_FAILURE', 'C', 'APPLICATION'),
    ]);
    assert.deepEqual(
      selected.map((row) => row.id),
      ['A', 'B', 'C']
    );
    assert.deepEqual(
      notSelected.map((row) => row.id),
      []
    );

    const scoped = selectRetestCandidates(
      [
        { ...classified('ASSERTION_FAILURE', 'S1'), source: 'security' },
        { ...classified('ASSERTION_FAILURE', 'E1'), source: 'seo' },
      ],
      { source: 'security' }
    );
    assert.deepEqual(
      scoped.selected.map((row) => row.id),
      ['S1']
    );
    assert.deepEqual(
      scoped.notSelected.map((row) => row.id),
      ['E1']
    );
  });
});
