/**
 * Golden-file regression net for report-generator v1.1 defects.
 * Calls the same producers the generator uses. Isolated fixtures only —
 * never reads or writes the live reports/ directory.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectSeoFindings } from '../../seo/dedupe-findings';
import { loadConfig } from '../load-config';
import { assertNoConflictingRates, uiExecutionPassRate } from '../pass-rate';
import {
  PRODUCT_ORIGIN_SUITES,
  assertNoDuplicateOutputPaths,
  assertUniquePlaywrightSuitePaths,
} from '../playwright-suites';
import { assertDiscoveryPrecedesExecution } from '../stage-timeline';
import { compareSuiteOriginToBaseUrl } from '../suite-origin';
import { resolveSuiteStatus, rollupStageGroups } from '../suite-status';
import { EmptyTableError, TableAudit, emptyTablePlaceholder } from './empty-table';
import {
  loadV11CollisionPaths,
  loadV11ConflictingPassRates,
  loadV11DanglingRef,
  loadV11GeneratedCheckSuiteSummary,
  loadV11ResponsiveSummary,
  loadV11ResponsiveSuiteSummary,
  loadV11SeoDiscovery,
  loadV11SeoSeed,
  loadV11SeoSuiteSummary,
  loadV11Timeline,
  loadV11WorkflowSummary,
  expandV11SeoDuplicates,
  V11_FIXTURE_DIR,
} from './load-v1.1-fixtures';
import {
  QualityCheckFailure,
  assertQualityChecksPass,
  collectPlannedRefIds,
  evaluateQualityChecks,
  type QualityCheckInput,
} from './quality-checks';
import {
  DanglingSectionReferenceError,
  SectionRegistry,
  numberSections,
  resolveRefTokens,
} from './section-manifest';

function qualityInput(overrides: Partial<QualityCheckInput> = {}): QualityCheckInput {
  return {
    plannedRefIds: [],
    numberedSections: numberSections(),
    passRates: [],
    suites: [],
    productOriginMismatches: [],
    emptyTablesWithoutReason: 0,
    tautologicalArtifact: { present: false },
    crossSuiteArtifactMissing: true,
    ...overrides,
  };
}

/** Same throw the report stage uses when discovery completed after execution started. */
function failReportIfDiscoveryAfterExecution(
  stages: Parameters<typeof assertDiscoveryPrecedesExecution>[0]
): void {
  const ordering = assertDiscoveryPrecedesExecution(stages);
  if (!ordering.ok) {
    throw new Error(
      `Report stage failed: discovery/execution ordering violated. ${ordering.violations.join('; ')}`
    );
  }
}

