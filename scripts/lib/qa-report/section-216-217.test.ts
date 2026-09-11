import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOT_AVAILABLE } from '../suite-origin';
import type { FailureAnalysisSection216, FailureAnalysisSummary } from '../../failures/types';
import type { RetestSection217, RetestSummary } from '../../retest/types';
import {
  mapFailureAnalysisRows,
  mapRetestRows,
  stabilityVerdictForStatuses,
} from './load-section-artifacts';

test('2.16 maps section-2.16 rows and does not invent confidence or tickets', () => {
  const section: FailureAnalysisSection216 = {
    section: '2.16',
    title: 'Failure Analysis',
    metadata: {
      evidenceBased: true,
      classificationsAreDefectTickets: false,
      note: 'Classifications are evidence-based and are not defect tickets.',
    },
    disclaimer: 'Classifications are evidence-based and are not defect tickets.',
    byClass: {
      ASSERTION_FAILURE: 1,
      NAVIGATION_TIMEOUT: 0,
      ELEMENT_TIMEOUT: 0,
      NETWORK_ERROR: 0,
      CONSOLE_ERROR: 0,
      ENVIRONMENT: 0,
      FLAKY: 0,
      UNKNOWN: 0,
    },
    rows: [
      {
        testId: 'spec.ts › login fails',
        classification: 'ASSERTION_FAILURE',
        evidenceExcerpt: 'Expected 200 received 404',
        ruleFired: 'ERROR_TEXT_ASSERTION',
        title: 'login fails',
        source: 'generated-check',
      },
    ],
  };

  const rows = mapFailureAnalysisRows(section, null);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'classification',
    'evidenceExcerpt',
    'ruleFired',
    'testId',
  ]);
  assert.equal(rows[0].testId, 'spec.ts › login fails');
  assert.equal(rows[0].classification, 'ASSERTION_FAILURE');
  assert.equal(rows[0].evidenceExcerpt, 'Expected 200 received 404');
  assert.equal(rows[0].ruleFired, 'ERROR_TEXT_ASSERTION');
});

test('2.16 falls back to summary findings[] without confidence or recommendation columns', () => {
  const summary = {
    findings: [
      {
        testId: 'home.spec.ts › banner',
        classification: 'ELEMENT_TIMEOUT',
        evidenceExcerpt: 'locator.click: Timeout',
        ruleFired: 'ERROR_TEXT_ELEMENT_TIMEOUT',
        confidence: 'high',
        recommendation: 'do not invent this',
        id: 'legacy-id',
        title: 'banner',
        source: 'e2e',
        reason: 'timeout',
      },
    ],
  } as FailureAnalysisSummary;

  const rows = mapFailureAnalysisRows(null, summary);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].testId, 'home.spec.ts › banner');
  assert.equal(rows[0].classification, 'ELEMENT_TIMEOUT');
  assert.equal(rows[0].ruleFired, 'ERROR_TEXT_ELEMENT_TIMEOUT');
  assert.equal('confidence' in rows[0], false);
  assert.equal('recommendation' in rows[0], false);
});

test('2.16 missing artifacts map to an empty row set for NOT_AVAILABLE rendering', () => {
  assert.deepEqual(mapFailureAnalysisRows(null, null), []);
});

test('2.17 maps originalStatus, retestStatus, runCount, stabilityVerdict', () => {
  const section: RetestSection217 = {
    section: '2.17',
    title: 'Retest',
    status: 'PASS',
    reason: 'Retest recorded against original FAIL evidence.',
    rows: [
      {
        testId: 'flaky.spec.ts › intermittent',
        originalStatus: 'FAIL',
        retestStatus: 'PASS',
        runCount: 2,
        stabilityVerdict: 'FAIL → PASS (unstable)',
        title: 'intermittent',
        classification: 'FLAKY',
      },
    ],
  };

  const rows = mapRetestRows(section, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].originalStatus, 'FAIL');
  assert.equal(rows[0].retestStatus, 'PASS');
  assert.equal(rows[0].runCount, 2);
  assert.equal(rows[0].stabilityVerdict, 'FAIL → PASS (unstable)');
});

test('2.17 retest PASS always renders FAIL → PASS (unstable) and never drops original FAIL', () => {
  const rows = mapRetestRows(
    {
      section: '2.17',
      title: 'Retest',
      status: 'PASS',
      reason: '',
      rows: [
        {
          testId: 'nav.spec.ts › timeout',
          originalStatus: 'FAIL',
          retestStatus: 'PASS',
          runCount: 2,
          stabilityVerdict: 'PASS' as RetestSection217['rows'][number]['stabilityVerdict'],
          title: 'timeout',
          classification: 'NAVIGATION_TIMEOUT',
        },
      ],
    },
    null
  );
  assert.equal(rows[0].originalStatus, 'FAIL');
  assert.equal(rows[0].stabilityVerdict, 'FAIL → PASS (unstable)');
});

test('2.17 missing runCount is NOT_AVAILABLE, not a fabricated zero', () => {
  const summary = {
    items: [
      {
        testId: 'a.spec.ts › x',
        originalStatus: 'FAIL',
        retestStatus: 'NOT_EXECUTED',
        finalStatus: 'NOT_EXECUTED',
        stabilityVerdict: 'FAIL → NOT_EXECUTED',
      },
    ],
  } as unknown as RetestSummary;

  const rows = mapRetestRows(null, summary);
  assert.equal(rows[0].runCount, NOT_AVAILABLE);
  assert.equal(rows[0].stabilityVerdict, 'FAIL → NOT_EXECUTED');
});

test('stability verdict mapping does not invent a PASS', () => {
  assert.equal(stabilityVerdictForStatuses('FAIL', 'PASS'), 'FAIL → PASS (unstable)');
  assert.equal(stabilityVerdictForStatuses('FAIL', 'FAIL'), 'FAIL → FAIL (reproduced)');
  assert.equal(stabilityVerdictForStatuses('FAIL', 'NOT_EXECUTED'), 'FAIL → NOT_EXECUTED');
});
