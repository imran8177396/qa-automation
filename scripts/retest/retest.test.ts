import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import type { ClassifiedFailure, FailureAnalysisSummary, FailureClass } from '../failures/types';
import { FAILURE_ANALYSIS_DISCLAIMER, FAILURE_ANALYSIS_LIMITATIONS, FAILURE_ANALYSIS_METADATA } from '../failures/types';
import { summarizeByClass } from '../failures/classify';
import { buildRetestFromAnalysis } from './build';
import type { RetestRunner } from './types';

function classified(classification: FailureClass, id: string): ClassifiedFailure {
  return {
    id,
    testId: `tests/e2e/home.spec.ts::${id}::chromium`,
    source: 'e2e',
    title: `test ${id}`,
    classification,
    ruleFired: classification === 'FLAKY' ? 'MIXED_RETRY_OUTCOMES' : 'TIMEOUT_NEAR_DURATION_NAVIGATION',
    evidenceExcerpt: 'timeout evidence',
    confidence: 'high',
    rationale: 'test fixture',
    evidence: {
      id,
      source: 'e2e',
      title: `test ${id}`,
      testId: `tests/e2e/home.spec.ts::${id}::chromium`,
      specFile: 'tests/e2e/home.spec.ts',
      projectName: 'chromium',
      errorMessage: 'Test timeout of 60000ms exceeded.',
      stackTrace: NOT_AVAILABLE,
      durationMs: 60_000,
      retryCount: 0,
      attemptStatuses: ['failed'],
      screenshotPath: null,
      screenshotPresent: false,
      tracePath: null,
      videoPath: null,
    },
  };
}

function analysis(failures: ClassifiedFailure[]): FailureAnalysisSummary {
  const findings = failures.map((row) => ({
    id: row.id,
    testId: row.testId,
    classification: row.classification,
    ruleFired: row.ruleFired,
    evidenceExcerpt: row.evidenceExcerpt,
    confidence: row.confidence,
    title: row.title,
    source: row.source,
    reason: row.rationale,
    recommendation: 'test',
  }));
  const byClass = summarizeByClass(failures);
  return {
    generatedAt: '2026-09-09T00:00:00.000Z',
    analyzed: failures.length,
    totalFailures: failures.length,
    byClass,
    failures,
    findings,
    metadata: { ...FAILURE_ANALYSIS_METADATA },
    disclaimer: FAILURE_ANALYSIS_DISCLAIMER,
    limitations: [...FAILURE_ANALYSIS_LIMITATIONS],
    section216: {
      section: '2.16',
      title: 'Failure Analysis',
      metadata: { ...FAILURE_ANALYSIS_METADATA },
      disclaimer: FAILURE_ANALYSIS_DISCLAIMER,
      byClass,
      rows: failures.map((row) => ({
        testId: row.testId,
        classification: row.classification,
        evidenceExcerpt: row.evidenceExcerpt,
        ruleFired: row.ruleFired,
        title: row.title,
        source: row.source,
      })),
    },
  };
}

describe('buildRetestFromAnalysis', () => {
  it('records NOT_EXECUTED with a reason when retest is disabled', () => {
    const summary = buildRetestFromAnalysis(analysis([classified('FLAKY', 'F1')]), {
      enabled: false,
    });
    assert.equal(summary.status, 'NOT_EXECUTED');
    assert.equal(summary.dryRun, false);
    assert.equal(summary.executed, 0);
    assert.equal(summary.selected, 0);
    assert.match(summary.reason, /disabled/);
    assert.equal(summary.section217.status, 'NOT_EXECUTED');
  });

  it('records NOT_EXECUTED when skipExecute is set — not DRY_RUN', () => {
    const summary = buildRetestFromAnalysis(analysis([classified('NAVIGATION_TIMEOUT', 'N1')]), {
      enabled: true,
      skipExecute: true,
      skipReason: 'Retest invoked with --dry-run; no executions. Status is NOT_EXECUTED, not DRY_RUN.',
    });
    assert.equal(summary.status, 'NOT_EXECUTED');
    assert.equal(summary.dryRun, false);
    assert.equal(summary.executed, 0);
    assert.equal(summary.selected, 1);
    assert.equal(summary.items[0]?.originalStatus, 'FAIL');
    assert.equal(summary.items[0]?.retestStatus, 'NOT_EXECUTED');
    assert.equal(summary.items[0]?.stabilityVerdict, 'FAIL → NOT_EXECUTED');
    assert.notEqual(summary.status, 'DRY_RUN');
  });

  it('does not select assertion failures', () => {
    const summary = buildRetestFromAnalysis(analysis([classified('ASSERTION_FAILURE', 'A1')]), {
      enabled: true,
      runner: {
        runSpec: () => {
          throw new Error('runner must not be called');
        },
      },
    });
    assert.equal(summary.selected, 0);
    assert.equal(summary.status, 'NOT_EXECUTED');
    assert.match(summary.reason, /No FLAKY or NAVIGATION_TIMEOUT/);
  });

  it('records FAIL → PASS (unstable) and never overwrites original FAIL', () => {
    const runner: RetestRunner = {
      runSpec: () => ({
        status: 'PASS',
        reason: 'Retest passed. Original FAIL is preserved as FAIL → PASS (unstable).',
        resultsPath: null,
      }),
    };
    const summary = buildRetestFromAnalysis(analysis([classified('NAVIGATION_TIMEOUT', 'N1')]), {
      enabled: true,
      runner,
    });
    assert.equal(summary.executed, 1);
    assert.equal(summary.items[0]?.originalStatus, 'FAIL');
    assert.equal(summary.items[0]?.retestStatus, 'PASS');
    assert.equal(summary.items[0]?.finalStatus, 'PASS');
    assert.equal(summary.items[0]?.runCount, 2);
    assert.equal(summary.items[0]?.stabilityVerdict, 'FAIL → PASS (unstable)');
    assert.equal(summary.section217.rows[0]?.originalStatus, 'FAIL');
    assert.equal(summary.section217.rows[0]?.stabilityVerdict, 'FAIL → PASS (unstable)');
  });

  it('records FAIL → FAIL (reproduced) when retest still fails', () => {
    const summary = buildRetestFromAnalysis(analysis([classified('FLAKY', 'F1')]), {
      enabled: true,
      runner: {
        runSpec: () => ({
          status: 'FAIL',
          reason: 'Retest failed. Original FAIL is preserved.',
          resultsPath: null,
        }),
      },
    });
    assert.equal(summary.items[0]?.originalStatus, 'FAIL');
    assert.equal(summary.items[0]?.retestStatus, 'FAIL');
    assert.equal(summary.items[0]?.stabilityVerdict, 'FAIL → FAIL (reproduced)');
  });
});
