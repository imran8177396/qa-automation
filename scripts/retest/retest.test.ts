import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import type { ClassifiedFailure, FailureAnalysisSummary, FailureClass, OwnerFailureClass } from '../failures/types';
import { FAILURE_ANALYSIS_DISCLAIMER, FAILURE_ANALYSIS_LIMITATIONS, FAILURE_ANALYSIS_METADATA } from '../failures/types';
import { summarizeByClass } from '../failures/classify';
import { summarizeByOwnerClass } from '../failures/owner';
import { blockedSummary, buildRetestFromAnalysis } from './build';
import type { RetestRunner, RetestStageRunner } from './types';

function classified(
  classification: FailureClass,
  id: string,
  owner: OwnerFailureClass = 'APPLICATION',
  source = 'e2e'
): ClassifiedFailure {
  return {
    id,
    testId: `tests/e2e/home.spec.ts::${id}::chromium`,
    source,
    title: `test ${id}`,
    classification,
    ownerClassification: owner,
    ownerRuleFired: owner === 'AUTOMATION' ? 'MECHANISM_AUTOMATION' : 'MECHANISM_APPLICATION',
    ruleFired: classification === 'FLAKY' ? 'MIXED_RETRY_OUTCOMES' : 'ERROR_TEXT_ASSERTION',
    evidenceExcerpt: 'timeout evidence',
    confidence: 'high',
    rationale: 'test fixture',
    originalStatus: 'FAIL',
    evidence: {
      id,
      source,
      title: `test ${id}`,
      testId: `tests/e2e/home.spec.ts::${id}::chromium`,
      specFile: 'tests/e2e/home.spec.ts',
      projectName: 'chromium',
      errorMessage: 'Expected heading to be present.',
      stackTrace: NOT_AVAILABLE,
      durationMs: 1_000,
      retryCount: 0,
      attemptStatuses: ['failed'],
      screenshotPath: null,
      screenshotPresent: false,
      tracePath: null,
      videoPath: null,
      artifactSourcePath: 'reports/failures/summary.json',
    },
  };
}

