import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CoverageSummary } from '../../coverage/types';
import {
  UNCLASSIFIED_SEVERITY,
  buildDomainMatrix,
  buildKpiSnapshot,
  buildMasterNormalizedSummary,
  displaySectionStatus,
  retestCurrentStatus,
  type MasterSummarySources,
} from './master-report-summary';

function coverage(): CoverageSummary {
  return {
    generatedAt: '2026-09-18T14:34:06.829Z',
    seedUrl: 'https://example.test/',
    playwrightBaseUrl: 'https://example.test/',
    formula: 'Coverage = items with status TESTED or FAILED ÷ testable items.',
    coverageIsNotPassRate: true,
    itemCoveragePercent: 86.4,
    scopeCoveragePercent: 70.4,
    testableItems: 22,
    scopeItems: 27,
    coveredItems: 19,
    testedCount: 14,
    failedCount: 5,
    blockedCount: 5,
    uncoveredCount: 3,
    complete: false,
    passRatePercent: 49.6,
    dimensions: [
      {
        id: 'api',
        label: 'API coverage',
        discovered: 14,
        testable: 12,
        covered: 12,
        uncovered: 0,
        coveragePercent: 100,
        byStatus: {
          TESTED: 12,
          FAILED: 0,
          BLOCKED: 0,
          SKIPPED: 0,
          'NOT APPLICABLE': 2,
          UNTESTABLE: 0,
          UNCOVERED: 0,
        },
      },
    ],
    riskAreas: [
      {
        id: 'failed-security',
        title: 'security executed and FAILED',
        severity: 'high',
        category: 'failed',
        reason: 'documented',
        itemIds: ['SEC'],
        itemCount: 1,
      },
    ],
  };
}

function sources(partial: Partial<MasterSummarySources> = {}): MasterSummarySources {
  return {
    coverage: coverage(),
    qualityGate: {
      status: 'FAIL',
      reasons: [{ code: 'required-product-fail', detail: 'ACCESSIBILITY is FAIL' }],
      requiredSuites: [
        { label: 'ACCESSIBILITY', status: 'FAIL' },
        { label: 'POSTMAN', status: 'PASS' },
      ],
      qualityChecks: { available: true, source: 'reports/quality/quality-checks.json', blockingFailures: [] },
    },
    stages: [
      { key: 'e2e', name: 'Playwright UI/E2E', status: 'PARTIAL' },
      { key: 'content', name: 'Content QA', status: 'NOT_EXECUTED', reason: 'zero pages' },
      { key: 'inventory', name: 'Inventory generation', status: 'BLOCKED', reason: 'dependency missing' },
    ],
    failures: {
      totalFailures: 2,
      analyzed: 2,
      byClass: { NAVIGATION_TIMEOUT: 1, ASSERTION_FAILURE: 1, ENVIRONMENT: 0 },
      failures: [
        { id: 'E2E-0001', source: 'e2e', title: 'home page title', evidence: { errorMessage: 'title mismatch' } },
        { id: 'E2E-0002', source: 'e2e', title: 'login visible', evidence: { screenshotPath: 'shot.png' } },
      ],
    },
    retest: {
      items: [
        { id: 'E2E-0001', title: 'home page title', originalStatus: 'FAIL', retestStatus: 'NOT_EXECUTED', finalStatus: 'NOT_EXECUTED' },
        { id: 'E2E-0099', title: 'fixed later', originalStatus: 'FAIL', retestStatus: 'PASS', finalStatus: 'PASS' },
      ],
    },
    moduleFindings: [
      {
        area: 'Security',
        findings: [{ id: 'SEC-1', status: 'FAIL', severity: 'medium', detail: 'CSP absent' }],
      },
    ],
    projectName: 'QA Automation',
    baseUrl: 'https://example.test/',
    executionId: 'QA-Automation_2026-09-18_17-59-36_PKT',
    startTime: '2026-09-18T17:59:36+05:00',
    endTime: '2026-09-18T20:13:19+05:00',
    environment: 'NOT_AVAILABLE',
    frameworkVersion: '1.0.0',
    reportVersion: '1.1',
    browsers: ['chromium'],
    testSuite: 'qa:all',
    overallStatus: 'FAIL',
    limitations: ['Automated accessibility is not a complete WCAG audit.'],
    coverageFormula: 'Coverage = items with status TESTED or FAILED ÷ testable items.',
    ...partial,
  };
}