describe('v1.1 golden fixtures', () => {
  it('loads isolated fixtures under scripts/lib/qa-report/fixtures/v1.1', () => {
    assert.match(V11_FIXTURE_DIR.replace(/\\/g, '/'), /scripts\/lib\/qa-report\/fixtures\/v1\.1$/);
  });

  it('dedupes suite+discovery SEO and discloses raw vs unique (not 122)', () => {
    const seed = loadV11SeoSeed();
    const { suite, discovery } = expandV11SeoDuplicates(seed);
    assert.equal(suite.length + discovery.length, 122);

    const deduped = collectSeoFindings(suite, discovery);
    assert.equal(deduped.rawFindingCount, 122);
    assert.equal(deduped.uniqueFindingCount, 61);
    assert.equal(deduped.findings.length, 61);
    assert.notEqual(deduped.uniqueFindingCount, 122);

    const checks = evaluateQualityChecks(
      qualityInput({
        seo: {
          available: true,
          rawFindingCount: deduped.rawFindingCount,
          uniqueFindingCount: deduped.uniqueFindingCount,
          findingsLength: deduped.findings.length,
        },
      })
    );
    const seo = checks.find((row) => row.id === 'seo-dedupe');
    assert.equal(seo?.result, 'PASS');
    assert.match(seo?.detail ?? '', /No duplicate findings after dedupe \(raw 122, unique 61\)/);
  });

  it('collapses overlapping suite-summary + discovery SEO files', () => {
    const suite = loadV11SeoSuiteSummary();
    const discovery = loadV11SeoDiscovery();
    const concatenated = [...suite.findings, ...discovery.findings];
    assert.equal(concatenated.length, 4);

    const deduped = collectSeoFindings(suite.findings, discovery.findings);
    assert.equal(deduped.rawFindingCount, 4);
    assert.equal(deduped.uniqueFindingCount, 2);
    assert.equal(deduped.findings.length, 2);

    const alreadyDeduped = evaluateQualityChecks(
      qualityInput({
        seo: {
          available: true,
          rawFindingCount: suite.rawFindingCount,
          uniqueFindingCount: suite.uniqueFindingCount,
          findingsLength: suite.findings.length,
        },
      })
    );
    assert.equal(alreadyDeduped.find((row) => row.id === 'seo-dedupe')?.result, 'PASS');

    const preDedupeConcat = evaluateQualityChecks(
      qualityInput({
        seo: {
          available: true,
          rawFindingCount: 4,
          uniqueFindingCount: 2,
          findingsLength: concatenated.length,
        },
      })
    );
    const failed = preDedupeConcat.find((row) => row.id === 'seo-dedupe');
    assert.equal(failed?.result, 'FAIL');
    assert.match(failed?.detail ?? '', /Duplicate findings remain after dedupe \(raw 4, unique 2, rendered 4\)/);
  });

  it('renders a zero-item workflow suite as NOT_EXECUTED, never PASS', () => {
    const workflow = loadV11WorkflowSummary();
    const executedCount = workflow.workflows?.length ?? 0;
    assert.equal(executedCount, 0);
    assert.equal(workflow.passed, true, 'fixture reproduces the v1.1 passed:true + empty list');

    const status = resolveSuiteStatus({
      executedCount,
      failedCount: workflow.passed ? 0 : 1,
    });
    assert.equal(status, 'NOT_EXECUTED');
    assert.notEqual(status, 'PASS');

    const renderedPass = evaluateQualityChecks(
      qualityInput({
        suites: [{ name: 'workflows', status: 'PASS', executedCount: 0 }],
      })
    );
    assert.equal(renderedPass.find((row) => row.id === 'zero-exec-pass')?.result, 'FAIL');
    assert.match(renderedPass.find((row) => row.id === 'zero-exec-pass')?.detail ?? '', /workflows/);

    const corrected = evaluateQualityChecks(
      qualityInput({
        suites: [{ name: 'workflows', status, executedCount: 0 }],
      })
    );
    assert.equal(corrected.find((row) => row.id === 'zero-exec-pass')?.result, 'PASS');
    assert.match(
      corrected.find((row) => row.id === 'zero-exec-pass')?.detail ?? '',
      /No suite with zero executed items is rendered PASS/
    );
  });

  it('marks a localhost responsive suite INVALID and excludes it from pass counts', () => {
    const config = loadConfig();
    const responsive = loadV11ResponsiveSummary();
    const suiteSummary = loadV11ResponsiveSuiteSummary();
    const productSuite = loadV11GeneratedCheckSuiteSummary();

    assert.equal(responsive.targetOrigin, 'http://127.0.0.1:4173');
    assert.equal(config.playwright.baseURL, 'https://example.com');
    assert.equal(compareSuiteOriginToBaseUrl(responsive.targetOrigin, config.playwright.baseURL), 'INVALID');
    assert.equal(compareSuiteOriginToBaseUrl(suiteSummary.targetOrigin, suiteSummary.configuredBaseUrl), 'INVALID');
    assert.equal(suiteSummary.originStatus, 'INVALID');

    const executedCount =
      typeof suiteSummary.browsers[0]?.total === 'number' ? suiteSummary.browsers[0].total : 0;
    const failedCount =
      typeof suiteSummary.browsers[0]?.failed === 'number' ? suiteSummary.browsers[0].failed : 0;
    const status = resolveSuiteStatus({
      executedCount,
      failedCount,
      invalid: suiteSummary.originStatus === 'INVALID',
    });
    assert.equal(status, 'INVALID');

    const rollup = rollupStageGroups([{ name: 'Responsive', status }]);
    assert.deepEqual(rollup.passed, []);
    assert.ok(rollup.failed.includes('Responsive'));

    assert.ok((PRODUCT_ORIGIN_SUITES as readonly string[]).includes(productSuite.suiteName));
    const originChecks = evaluateQualityChecks(
      qualityInput({
        productOriginMismatches: [
          {
            suite: productSuite.suiteName,
            origin: productSuite.targetOrigin,
            baseUrl: productSuite.configuredBaseUrl,
          },
        ],
      })
    );
    const origin = originChecks.find((row) => row.id === 'suite-origin');
    assert.equal(origin?.result, 'FAIL');
    assert.match(origin?.detail ?? '', /generated-check/);
    assert.match(origin?.detail ?? '', /127\.0\.0\.1:4173/);
  });

  it('fails when two Playwright suites share reports/playwright/results.json', () => {
    assert.doesNotThrow(() => assertUniquePlaywrightSuitePaths());
    assert.throws(
      () => assertNoDuplicateOutputPaths(loadV11CollisionPaths()),
      /Playwright suite output collision/
    );

    const checks = evaluateQualityChecks(
      qualityInput({
        playwrightOutputPaths: loadV11CollisionPaths(),
      })
    );
    const row = checks.find((item) => item.id === 'playwright-output-paths');
    assert.equal(row?.result, 'FAIL');
    assert.match(row?.detail ?? '', /suite output collision/);
  });

  it('fails the report stage when discovery completedAt is after execution startedAt', () => {
    const timeline = loadV11Timeline();
    const ordering = assertDiscoveryPrecedesExecution(timeline.stages);
    assert.equal(ordering.ok, false);
    assert.match(ordering.violations[0] ?? '', /after Playwright UI\/E2E startedAt/);

    const checks = evaluateQualityChecks(
      qualityInput({
        stageTimeline: timeline.stages,
      })
    );
    const row = checks.find((item) => item.id === 'discovery-before-execution');
    assert.equal(row?.result, 'FAIL');
    assert.throws(() => assertQualityChecksPass(checks), (error: unknown) => {
      assert.ok(error instanceof QualityCheckFailure);
      return true;
    });
    assert.throws(
      () => failReportIfDiscoveryAfterExecution(timeline.stages),
      /Report stage failed: discovery\/execution ordering violated/
    );
  });

  it('throws NOT_AVAILABLE — reason when a table has zero rows and no reason', () => {
    const audit = new TableAudit();
    assert.throws(() => audit.record(['Risk', 'Count'], 0), (error: unknown) => {
      assert.ok(error instanceof EmptyTableError);
      assert.match((error as Error).message, /zero rows and no reason/);
      return true;
    });

    const placeholder = emptyTablePlaceholder(2, 'no rows were available and no reason was supplied');
    assert.match(placeholder.cells[0] ?? '', /^NOT_AVAILABLE — /);

    const checks = evaluateQualityChecks(qualityInput({ emptyTablesWithoutReason: 1 }));
    assert.equal(checks.find((row) => row.id === 'empty-tables')?.result, 'FAIL');
  });

  it('throws when two pass rates share a scope label and disagree', () => {
    const fixture = loadV11ConflictingPassRates();
    const rates = fixture.map((row) =>
      uiExecutionPassRate({ passed: row.passed, failed: row.failed, skipped: row.skipped })
    );
    assert.equal(rates[0]?.scope, rates[1]?.scope);
    assert.throws(() => assertNoConflictingRates(rates), /Conflicting pass rates for scope "uiExecutionPassRate"/);

    const checks = evaluateQualityChecks(qualityInput({ passRates: rates }));
    assert.equal(checks.find((row) => row.id === 'pass-rate-conflict')?.result, 'FAIL');
    assert.throws(() => assertQualityChecksPass(checks), QualityCheckFailure);
  });

  it('throws on a dangling section cross-reference', () => {
    const dangling = loadV11DanglingRef();
    const planned = collectPlannedRefIds([dangling.prose]);
    assert.deepEqual(planned, ['not-a-real-section']);

    const checks = evaluateQualityChecks(qualityInput({ plannedRefIds: planned }));
    assert.equal(checks.find((row) => row.id === 'cross-references')?.result, 'FAIL');

    const registry = new SectionRegistry();
    resolveRefTokens(`see {{ref:${dangling.unemittedValidId}}}`, registry);
    assert.throws(() => registry.assertEveryReferenceResolves(), (error: unknown) => {
      assert.ok(error instanceof DanglingSectionReferenceError);
      assert.deepEqual(error.unresolved, [dangling.unemittedValidId]);
      return true;
    });
  });
});