function analysis(failures: ClassifiedFailure[]): FailureAnalysisSummary {
  const findings = failures.map((row) => ({
    id: row.id,
    testId: row.testId,
    classification: row.classification,
    ruleFired: row.ruleFired,
    ownerClassification: row.ownerClassification,
    evidenceExcerpt: row.evidenceExcerpt,
    confidence: row.confidence,
    title: row.title,
    source: row.source,
    reason: row.rationale,
    recommendation: 'test',
    originalStatus: 'FAIL' as const,
  }));
  const byClass = summarizeByClass(failures);
  return {
    generatedAt: '2026-09-09T00:00:00.000Z',
    outcome: failures.length === 0 ? 'NOTHING_TO_ANALYZE' : 'ANALYZED',
    analyzed: failures.length,
    totalFailures: failures.length,
    byClass,
    byOwnerClass: summarizeByOwnerClass(failures),
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
        ownerClassification: row.ownerClassification,
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
    const summary = buildRetestFromAnalysis(analysis([classified('FLAKY', 'F1', 'AUTOMATION')]), {
      enabled: false,
    });
    assert.equal(summary.status, 'NOT_EXECUTED');
    assert.equal(summary.outcome, 'NOT_EXECUTED');
    assert.equal(summary.dryRun, false);
    assert.equal(summary.executed, 0);
    assert.equal(summary.selected, 0);
    assert.match(summary.reason, /disabled/);
    assert.equal(summary.section217.status, 'NOT_EXECUTED');
    assert.equal(summary.items[0]?.originalStatus, 'FAIL');
  });

  it('records NOT_EXECUTED when skipExecute is set — not DRY_RUN', () => {
    const summary = buildRetestFromAnalysis(analysis([classified('NAVIGATION_TIMEOUT', 'N1', 'BROWSER')]), {
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

  it('records NOTHING_TO_RETEST when analysis has zero failures', () => {
    const summary = buildRetestFromAnalysis(analysis([]), { enabled: true });
    assert.equal(summary.outcome, 'NOTHING_TO_RETEST');
    assert.equal(summary.status, 'NOT_EXECUTED');
    assert.equal(summary.items.length, 0);
    assert.match(summary.reason, /NOTHING_TO_RETEST/);
  });

  it('records BLOCKED when analysis is missing (CLI helper)', () => {
    const summary = blockedSummary('BLOCKED: no failure analysis summary.', false);
    assert.equal(summary.outcome, 'BLOCKED');
    assert.equal(summary.status, 'NOT_EXECUTED');
    assert.equal(summary.items.length, 0);
  });

  it('selects APPLICATION assertion failures and records FAIL → FAIL without changing owner', () => {
    const seo = classified('ASSERTION_FAILURE', 'SEO-0001', 'APPLICATION', 'seo');
    seo.testId = 'SEO-0001';
    seo.title = 'missing-h1';
    const summary = buildRetestFromAnalysis(analysis([seo]), {
      enabled: true,
      stageRunner: {
        run: () => ({
          status: 'RAN',
          reason: 'synthetic seo retest',
          resultsPath: 'reports/retest/runs/seo/summary.json',
          findings: [{ id: 'SEO-0001', status: 'FAIL', rule: 'missing-h1', page: 'https://www.saucedemo.com/' }],
        }),
      },
      runner: {
        runSpec: () => {
          throw new Error('playwright runner must not be called for seo');
        },
      },
    });
    assert.equal(summary.selected, 1);
    assert.equal(summary.outcome, 'COMPLETE');
    assert.equal(summary.items[0]?.originalStatus, 'FAIL');
    assert.equal(summary.items[0]?.retestStatus, 'FAIL');
    assert.equal(summary.items[0]?.stabilityVerdict, 'FAIL → FAIL (reproduced)');
    assert.equal(summary.items[0]?.ownerClassification, 'APPLICATION');
    assert.equal(summary.items[0]?.ownerClassificationUnchanged, true);
    assert.equal(summary.items[0]?.classification, 'ASSERTION_FAILURE');
    assert.equal(summary.items[0]?.classificationUnchanged, true);
    assert.equal(summary.items[0]?.automationFixRequired, false);
    assert.equal(summary.items[0]?.originalFailureId, 'SEO-0001');
    assert.match(summary.items[0]?.evidence.originalAnalysis ?? '', /original\/failures/);
    assert.deepEqual(
      summary.items[0]?.lifecycle.map((step) => step.stage),
      ['FAIL', 'ANALYZE', 'CLASSIFY', 'FIX_AUTOMATION_DEFECT_IF_REQUIRED', 'RETEST', 'VERIFY', 'RECORD']
    );
    assert.equal(summary.items[0]?.lifecycle.find((step) => step.stage === 'FIX_AUTOMATION_DEFECT_IF_REQUIRED')?.status, 'NOT_APPLICABLE');
  });

  it('records automation fix REQUIRED for AUTOMATION owner without inventing a product PASS', () => {
    const runner: RetestRunner = {
      runSpec: () => ({
        status: 'FAIL',
        reason: 'Retest failed. Original FAIL is preserved.',
        resultsPath: 'reports/retest/runs/A1.json',
      }),
    };
    const summary = buildRetestFromAnalysis(analysis([classified('ELEMENT_TIMEOUT', 'A1', 'AUTOMATION')]), {
      enabled: true,
      runner,
    });
    assert.equal(summary.items[0]?.automationFixRequired, true);
    assert.equal(summary.items[0]?.retestStatus, 'FAIL');
    assert.equal(summary.items[0]?.originalStatus, 'FAIL');
    assert.equal(
      summary.items[0]?.lifecycle.find((step) => step.stage === 'FIX_AUTOMATION_DEFECT_IF_REQUIRED')?.status,
      'REQUIRED'
    );
  });

  it('does not select APPLICATION rows under --automation-only (NOTHING_TO_RETEST)', () => {
    const summary = buildRetestFromAnalysis(analysis([classified('ASSERTION_FAILURE', 'A1', 'APPLICATION')]), {
      enabled: true,
      automationOnly: true,
      runner: {
        runSpec: () => {
          throw new Error('runner must not be called');
        },
      },
    });
    assert.equal(summary.selected, 0);
    assert.equal(summary.outcome, 'NOTHING_TO_RETEST');
    assert.equal(summary.items[0]?.originalStatus, 'FAIL');
    assert.equal(summary.items[0]?.retestStatus, 'NOT_EXECUTED');
    assert.equal(summary.items[0]?.ownerClassification, 'APPLICATION');
  });

  it('records FAIL → PASS (unstable) and never overwrites original FAIL', () => {
    const runner: RetestRunner = {
      runSpec: () => ({
        status: 'PASS',
        reason: 'Retest passed. Original FAIL is preserved as FAIL → PASS (unstable).',
        resultsPath: null,
      }),
    };
    const summary = buildRetestFromAnalysis(analysis([classified('NAVIGATION_TIMEOUT', 'N1', 'BROWSER')]), {
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
    assert.equal(summary.section217.rows[0]?.originalFailureId, 'N1');
    assert.equal(summary.section217.rows[0]?.ownerClassification, 'BROWSER');
  });

  it('records FAIL → FAIL (reproduced) when retest still fails', () => {
    const summary = buildRetestFromAnalysis(analysis([classified('FLAKY', 'F1', 'AUTOMATION')]), {
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

  it('runs a quality stage once and maps each original finding id', () => {
    const calls: string[] = [];
    const stageRunner: RetestStageRunner = {
      run: (source) => {
        calls.push(source);
        return {
          status: 'RAN',
          reason: 'synthetic',
          resultsPath: 'reports/retest/runs/security/summary.json',
          findings: [
            { status: 'FAIL', rule: 'content-security-policy', page: 'https://www.saucedemo.com/' },
            { status: 'FAIL', rule: 'strict-transport-security', page: 'https://www.saucedemo.com/' },
          ],
        };
      },
    };
    const sec1 = classified('ASSERTION_FAILURE', 'SECURITY-0001', 'APPLICATION', 'security');
    sec1.title = 'content-security-policy';
    sec1.testId = 'security::content-security-policy::https://www.saucedemo.com/';
    const sec2 = classified('ASSERTION_FAILURE', 'SECURITY-0002', 'APPLICATION', 'security');
    sec2.title = 'strict-transport-security';
    sec2.testId = 'security::strict-transport-security::https://www.saucedemo.com/';
    const summary = buildRetestFromAnalysis(analysis([sec1, sec2]), {
      enabled: true,
      stageRunner,
    });
    assert.deepEqual(calls, ['security']);
    assert.equal(summary.executed, 2);
    assert.equal(summary.items[0]?.retestStatus, 'FAIL');
    assert.equal(summary.items[1]?.retestStatus, 'FAIL');
    assert.equal(summary.items[0]?.originalFailureId, 'SECURITY-0001');
    assert.equal(summary.items[1]?.originalFailureId, 'SECURITY-0002');
  });
});