describe('master report normalized summary', () => {
  it('maps official coverage totals without recalculating a four-way identity', () => {
    const kpis = buildKpiSnapshot(coverage());
    assert.equal(kpis.totalTests, 22);
    assert.equal(kpis.executed, 19);
    assert.equal(kpis.passed, 14);
    assert.equal(kpis.failed, 5);
    assert.equal(kpis.blocked, 5);
    assert.equal(kpis.notTested, 3);
    assert.equal(kpis.coveragePercent, 86.4);
    assert.equal(kpis.passRatePercent, 49.6);
    assert.equal(kpis.identity.officialTestableHolds, true);
    assert.equal(kpis.identity.officialTestableRight, 22);
    assert.equal(kpis.identity.fourWaySum, 27);
    assert.equal(kpis.identity.fourWayEqualsTotalTests, false);
  });

  it('does not invent findings, severity, or generic recommendations', () => {
    const summary = buildMasterNormalizedSummary(sources());
    assert.equal(summary.cover.applicationName, 'QA Automation');
    assert.equal(summary.cover.environment, null);
    assert.ok(summary.keyFindings.some((row) => row.finding.includes('ACCESSIBILITY is FAIL')));
    assert.ok(summary.defects.some((row) => row.id === 'E2E-0001' && row.fromFailures));
    assert.equal(summary.defects.filter((row) => row.fromFailures).length, 2);
    assert.ok(summary.defects.some((row) => row.id === 'SEC-1' && row.severity === 'Medium'));
    assert.ok(summary.defects.every((row) => row.severity !== 'Critical' || row.group === 'Critical / Release Blocking'));
    const unclassifiedFailure = summary.defects.find((row) => row.id === 'E2E-0001');
    assert.equal(unclassifiedFailure?.severity, UNCLASSIFIED_SEVERITY);
    assert.ok(summary.recommendedActions.every((row) => row.defectOrTestId && row.problem));
    assert.ok(summary.recommendedActions.some((row) => row.defectOrTestId === 'required-product-fail'));
    assert.equal(summary.recommendedActions.some((row) => /improve overall quality/i.test(row.suggestedAction)), false);
    assert.deepEqual(
      summary.failureDistribution.map((row) => row.category),
      ['NAVIGATION_TIMEOUT', 'ASSERTION_FAILURE']
    );
    assert.ok(summary.scope.included.some((row) => row.includes('Playwright UI/E2E')));
    assert.ok(summary.scope.notExecuted.some((row) => row.includes('Content QA')));
    assert.ok(summary.scope.blocked.some((row) => row.includes('Inventory generation')));
  });

  it('never marks a test Fixed unless retest status is PASS', () => {
    assert.equal(retestCurrentStatus('FAIL', 'NOT_EXECUTED', 'NOT_EXECUTED'), 'Not retested');
    assert.equal(retestCurrentStatus('FAIL', 'FAIL', 'FAIL'), 'Still failing');
    assert.equal(retestCurrentStatus('PASS', 'FAIL', 'FAIL'), 'Newly failing');
    assert.equal(retestCurrentStatus('FAIL', 'PASS', 'PASS'), 'Fixed');
    const summary = buildMasterNormalizedSummary(sources());
    assert.equal(summary.retestRows[0]?.currentStatus, 'Not retested');
    assert.equal(summary.retestRows[1]?.currentStatus, 'Fixed');
  });

  it('maps domain display statuses without treating NOT TESTED or BLOCKED as PASS', () => {
    assert.equal(displaySectionStatus('NOT_EXECUTED'), 'NOT TESTED');
    assert.equal(displaySectionStatus('BLOCKED'), 'BLOCKED');
    assert.equal(displaySectionStatus('PARTIAL'), 'FAIL');
    assert.equal(displaySectionStatus('RECORDED'), 'RECORDED');
    assert.equal(displaySectionStatus('UNCOVERED'), 'NOT TESTED');
    assert.notEqual(displaySectionStatus('RECORDED'), 'PASS');
    const matrix = buildDomainMatrix(
      [
        { id: 'api-testing', status: 'PASS', displayStatus: 'PASS' },
        { id: 'content-qa', status: 'NOT_EXECUTED', displayStatus: 'NOT TESTED' },
      ],
      coverage()
    );
    const api = matrix.find((row) => row.sectionId === 'api-testing');
    const content = matrix.find((row) => row.sectionId === 'content-qa');
    assert.equal(api?.tested, '12');
    assert.equal(api?.passed, '12');
    assert.equal(api?.coverage, '100%');
    assert.equal(content?.sectionStatus, 'NOT TESTED');
    assert.equal(content?.coverage, 'NOT_AVAILABLE');
    assert.notEqual(content?.sectionStatus, 'PASS');
  });
});
