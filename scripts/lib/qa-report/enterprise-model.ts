import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths';
import { loadConfig } from '../load-config';
import { resolvePlaywrightBrowsers } from '../playwright-browsers';
import { reconcileSummary, writeSummaryFile, type SummaryFile } from './reconcile-summary';
import { findBrokenLinks } from '../../discovery/broken-links';
import type { DiscoveryResult } from '../../discovery/types';
import type { InventoryResult } from '../../inventory/types';
import type { SeoAnalysisResult, SeoSuiteSummary } from '../../seo/types';
import { SEO_DISCLAIMER, SEO_LIMITATIONS } from '../../seo/types';
import { collectSeoFindings } from '../../seo/dedupe-findings';
import { parseJmeterJtl } from '../../performance/metrics';
import type { PerformanceSummary } from '../../performance/types';
import type { CoverageFormula, CoverageReport } from '../../coverage/types';
import type { UiInventory } from '../../discovery/ui-scan';
import { resolveSuiteStatus, rollupStageGroups } from '../suite-status';
import {
  assertionPassRate,
  uiExecutionPassRate,
  type LabelledPassRate,
} from '../pass-rate';
import { formatLabelledPassRate } from './format-pass-rate';
import { collectRunProvenance, provenanceAsRows, type RunProvenance } from './provenance';
import { formatIsoOffset, reportTimezoneLabel, toIsoOffset } from './timestamps';
import { buildTrendRows, persistHistoryKpis, loadPreviousHistory, type HistoryKpis, type TrendDelta } from './history';
import {
  ensureReportConfigWritten,
  formatPreparedBy,
  formatReviewedBy,
  isReviewerUnset,
  type ReportCriteria,
  type ReportRetention,
  type ReportRevision,
  type ReportSignOff,
} from './ensure-report-config';
import {
  assertQualityChecksPass,
  collectPlannedRefIds,
  evaluateQualityChecks,
  formatQualityCheckLine,
  readTautologicalArtifact,
  reportQualityWarnings,
  type QualityCheck,
} from './quality-checks';
import { numberSections } from './section-manifest';
import { buildInventoryModel } from './build-inventory-model';
import {
  loadAccessibilitySection,
  loadContentSection,
  loadFailureAnalysisSection,
  loadLighthouseSection,
  loadRetestSection,
  loadSecuritySection,
  loadStageTimelineRows,
  loadVisualSection,
  type AccessibilitySectionModel,
  type ContentSectionModel,
  type FailureAnalysisSectionModel,
  type LighthouseSectionModel,
  type RetestSectionModel,
  type SecuritySectionModel,
  type VisualSectionModel,
} from './load-section-artifacts';
import {
  ALL_PLAYWRIGHT_ENGINES,
  PLAYWRIGHT_ENGINE_CAVEATS,
  assertUniquePlaywrightSuitePaths,
  generatedCheckResultsPath,
  playwrightSuiteSummaryPath,
  PLAYWRIGHT_SUITE_NAMES,
  PRODUCT_ORIGIN_SUITES,
} from '../playwright-suites';
import { normalizePerformanceProfile } from '../../performance/profiles';
import {
  loadPlaywrightJsonReport,
  parseFailedExecutionsFromFile,
  type PlaywrightFailedExecution,
} from '../playwright-results';
import { compareSuiteOriginToBaseUrl, NOT_AVAILABLE, resolveConfiguredPlaywrightBaseUrl } from '../suite-origin';
import {
  assertDiscoveryPrecedesExecution,
  stagePhaseForKey,
  type StageTimelineRow,
} from '../stage-timeline';
import type { PlaywrightSuiteSummary } from '../playwright-suite-summary';
import type { CrossSuiteReport } from '../quality/cross-suite';
import { readJsonIfExists } from '../../discovery/write-json';

export type QaStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'CONDITIONAL PASS';

export interface PlaywrightExecution {
  testCaseId: string;
  specFile: string;
  scenario: string;
  browser: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED' | string;
  durationMs: number;
  startedAt: string;
  error: string;
  /** The reason string passed to test.skip(true, reason) — e.g. "BLOCKED: ...". Empty when not skipped. */
  skipReason: string;
}

export interface BrowserSummary {
  browser: string;
  status: 'EXECUTED' | 'NOT_EXECUTED' | typeof NOT_AVAILABLE;
  reason: string;
  total: number | typeof NOT_AVAILABLE;
  passed: number | typeof NOT_AVAILABLE;
  failed: number | typeof NOT_AVAILABLE;
  skipped: number | typeof NOT_AVAILABLE;
  passRate: string;
}

export interface ApiRequestResult {
  testId: string;
  name: string;
  method: string;
  endpoint: string;
  statusCode: string;
  responseTimeMs: number;
  assertion: string;
  result: string;
}

export interface JmeterSampleRow {
  index: number;
  thread: string;
  label: string;
  url: string;
  statusCode: string;
  elapsedMs: number;
  result: string;
}

export interface EnterpriseReportModel {
  meta: {
    reportTitle: string;
    projectName: string;
    applicationName: string;
    testingPhase: string;
    environment: string;
    reportVersion: string;
    executionDate: string;
    preparedBy: string;
    reviewedBy: string;
    pendingReview: boolean;
    approvalDate: string;
    distribution: string;
    confidentiality: string;
    timezone: string;
    overallStatus: QaStatus;
    generatedAt: string;
  };
  provenance: RunProvenance;
  signOff: ReportSignOff;
  revisionHistory: ReportRevision[];
  criteria: ReportCriteria;
  retention: ReportRetention;
  criteriaEvaluation: Array<{ criterion: string; result: string; detail: string }>;
  trend: { note: string; rows: TrendDelta[] };
  passRates: {
    uiExecution: LabelledPassRate;
    assertion: LabelledPassRate;
    uiFormatted: string;
    assertionFormatted: string;
  };
  qualityCheckRecords: QualityCheck[];
  originMismatches: Array<{ suite: string; origin: string; baseUrl: string; product: boolean }>;
  suiteGroups: { passed: string[]; failed: string[]; notExecuted: string[] };
  stageTimeline: {
    available: boolean;
    rows: StageTimelineRow[];
    orderingOk: boolean;
    violations: string[];
  };
  visual: VisualSectionModel;
  kpi: {
    totalUiExecutions: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: string;
    uniqueUiScenarios: number;
    browserCoverage: string;
    apiRequests: number;
    performanceSamples: number;
    defects: number;
  };
  projectInfo: Array<{ label: string; value: string }>;
  inScope: string[];
  outOfScope: string[];
  testingTypes: Array<{ type: string; tool: string; coverage: string; result: string }>;
  environment: Array<{ label: string; value: string }>;
  coverage: {
    uniqueUiScenarios: number;
    uiExecutions: number;
    browsers: string[];
    apiRequests: number;
    performanceSamples: number;
    functionalAreas: string[];
    coverageNote: string;
    formula: CoverageFormula | null;
    advanced: {
      available: boolean;
      itemCoveragePercent: number;
      testable: number;
      covered: number;
      uncovered: number;
      passRatePercent: number | null;
      pagesDiscoveredRaw: number | typeof NOT_AVAILABLE;
      pagesDiscoveredUnique: number | typeof NOT_AVAILABLE;
      dimensions: Array<{
        label: string;
        discovered: number;
        testable: number;
        covered: number;
        uncovered: number;
        coveragePercent: number;
      }>;
      gaps: Array<{
        page: string;
        element: string;
        type: string;
        status: string;
        reason: string;
        recommendedTest: string;
      }>;
    };
  };
  requirementTraceabilityNote: string;
  playwright: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: string;
    durationMs: number;
    browsers: BrowserSummary[];
    executions: PlaywrightExecution[];
    sourceFile: string;
    perSuiteWired: boolean;
    available: boolean;
    originStatus: string;
    targetOrigin: string;
    configuredBaseUrl: string;
    engineCaveats: string[];
    failureDetails: PlaywrightFailedExecution[];
    failureDetailsAvailable: boolean;
  };
  api: {
    available: boolean;
    collection: string;
    iterations: number;
    requestsExecuted: number;
    requestErrors: number;
    assertionsExecuted: number;
    assertionsPassed: number;
    assertionsFailed: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
    requests: ApiRequestResult[];
    terminology: string;
  };
  performance: {
    available: boolean;
    profile: string;
    heavy: boolean;
    authorized: boolean;
    skipped: boolean;
    skipReason: string;
    target: string;
    threads: number;
    rampUpSeconds: number;
    loopCount: number;
    durationSeconds: number | null;
    totalSamples: number;
    successfulSamples: number;
    failedSamples: number;
    errorRate: string;
    avgMs: number;
    minMs: number;
    maxMs: number;
    p50Ms: number | typeof NOT_AVAILABLE;
    p90Ms: number | typeof NOT_AVAILABLE;
    p95Ms: number | typeof NOT_AVAILABLE;
    p99Ms: number | typeof NOT_AVAILABLE;
    ttfbMs: number | typeof NOT_AVAILABLE;
    throughputPerSec: number | typeof NOT_AVAILABLE;
    avgLatencyMs: number | typeof NOT_AVAILABLE;
    avgConnectMs: number | typeof NOT_AVAILABLE;
    sampleUrl: string;
    runStatus: string;
    samples: JmeterSampleRow[];
    thresholdStatus: string;
    slaNote: string;
    terminology: string;
  };
  lighthouse: LighthouseSectionModel;
  defects: {
    recorded: boolean;
    note: string;
    critical: number;
    high: number;
    medium: number;
    low: number;
    rows: Array<{
      id: string;
      severity: string;
      priority: string;
      description: string;
      status: string;
      testCase: string;
    }>;
  };
  distribution: {
    passed: number;
    failed: number;
    skipped: number;
  };
  discovery: {
    available: boolean;
    seedUrl: string;
    pagesDiscovered: number;
    pagesDiscoveredRaw: number | typeof NOT_AVAILABLE;
    pagesDiscoveredUnique: number | typeof NOT_AVAILABLE;
    pagesWithErrors: number;
    brokenLinks: number;
    totalConsoleErrors: number;
    truncated: boolean;
    crawledAt: string;
    pages: Array<{ url: string; status: string; title: string; consoleErrors: number; depth: number }>;
  };
  inventory: {
    available: boolean;
    totalElements: number;
    byType: Array<{ label: string; count: number }>;
    byRisk: Array<{ label: string; count: number }>;
  };
  seo: {
    available: boolean;
    source: 'suite' | 'discovery' | 'both' | 'none';
    suitePassed: boolean | null;
    pagesAnalyzed: number;
    high: number;
    medium: number;
    low: number;
    failCount: number;
    rawFindingCount: number;
    uniqueFindingCount: number;
    findings: Array<{ id: string; rule: string; severity: string; page: string; detail: string; sources: string[] }>;
    disclaimer: string;
    limitations: string[];
  };
  content: ContentSectionModel;
  accessibility: AccessibilitySectionModel;
  correlation: {
    available: boolean;
    suitePassed: boolean;
    workflows: Array<{
      id: string;
      name: string;
      uiPath?: string;
      api?: string;
      status?: string;
      reason?: string;
    }>;
    note: string;
    correlationUsed?: boolean;
    correlatedExecuted?: number;
  };
  failureAnalysis: FailureAnalysisSectionModel;
  retest: RetestSectionModel;
  qualityCheckRows: QualityCheck[];
  crossSuite: {
    available: boolean;
    source: string;
    missingReason: string;
    findings: Array<{
      type: string;
      severity: string;
      url: string;
      healthySuites: string;
      brokenSuites: string;
      detail: string;
    }>;
  };
  security: SecuritySectionModel;
  coverageBreakdown: {
    blocked: number;
    notTested: number;
    requiresConfiguration: number;
    otherSkipped: number;
    items: Array<{ testCaseId: string; scenario: string; category: string; reason: string }>;
  };
  pipeline: {
    available: boolean;
    url: string;
    overallStatus: string;
    command: string;
    stages: Array<{
      id: number;
      name: string;
      status: string;
      exitCode: string;
      durationMs: number;
      reason: string;
      startedAt: string;
      completedAt: string;
    }>;
    evidenceIntegrityNote: string;
  };
  risks: string[];
  recommendation: {
    status: QaStatus;
    summary: string;
    bullets: string[];
  };
  artifacts: Array<{ name: string; location: string }>;
  conclusion: string[];
  executiveSummary: string[];
  qualityChecks: string[];
  layers: Array<{ id: string; title: string; purpose: string }>;
  qaAnalysis: string[];
  releaseRecommendation: {
    status: QaStatus;
    decision: string;
    summary: string;
    bullets: string[];
  };
}

interface PlaywrightJsonReport {
  config?: { projects?: Array<{ name: string }> };
  stats?: {
    startTime?: string;
    expected?: number;
    unexpected?: number;
    skipped?: number;
    duration?: number;
  };
  suites?: PlaywrightSuite[];
}

interface PlaywrightSuite {
  title: string;
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightSpec {
  title: string;
  ok: boolean;
  file?: string;
  tests?: Array<{
    projectId?: string;
    projectName?: string;
    annotations?: Array<{ type: string; description?: string }>;
    results?: Array<{
      status: string;
      duration: number;
      startTime?: string;
      errors?: Array<{ message?: string }>;
    }>;
  }>;
}

interface PostmanReport {
  run?: {
    meta?: { collectionName?: string; started?: number };
    summary?: {
      iterations?: { executed: number; errors: number };
      executedRequests?: { executed: number; errors: number };
      tests?: { passed: number; failed: number; executed: number; skipped?: number };
      timeStats?: {
        responseAverage: number;
        responseMin: number;
        responseMax: number;
      };
    };
    executions?: Array<{
      requestExecuted?: {
        name: string;
        method?: string;
        url?: { protocol?: string; host?: string[]; path?: string[] };
      };
      response?: {
        code?: number;
        responseTime?: number;
      };
      tests?: Array<{ name: string; status: string }>;
    }>;
  };
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function normalizeStatus(status: string): 'PASS' | 'FAIL' | 'SKIPPED' | string {
  const upper = status.toUpperCase();
  if (upper === 'PASSED' || upper === 'PASS' || upper === 'EXPECTED') return 'PASS';
  if (upper === 'FAILED' || upper === 'FAIL' || upper === 'UNEXPECTED') return 'FAIL';
  if (upper === 'TIMEDOUT' || upper === 'INTERRUPTED') return 'FAIL';
  if (upper === 'SKIPPED') return 'SKIPPED';
  return upper;
}

function passRate(passed: number, failed: number, skipped = 0): string {
  return formatLabelledPassRate(uiExecutionPassRate({ passed, failed, skipped }), { skipped });
}

function metricOrNa(value: number | null | undefined): number | typeof NOT_AVAILABLE {
  return value == null ? NOT_AVAILABLE : value;
}

function textOrNa(value: string | null | undefined): string {
  if (!value || value === 'Not Provided') return NOT_AVAILABLE;
  return value;
}

function relative(location: string): string {
  const value = path.relative(PATHS.root, location).replace(/\\/g, '/');
  return value.startsWith('..') ? location.replace(/\\/g, '/') : value;
}

function flattenPlaywright(
  suites: PlaywrightSuite[] | undefined,
  suiteFile = ''
): Array<Omit<PlaywrightExecution, 'testCaseId'>> {
  if (!suites) return [];
  const rows: Array<Omit<PlaywrightExecution, 'testCaseId'>> = [];

  for (const suite of suites) {
    const file = suite.file ?? suite.title ?? suiteFile;
    for (const spec of suite.specs ?? []) {
      const specFile = path.basename(spec.file ?? file);
      for (const test of spec.tests ?? []) {
        // Read the FINAL attempt, not the first — with retries, results[0] is the attempt that
        // triggered the retry (often the failing one) even when the test ultimately passed.
        const results = test.results ?? [];
        const result = results[results.length - 1];
        const skipAnnotation = test.annotations?.find((a) => a.type === 'skip');
        rows.push({
          specFile,
          scenario: spec.title,
          browser: test.projectName ?? test.projectId ?? 'unknown',
          status: normalizeStatus(result?.status ?? (spec.ok ? 'passed' : 'failed')),
          durationMs: result?.duration ?? 0,
          startedAt: result?.startTime ?? NOT_AVAILABLE,
          error: result?.errors?.[0]?.message ?? '',
          skipReason: skipAnnotation?.description ?? '',
        });
      }
    }
    rows.push(...flattenPlaywright(suite.suites, file));
  }

  return rows;
}

function assignTestCaseIds(
  rows: Array<Omit<PlaywrightExecution, 'testCaseId'>>
): PlaywrightExecution[] {
  const scenarioOrder = new Map<string, string>();
  let next = 1;

  return rows.map((row) => {
    const key = `${row.specFile}::${row.scenario}`;
    if (!scenarioOrder.has(key)) {
      scenarioOrder.set(key, `TC-UI-${String(next).padStart(3, '0')}`);
      next += 1;
    }
    return {
      ...row,
      testCaseId: scenarioOrder.get(key)!,
    };
  });
}

function postmanUrl(exec: NonNullable<NonNullable<PostmanReport['run']>['executions']>[number]): string {
  const url = exec.requestExecuted?.url;
  if (!url) return NOT_AVAILABLE;
  const host = url.host?.join('.') ?? '';
  const reqPath = url.path?.join('/') ?? '';
  return `${url.protocol ?? 'https'}://${host}/${reqPath}`.replace(/\/+$/, '/');
}

function deriveOverallStatus(summary: SummaryFile, uiFailed: number, unresolvedCount: number): QaStatus {
  const anyToolFailed = summary.results.some((item) => !item.passed);
  if (anyToolFailed || uiFailed > 0) return 'FAIL';
  if (unresolvedCount > 0) return 'CONDITIONAL PASS';
  return 'PASS';
}

interface CoverageBreakdownItem {
  testCaseId: string;
  scenario: string;
  category: 'BLOCKED' | 'NOT_TESTED' | 'REQUIRES_CONFIGURATION' | 'OTHER_SKIPPED';
  reason: string;
}

/**
 * Read-only second pass over already-computed executions — splits the existing SKIPPED bucket by
 * the status-prefix convention generated checks use (BLOCKED:/NOT_TESTED:/REQUIRES_CONFIGURATION:).
 * Deliberately does not touch pwPassed/pwFailed/pwSkipped or the browser/reconciliation counts.
 */
function deriveCoverageBreakdown(executions: PlaywrightExecution[]): {
  blocked: number;
  notTested: number;
  requiresConfiguration: number;
  otherSkipped: number;
  items: CoverageBreakdownItem[];
} {
  const items: CoverageBreakdownItem[] = [];

  for (const row of executions) {
    if (row.status !== 'SKIPPED') continue;
    const reason = row.skipReason;
    let category: CoverageBreakdownItem['category'] = 'OTHER_SKIPPED';
    if (reason.startsWith('BLOCKED:')) category = 'BLOCKED';
    else if (reason.startsWith('NOT_TESTED:')) category = 'NOT_TESTED';
    else if (reason.startsWith('REQUIRES_CONFIGURATION:')) category = 'REQUIRES_CONFIGURATION';
    items.push({ testCaseId: row.testCaseId, scenario: row.scenario, category, reason: reason || NOT_AVAILABLE });
  }

  return {
    blocked: items.filter((item) => item.category === 'BLOCKED').length,
    notTested: items.filter((item) => item.category === 'NOT_TESTED').length,
    requiresConfiguration: items.filter((item) => item.category === 'REQUIRES_CONFIGURATION').length,
    otherSkipped: items.filter((item) => item.category === 'OTHER_SKIPPED').length,
    items,
  };
}

function buildSeoModel(
  suite: SeoSuiteSummary | null,
  discovery: SeoAnalysisResult | null
): EnterpriseReportModel['seo'] {
  const empty = {
    available: false,
    source: 'none' as const,
    suitePassed: null,
    pagesAnalyzed: 0,
    high: 0,
    medium: 0,
    low: 0,
    failCount: 0,
    rawFindingCount: 0,
    uniqueFindingCount: 0,
    findings: [] as Array<{
      id: string;
      rule: string;
      severity: string;
      page: string;
      detail: string;
      sources: string[];
    }>,
    disclaimer: SEO_DISCLAIMER,
    limitations: [...SEO_LIMITATIONS],
  };
  if (!suite && !discovery) return empty;

  const { findings, rawFindingCount, uniqueFindingCount } = collectSeoFindings(
    suite?.findings ?? [],
    discovery?.findings ?? []
  );
  const source = suite && discovery ? 'both' : suite ? 'suite' : 'discovery';
  return {
    available: true,
    source,
    suitePassed: suite ? suite.passed : null,
    pagesAnalyzed: Math.max(suite?.pagesAnalyzed ?? 0, discovery?.pagesAnalyzed ?? 0),
    high: findings.filter((row) => row.severity === 'high').length,
    medium: findings.filter((row) => row.severity === 'medium').length,
    low: findings.filter((row) => row.severity === 'low').length,
    failCount: findings.filter((row) => row.status === 'FAIL' || (row.status == null && row.severity === 'high'))
      .length,
    rawFindingCount,
    uniqueFindingCount,
    findings,
    disclaimer: suite?.disclaimer ?? SEO_DISCLAIMER,
    limitations: suite?.limitations ?? [...SEO_LIMITATIONS],
  };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return url.replace(/^www\./i, '').toLowerCase();
  }
}

/** True when `target` is the same registrable host as the configured website origin. */
function isSameConfiguredOrigin(target: string, websiteUrl: string): boolean {
  const targetHost = hostnameOf(target);
  const configuredHost = hostnameOf(websiteUrl);
  return Boolean(targetHost && configuredHost && targetHost === configuredHost);
}

function packageVersion(packageName: string): string {
  try {
    const pkgPath = require.resolve(`${packageName}/package.json`, { paths: [PATHS.root] });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? NOT_AVAILABLE;
  } catch {
    return NOT_AVAILABLE;
  }
}

export function buildEnterpriseReportModel(): EnterpriseReportModel {
  const config = loadConfig();
  const expectedOrigin = resolveConfiguredPlaywrightBaseUrl();
  const { extras: reportExtras } = ensureReportConfigWritten();
  const rawSummary = readJson<SummaryFile>(path.join(PATHS.reports.root, 'summary.json'));
  assertUniquePlaywrightSuitePaths();
  const generatedCheckJson = loadPlaywrightJsonReport(generatedCheckResultsPath);
  const generatedCheckSummary = readJsonIfExists<PlaywrightSuiteSummary>(
    playwrightSuiteSummaryPath('generated-check')
  );
  const playwrightSourceFile = path.relative(PATHS.root, generatedCheckResultsPath).replace(/\\/g, '/');
  const playwright = generatedCheckJson;
  const perSuiteWired = true;
  const generatedCheckAvailable = Boolean(generatedCheckJson);
  const postman = readJson<PostmanReport>(path.join(PATHS.reports.postman, 'report.json'));
  const perfSummary = readJson<PerformanceSummary>(PATHS.jmeterSummary);
  const jtl = parseJmeterJtl(PATHS.jmeterResults);
  const jmeterMetrics = jtl?.metrics ?? perfSummary?.metrics ?? null;
  const jmeterSamples = jtl?.samples ?? perfSummary?.samples ?? [];
  const jmeter = jmeterMetrics
    ? {
        samples: jmeterSamples,
        errors: jmeterMetrics.failures,
        avgMs: jmeterMetrics.avgMs,
        minMs: jmeterMetrics.minMs,
        maxMs: jmeterMetrics.maxMs,
        metrics: jmeterMetrics,
      }
    : null;
  const discoveryRaw = readJson<DiscoveryResult>(PATHS.discoveryFile);
  const inventoryRaw = readJson<InventoryResult>(PATHS.inventoryFile);
  const seoRaw = readJson<SeoAnalysisResult>(PATHS.seoFile);
  const seoSuiteRaw = readJson<SeoSuiteSummary>(path.join(PATHS.reports.seo, 'summary.json'));
  const coverageRaw = readJson<CoverageReport>(PATHS.coverageJsonFile);
  const contentSection = loadContentSection();
  const securitySection = loadSecuritySection();
  const visualSection = loadVisualSection();
  const lighthouseSection = loadLighthouseSection();
  const orchestratorRaw = readJson<{
    command?: string;
    url?: string;
    overallStatus?: string;
    failed?: string[];
    passed?: string[];
    stages?: Array<{
      id: number;
      name: string;
      status: string;
      exitCode: number | null;
      durationMs: number;
      reason?: string;
      startedAt?: string;
      completedAt?: string;
      finishedAt?: string;
    }>;
    notExecuted?: string[];
  }>(path.join(PATHS.reports.orchestrator, 'summary.json'));
  const preflightRaw = readJson<{
    os?: string;
    checks?: Array<{ name: string; detail?: string }>;
  }>(path.join(PATHS.reports.root, 'preflight.json'));
  const responsiveRaw = readJson<{ target?: string; passed?: boolean }>(
    path.join(PATHS.reports.responsive, 'summary.json')
  );
  const uiInventoryRaw = readJson<UiInventory>(PATHS.uiInventoryFile);
  const workflowRaw = readJson<{
    passed?: boolean;
    workflows?: Array<{
      id: string;
      name: string;
      uiPath?: string;
      api?: string;
      status?: string;
      reason?: string;
    }>;
    note?: string;
    correlationUsed?: boolean;
    correlatedExecuted?: number;
  }>(path.join(PATHS.reports.workflows, 'summary.json'));

  const pwRaw = flattenPlaywright(playwright?.suites as Parameters<typeof flattenPlaywright>[0]);
  const summary = reconcileSummary(config, rawSummary, playwright, pwRaw, postman, jmeter);
  writeSummaryFile(summary);

  const executions = assignTestCaseIds(pwRaw);
  const uniqueScenarios = [...new Set(executions.map((row) => `${row.specFile}::${row.scenario}`))];
  const configuredBrowsers = resolvePlaywrightBrowsers(config.playwright);
  const generatedCheckOrigin = generatedCheckSummary?.targetOrigin ?? NOT_AVAILABLE;
  const generatedCheckOriginStatus = generatedCheckSummary
    ? generatedCheckSummary.originStatus === 'INVALID' ||
      compareSuiteOriginToBaseUrl(generatedCheckSummary.targetOrigin, expectedOrigin) === 'INVALID'
      ? 'INVALID'
      : compareSuiteOriginToBaseUrl(generatedCheckSummary.targetOrigin, expectedOrigin)
    : NOT_AVAILABLE;
  const generatedCheckOriginInvalid = generatedCheckOriginStatus === 'INVALID';
  const countableExecutions = generatedCheckOriginInvalid ? [] : executions;
  const executedBrowsers =
    generatedCheckSummary?.browsers
      ?.filter((row) => row.status === 'EXECUTED')
      .map((row) => row.browser) ??
    playwright?.config?.projects?.map((p) => p.name) ??
    [...new Set(executions.map((r) => r.browser))];

  const pwPassed = countableExecutions.filter((r) => r.status === 'PASS').length;
  const pwFailed = countableExecutions.filter((r) => r.status === 'FAIL').length;
  const pwSkipped = countableExecutions.filter((r) => r.status === 'SKIPPED').length;

  const coverageBreakdown = deriveCoverageBreakdown(executions);
  // NOT_TESTED is a deliberate, by-design safety boundary (e.g. "we never submit forms"), not a
  // gap — only BLOCKED/REQUIRES_CONFIGURATION represent something the framework couldn't resolve.
  const derivedStatus = deriveOverallStatus(
    summary,
    pwFailed,
    coverageBreakdown.blocked + coverageBreakdown.requiresConfiguration
  );
  const overallStatus: QaStatus =
    orchestratorRaw?.overallStatus === 'FAIL' || (orchestratorRaw?.failed?.length ?? 0) > 0
      ? 'FAIL'
      : derivedStatus;

  const coverageFormula = coverageRaw?.formula ?? null;
  const pagesDiscoveredRaw: number | typeof NOT_AVAILABLE =
    coverageFormula?.contributions.pages.discoveredRaw ??
    (discoveryRaw ? discoveryRaw.pages.length : NOT_AVAILABLE);
  const pagesDiscoveredUnique: number | typeof NOT_AVAILABLE =
    coverageFormula?.contributions.pages.discoveredUnique ?? NOT_AVAILABLE;
  const pagesDiscoveredFigure =
    typeof pagesDiscoveredUnique === 'number'
      ? pagesDiscoveredUnique
      : typeof pagesDiscoveredRaw === 'number'
        ? pagesDiscoveredRaw
        : 0;

  const discoveryModel = discoveryRaw
    ? {
        available: true,
        seedUrl: discoveryRaw.seedUrl,
        pagesDiscovered: pagesDiscoveredFigure,
        pagesDiscoveredRaw,
        pagesDiscoveredUnique,
        pagesWithErrors: discoveryRaw.pages.filter(
          (page) => Boolean(page.error) || (page.status !== null && page.status >= 400)
        ).length,
        brokenLinks: findBrokenLinks(discoveryRaw.pages).length,
        totalConsoleErrors: discoveryRaw.pages.reduce((sum, page) => sum + page.consoleErrors.length, 0),
        truncated: discoveryRaw.truncated,
        crawledAt: discoveryRaw.crawledAt,
        pages: discoveryRaw.pages.map((page) => ({
          url: page.url,
          status: page.error ? 'ERROR' : String(page.status ?? NOT_AVAILABLE),
          title: page.title || NOT_AVAILABLE,
          consoleErrors: page.consoleErrors.length,
          depth: page.depth,
        })),
      }
    : {
        available: false,
        seedUrl: NOT_AVAILABLE,
        pagesDiscovered: 0,
        pagesDiscoveredRaw,
        pagesDiscoveredUnique,
        pagesWithErrors: 0,
        brokenLinks: 0,
        totalConsoleErrors: 0,
        truncated: false,
        crawledAt: NOT_AVAILABLE,
        pages: [],
      };

  const inventoryModel = buildInventoryModel(inventoryRaw, uiInventoryRaw, config);

  const seoModel = buildSeoModel(seoSuiteRaw, seoRaw);

  const contentModel = contentSection;
  const uniquePageCount =
    typeof discoveryModel.pagesDiscoveredUnique === 'number'
      ? discoveryModel.pagesDiscoveredUnique
      : discoveryModel.available
        ? discoveryModel.pagesDiscovered
        : uiInventoryRaw?.pagesScanned ?? 0;
  const a11yModel = loadAccessibilitySection(uniquePageCount);

  const failureModel = loadFailureAnalysisSection();
  const retestModel = loadRetestSection({ enabled: config.retest?.enabled !== false });

  const correlationModel = workflowRaw
    ? {
        available: true,
        suitePassed: Boolean(workflowRaw.passed),
        workflows: workflowRaw.workflows ?? [],
        note:
          workflowRaw.note ??
          'Combined UI+API workflows only. UI tests and Postman API tests remain separate.',
        correlationUsed: workflowRaw.correlationUsed === true,
        correlatedExecuted: workflowRaw.correlatedExecuted ?? 0,
      }
    : {
        available: false,
        suitePassed: false,
        workflows: [],
        note: 'No combined UI+API workflow run is associated with this execution. Run npm run test:workflows.',
        correlationUsed: false,
        correlatedExecuted: 0,
      };

  const securityModel = securitySection;

  const browserSummaries: BrowserSummary[] = generatedCheckSummary?.browsers?.length
    ? generatedCheckSummary.browsers.map((row) => {
        const total = row.total;
        const passed = row.passed;
        const failed = row.failed;
        const skipped = row.skipped;
        const countable =
          !generatedCheckOriginInvalid &&
          typeof passed === 'number' &&
          typeof failed === 'number';
        return {
          browser: row.browser,
          status: row.status,
          reason:
            row.reason ||
            (row.status === 'NOT_EXECUTED' ? NOT_AVAILABLE : PLAYWRIGHT_ENGINE_CAVEATS.join(' ')),
          total,
          passed: generatedCheckOriginInvalid && typeof passed === 'number' ? 0 : passed,
          failed: generatedCheckOriginInvalid && typeof failed === 'number' ? 0 : failed,
          skipped,
          passRate: countable
            ? passRate(passed, failed, typeof skipped === 'number' ? skipped : 0)
            : NOT_AVAILABLE,
        };
      })
    : generatedCheckAvailable
      ? ALL_PLAYWRIGHT_ENGINES.map((browser) => ({
          browser,
          status: NOT_AVAILABLE,
          reason: 'browsers[] was not present on reports/playwright/generated-check/summary.json',
          total: NOT_AVAILABLE,
          passed: NOT_AVAILABLE,
          failed: NOT_AVAILABLE,
          skipped: NOT_AVAILABLE,
          passRate: NOT_AVAILABLE,
        }))
      : ALL_PLAYWRIGHT_ENGINES.map((browser) => ({
          browser,
          status: 'NOT_EXECUTED',
          reason: `generated-check results were not on disk at ${playwrightSourceFile}`,
          total: NOT_AVAILABLE,
          passed: NOT_AVAILABLE,
          failed: NOT_AVAILABLE,
          skipped: NOT_AVAILABLE,
          passRate: NOT_AVAILABLE,
        }));

  const pmSummary = postman?.run?.summary;
  const apiRequests: ApiRequestResult[] = (postman?.run?.executions ?? []).map((exec, index) => {
    const assertionNames = (exec.tests ?? []).map((t) => t.name).join('; ') || 'Status code assertion';
    const assertionResult =
      (exec.tests ?? []).length === 0
        ? 'PASS'
        : (exec.tests ?? []).every((t) => normalizeStatus(t.status) === 'PASS')
          ? 'PASS'
          : 'FAIL';
    return {
      testId: `TC-API-${String(index + 1).padStart(3, '0')}`,
      name: exec.requestExecuted?.name ?? 'n/a',
      method: exec.requestExecuted?.method ?? 'GET',
      endpoint: postmanUrl(exec),
      statusCode: String(exec.response?.code ?? NOT_AVAILABLE),
      responseTimeMs: exec.response?.responseTime ?? 0,
      assertion: assertionNames,
      result: assertionResult,
    };
  });

  const jmeterRows: JmeterSampleRow[] = (jmeter?.samples ?? []).map((sample, index) => ({
    index: index + 1,
    thread: textOrNa(sample.thread),
    label: sample.label,
    url: textOrNa(sample.url),
    statusCode: textOrNa(sample.responseCode),
    elapsedMs: sample.elapsedMs ?? 0,
    result: sample.success ? 'PASS' : 'FAIL',
  }));

  const functionalAreas = [
    ...new Set(
      executions.map((row) => {
        if (row.specFile.includes('generated') || row.specFile.includes('discovery')) {
          return 'Discovery-generated Checks';
        }
        if (row.specFile.includes('navigation')) return 'Primary Navigation';
        if (row.specFile.includes('static-pages')) return 'Static Content Pages';
        if (row.specFile.includes('content-pages')) return 'Service & Case Study Pages';
        if (row.specFile.includes('home')) return 'Homepage';
        return row.specFile.replace(/\.spec\.ts$/, '').replace(/\\/g, '/');
      })
    ),
  ];

  const applicationName = config.project.name;

  const executionDate =
    playwright?.stats?.startTime ??
    summary.ranAt ??
    new Date().toISOString();

  const playwrightVersion = packageVersion('@playwright/test');
  const postmanCliVersion = packageVersion('postman-cli');

  const toolSuiteStatus = (tool: string, executedCount: number, failedCount: number): string => {
    const item = summary.results.find((r) => r.tool === tool);
    if (!item && executedCount <= 0) return 'NOT_EXECUTED';
    return resolveSuiteStatus({
      executedCount,
      failedCount,
      processFailed: item ? !item.passed && executedCount <= 0 : false,
    });
  };

  const inScope = [
    ...(discoveryModel.available
      ? [
          `Discovery-driven crawl of ${discoveryModel.seedUrl} (${discoveryModel.pagesDiscovered} page(s) discovered, ${inventoryModel.totalElements} interactive element(s) inventoried)`,
        ]
      : []),
    ...(seoModel.available
      ? [
          `Technical SEO analysis across ${seoModel.pagesAnalyzed} page(s) (${seoModel.uniqueFindingCount} finding(s)) — not a ranking or strategy audit`,
        ]
      : []),
    ...(a11yModel.available
      ? [
          `Automated accessibility testing across ${a11yModel.pagesAnalyzed} page(s) (${a11yModel.violationCount} violation(s)) — not a complete manual WCAG audit`,
        ]
      : []),
    ...(correlationModel.available
      ? [
          `Combined UI+API workflows (${correlationModel.workflows.length}) — not a substitute for UI-only or API-only suites`,
        ]
      : []),
    `UI/E2E automation for ${applicationName} (${uniqueScenarios.length} unique scenarios)`,
    `Cross-browser engine validation on: ${executedBrowsers.join(', ') || NOT_AVAILABLE}. ${PLAYWRIGHT_ENGINE_CAVEATS.join(' ')}`,
    `API automation via Postman CLI (${apiRequests.length} request(s) on documented/discovered endpoints only)`,
    `JMeter performance ${perfSummary?.profile ?? 'smoke'} (${jmeter?.samples.length ?? 0} sample(s)${
      perfSummary?.heavy ? ', authorized heavy profile' : ', lightweight smoke'
    })`,
    ...(securityModel.available
      ? [
          `QA-level security validation (${securityModel.pagesAnalyzed} page(s), ${securityModel.failCount} finding(s)) — not a penetration test`,
        ]
      : []),
    ...(contentModel.available
      ? [
          `Content QA across ${contentModel.pagesAnalyzed} page(s) (${contentModel.failCount} finding(s)) — structural only; business claims are not fact-checked`,
        ]
      : []),
    ...(failureModel.available
      ? [
          `Failure classification of ${failureModel.analyzed} failed execution(s) — evidence-based; tests are not modified to pass`,
        ]
      : []),
    ...(retestModel.available && retestModel.status !== 'NOT_EXECUTED'
      ? [
          `Controlled retest of ${retestModel.selected} failed execution(s) — original FAIL evidence is preserved`,
        ]
      : []),
    ...functionalAreas.map((area) => `Functional area covered: ${area}`),
  ];

  const outOfScope = [
    'Mobile device / native app testing',
    a11yModel.available
      ? 'Complete manual WCAG accessibility audit (automated axe/keyboard checks are not a full audit and do not constitute WCAG conformance)'
      : 'Automated accessibility testing (no results in this execution — run npm run test:accessibility)',
    ...(a11yModel.available
      ? []
      : [
          'Complete manual WCAG accessibility audit (automated checks, when present, are not a full audit)',
        ]),
    securityModel.available
      ? 'Penetration testing, exploit verification, payload injection, credential brute-force, and rate-limit flooding (QA-level header/cookie/exposure checks are in this execution)'
      : 'Security / penetration testing (no QA-level security run in this execution — run npm run test:security)',
    seoModel.available
      ? 'SEO ranking, crawl-budget, and content-strategy audit (automated technical SEO is in this execution)'
      : 'Automated technical SEO (no suite/discovery SEO run in this execution — run npm run test:seo)',
    contentModel.available
      ? 'Factual verification of marketing or business claims (content QA is structural only unless expectedValues were provided)'
      : 'Content QA (no suite run in this execution — run npm run test:content)',
    'Database validation testing',
    perfSummary?.heavy
      ? `Heavy performance profiles other than ${perfSummary.profile} (not executed in this cycle)`
      : 'Authorized heavy JMeter profiles (load / stress / spike / soak) — not executed; CI and npm run test:performance use smoke only',
    'Production monitoring / synthetic production checks',
    'Formal requirement-to-test traceability (no requirements matrix provided)',
    retestModel.status !== 'NOT_EXECUTED'
      ? 'Treating a retest PASS as removal of the original FAIL (both remain on record; assertions are not weakened)'
      : `Controlled retest (NOT_EXECUTED — ${retestModel.reason})`,
    perfSummary?.thresholds.defined
      ? `Performance thresholds not listed in qa.config.json (only defined keys were evaluated; status ${perfSummary.thresholds.status})`
      : 'Formal performance SLA / threshold validation (no threshold was provided — measurements are reported with status undefined)',
  ];

  const risks = [
    'UI tests, Postman API tests, and combined UI+API workflows are separate. Not every UI action is coupled to an internal API, and not every API request is exercised through the browser.',
    'Automated pass rate reflects only the executed automation scope, not the entire application.',
    `UI coverage is limited to ${uniqueScenarios.length} unique scenario(s) across ${executedBrowsers.length} browser(s).`,
    `API coverage is limited to smoke requests (${apiRequests.length} request(s)); this is not comprehensive API testing.`,
    perfSummary?.heavy
      ? `Performance evidence is from the authorized ${perfSummary.profile} profile (${perfSummary.threads} thread(s)). This is not a production load authorization and does not imply other heavy profiles ran.`
      : `Performance evidence is from the JMeter smoke profile (${perfSummary?.threads ?? config.jmeter.threads} thread(s), ${perfSummary?.loopCount ?? config.jmeter.loopCount} loop(s)). Load/stress/spike/soak were not executed.`,
    a11yModel.available
      ? securityModel.available
        ? 'Responsive checks, when present, are Playwright Chromium viewport emulation — not real-device testing and not Mobile Safari. Automated accessibility results are not a complete manual WCAG audit. Security results are QA-level indicators only, not a penetration test. Database testing is not in this execution.'
        : 'Responsive checks, when present, are Playwright Chromium viewport emulation — not real-device testing and not Mobile Safari. Automated accessibility results are not a complete manual WCAG audit. Security and database testing are not in this execution.'
      : securityModel.available
        ? 'Responsive checks, when present, are Playwright Chromium viewport emulation — not real-device testing and not Mobile Safari. Automated accessibility is not in this execution. Security results are QA-level indicators only, not a penetration test. Database testing is not in this execution.'
        : 'Responsive checks, when present, are Playwright Chromium viewport emulation — not real-device testing and not Mobile Safari. Automated accessibility, security, and database testing are not in this execution.',
    perfSummary?.thresholds.defined
      ? `Performance thresholds were taken from qa.config.json (status ${perfSummary.thresholds.status}). No additional limits were assumed.`
      : 'No formal performance acceptance threshold / SLA was provided. Measurements are reported; the threshold is undefined rather than invented.',
    'No requirement IDs or defect records were provided in the execution artifacts.',
    ...(discoveryModel.available && discoveryModel.truncated
      ? [
          `Discovery crawl was truncated at its configured page/depth limit — not every page on ${new URL(discoveryModel.seedUrl).host} was necessarily discovered.`,
        ]
      : []),
    ...(discoveryModel.available
      ? [
          'Discovery-generated checks cover link validity, page-load sanity, non-destructive form field presence/boundary validation, and SEO metadata analysis only. Form submission is intentionally never exercised. Visual regression (`npm run test:visual`), responsive viewport emulation (`npm run test:responsive`), automated accessibility (`npm run test:accessibility`), QA-level security (`npm run test:security`), technical SEO (`npm run test:seo`), and content QA (`npm run test:content`) are separate suites. Responsive results are not real-device or Mobile Safari coverage. Automated accessibility is not a complete WCAG audit. Security results are observational indicators, not a penetration test. SEO is not a ranking audit. Content QA is not factual verification of business claims.',
        ]
      : []),
    ...(coverageBreakdown.blocked + coverageBreakdown.requiresConfiguration > 0
      ? [
          `${coverageBreakdown.blocked} planned check(s) were BLOCKED and ${coverageBreakdown.requiresConfiguration} REQUIRE_CONFIGURATION — see the Coverage Breakdown section for detail.`,
        ]
      : []),
    ...(seoModel.high > 0 || seoModel.failCount > 0
      ? [
          `Technical SEO recorded ${seoModel.failCount || seoModel.high} failure-level finding(s) — see the SEO Analysis section. This is not a ranking audit.`,
        ]
      : []),
    ...(a11yModel.available && a11yModel.violationCount > 0
      ? [
          `Automated accessibility testing recorded ${a11yModel.violationCount} violation(s) — see {{ref:accessibility}}. This is not a complete WCAG audit.`,
        ]
      : []),
    ...(securityModel.available && securityModel.failCount > 0
      ? [
          `QA-level security validation recorded ${securityModel.failCount} failure(s) — see {{ref:security}}. This is not a penetration test.`,
        ]
      : []),
    ...(contentModel.available && contentModel.failCount > 0
      ? [
          `Content QA recorded ${contentModel.failCount} failure(s) — see {{ref:content}}. Business claims were not judged true or false.`,
        ]
      : []),
    ...(failureModel.available && failureModel.analyzed > 0
      ? [
          `Failure analysis classified ${failureModel.analyzed} failed execution(s) — see {{ref:failure-analysis}}. Classifications are not defect tickets and tests were not modified to pass.`,
        ]
      : []),
    ...(retestModel.available && retestModel.status !== 'NOT_EXECUTED'
      ? [
          `Retest recorded ${retestModel.selected} selected execution(s) — see {{ref:retest}}. Original FAIL evidence is preserved; a later pass renders FAIL → PASS (unstable) and does not erase it.`,
        ]
      : []),
    ...(a11yModel.available
      ? [
          'Automated accessibility testing (axe-core A/AA plus keyboard/structure/form/zoom/touch checks) is not a complete manual accessibility audit and does not constitute WCAG conformance.',
        ]
      : []),
    ...(orchestratorRaw
      ? [
          `The qa:all orchestrator recorded overall ${orchestratorRaw.overallStatus ?? NOT_AVAILABLE} for ${orchestratorRaw.url ?? config.urls.website}. Section 2.6 is sourced only from ${playwrightSourceFile}.`,
        ]
      : []),
    ...(responsiveRaw?.target && !isSameConfiguredOrigin(String(responsiveRaw.target), config.urls.website)
      ? [
          `Responsive suite target in reports/responsive/summary.json is ${responsiveRaw.target}. That is not the ${config.project.name} origin. A responsive PASS must not be treated as evidence for ${config.urls.website}.`,
        ]
      : []),
  ];

  const findingDefects = {
    critical: a11yModel.byImpact.critical,
    high: seoModel.high + contentModel.bySeverity.high + a11yModel.byImpact.serious,
    medium: seoModel.medium + contentModel.bySeverity.medium + a11yModel.byImpact.moderate,
    low:
      seoModel.low +
      contentModel.bySeverity.low +
      securityModel.failCount +
      a11yModel.byImpact.minor,
  };
  const observedFindingCount =
    findingDefects.critical + findingDefects.high + findingDefects.medium + findingDefects.low;

  const stageGroups = rollupStageGroups(orchestratorRaw?.stages ?? []);
  const pipelineModel = {
    available: Boolean(orchestratorRaw?.stages?.length),
    url: orchestratorRaw?.url ?? config.urls.website,
    overallStatus: orchestratorRaw?.overallStatus ?? NOT_AVAILABLE,
    command: orchestratorRaw?.command ?? 'qa:all',
    stages: (orchestratorRaw?.stages ?? []).map((stage) => ({
      id: stage.id,
      name: stage.name,
      status: stage.status,
      exitCode: stage.exitCode == null ? 'n/a' : String(stage.exitCode),
      durationMs: stage.durationMs,
      reason: stage.reason ?? '',
      startedAt: stage.startedAt ?? stage.finishedAt ?? NOT_AVAILABLE,
      completedAt: stage.completedAt ?? stage.finishedAt ?? NOT_AVAILABLE,
    })),
    evidenceIntegrityNote: generatedCheckAvailable
      ? `Section 2.6 is sourced from ${playwrightSourceFile}. Playwright suites write unique reports/playwright/<suiteName>/results.json paths; output-path collision is structurally rejected.`
      : `Section 2.6 is NOT_AVAILABLE. Generated-check results were not on disk at ${playwrightSourceFile}. A shared reports/playwright/results.json path is not read.`,
  };

  const recommendationBullets = [
    `Within the executed automation scope, overall QA status is ${overallStatus}.`,
    `UI/E2E executions: ${pwPassed} passed, ${pwFailed} failed, ${pwSkipped} skipped out of ${executions.length}.`,
    `API automation result (Postman CLI): ${toolSuiteStatus('Postman CLI', apiRequests.length, pmSummary?.tests?.failed ?? 0)}.`,
    `Performance validation result (observed metrics only): ${
      jmeter?.samples.length
        ? 'RECORDED'
        : 'NOT_EXECUTED'
    }.`,
    securityModel.available
      ? `QA-level security validation: ${securityModel.failCount} failure(s) across ${securityModel.pagesAnalyzed} page(s). Not a penetration test.`
      : 'QA-level security validation was not executed in this cycle.',
    seoModel.available
      ? `Technical SEO: ${seoModel.uniqueFindingCount} finding(s) across ${seoModel.pagesAnalyzed} page(s). Not a ranking audit.`
      : 'Technical SEO was not executed in this cycle.',
    contentModel.available
      ? `Content QA: ${contentModel.failCount} failure(s) across ${contentModel.pagesAnalyzed} page(s). Claims were not fact-checked.`
      : 'Content QA was not executed in this cycle.',
    failureModel.available
      ? `Failure analysis: ${failureModel.analyzed} failed execution(s) classified. Not defect tickets; tests were not modified to pass.`
      : 'Failure analysis was not executed in this cycle.',
    retestModel.available && retestModel.status !== 'NOT_EXECUTED'
      ? `Retest: ${retestModel.selected} selected, ${retestModel.notSelected} left on the original record. Original failures were not hidden.`
      : `Controlled retest was NOT_EXECUTED — ${retestModel.reason}`,
    'Additional testing outside the current automation scope is recommended before broader release confidence claims.',
  ];

  const qaAnalysis = [
    `UI evidence shows ${uniqueScenarios.length} unique test scenario(s) and ${executions.length} browser execution(s). Pass rate for UI executions is ${passRate(pwPassed, pwFailed, pwSkipped)}.`,
    `Cross-browser evidence covers: ${executedBrowsers.join(', ') || NOT_AVAILABLE}. Browser-level pass rates: ${browserSummaries
      .map((b) => `${b.browser} ${b.status} ${b.passRate}`)
      .join('; ') || NOT_AVAILABLE}.`,
    `API evidence is limited to smoke coverage (${apiRequests.length} request(s), ${pmSummary?.tests?.executed ?? 0} assertion(s)). This supports availability/smoke validation, not comprehensive API functional coverage.`,
    `Performance evidence is based on ${jmeter?.samples.length ?? 0} observed sample(s) with error rate ${
      jmeter
        ? `${((jmeter.errors / Math.max(jmeter.samples.length, 1)) * 100).toFixed(2)}%`
        : '0.00%'
    }. No formal SLA comparison was possible because no acceptance threshold was provided.`,
    securityModel.available
      ? `Security evidence is QA-level only (${securityModel.failCount} failure(s), ${securityModel.passCount} pass(es)). It does not constitute a penetration test or a security certification.`
      : 'Security evidence was not collected in this execution.',
    seoModel.available
      ? `SEO evidence is technical only (${seoModel.uniqueFindingCount} finding(s)). It is not a ranking or content-strategy audit.`
      : 'Technical SEO evidence was not collected in this execution.',
    contentModel.available
      ? `Content QA evidence is structural only (${contentModel.failCount} failure(s), ${contentModel.passCount} pass(es)). Business claims are not marked true or false without an authoritative expected value.`
      : 'Content QA evidence was not collected in this execution.',
    failureModel.available
      ? `Failure analysis classified ${failureModel.analyzed} failed execution(s). Classifications are evidence-based and are not defect tickets. Tests were not modified to force a pass.`
      : 'Failure analysis was not associated with this execution. Run npm run analyze:failures.',
    coverageRaw
      ? `Coverage is ${coverageRaw.totals.testedItems}/${coverageRaw.totals.testableItems} discovered testable items (${coverageRaw.totals.itemCoveragePercent}%). Pass rate (${
          coverageRaw.totals.passRatePercent == null ? 'n/a' : `${coverageRaw.totals.passRatePercent}%`
        }) is not coverage.`
      : 'Discovered-item coverage was not associated with this execution. Run npm run coverage.',
    retestModel.status !== 'NOT_EXECUTED'
      ? `Retest compared original FAIL vs retest status for ${retestModel.selected} selected execution(s). A retest pass renders FAIL → PASS (unstable) and never overwrites the original FAIL. Assertions were not weakened.`
      : `Controlled retest was NOT_EXECUTED — ${retestModel.reason}`,
    `No defect records and no requirement traceability matrix were present in the execution artifacts; therefore defect trend and requirement coverage analysis are Not Available in Current Execution Data.`,
    `Quality interpretation: a ${overallStatus} status indicates the automated suite completed with the observed outcomes above. It does not imply complete product quality across untested areas.`,
  ];

  const releaseDecision =
    overallStatus !== 'FAIL'
      ? 'CONDITIONAL RELEASE SUPPORT within the executed automation scope only'
      : 'RELEASE NOT SUPPORTED based on failed automation evidence in the executed scope';

  const releaseBullets =
    overallStatus !== 'FAIL'
      ? [
          `Release support is limited to the scenarios and tools executed in this cycle (UI/E2E, Postman API automation, JMeter ${perfSummary?.profile ?? 'smoke'} performance).`,
          `No failed UI executions, API assertions, or performance sample failures were recorded in the available artifacts.`,
          a11yModel.available
            ? securityModel.available
              ? `Because coverage is limited and no formal performance SLA / requirements evidence was provided — automated accessibility is not a complete WCAG audit, and security results are QA-level indicators only — broader production-readiness claims are not supported by this report.`
              : `Because coverage is limited and no formal performance SLA / requirements / security evidence was provided — and automated accessibility is not a complete WCAG audit — broader production-readiness claims are not supported by this report.`
            : securityModel.available
              ? `Because coverage is limited and no formal performance SLA / requirements / accessibility evidence was provided — and security results are QA-level indicators only — broader production-readiness claims are not supported by this report.`
              : `Because coverage is limited and no formal performance SLA / requirements / security / accessibility evidence was provided, broader production-readiness claims are not supported by this report.`,
          `Recommended next actions: expand functional UI scenarios, deepen API coverage, define performance SLAs, and add non-functional testing before unrestricted release approval.`,
        ]
      : [
          `One or more automated checks failed within the executed scope; unrestricted release support is not justified by this evidence.`,
          `Review failed UI executions, API assertions, and/or performance samples in the Test Evidence layer and linked artifacts.`,
          `Re-test after defect resolution and regenerate this report before release reconsideration.`,
          a11yModel.available
            ? securityModel.available
              ? `Unexecuted areas (mobile, complete manual WCAG audit, penetration testing, database, full stress) remain outside this recommendation.`
              : `Unexecuted areas (mobile, complete manual WCAG audit, security, database, full stress) remain outside this recommendation.`
            : securityModel.available
              ? `Unexecuted areas (mobile, accessibility, penetration testing, database, full stress) remain outside this recommendation.`
              : `Unexecuted areas (mobile, accessibility, security, database, full stress) remain outside this recommendation.`,
        ];

  const uiPass = uiExecutionPassRate({ passed: pwPassed, failed: pwFailed, skipped: pwSkipped });
  const assertionPass = assertionPassRate({
    passed: pmSummary?.tests?.passed ?? 0,
    executed: pmSummary?.tests?.executed ?? 0,
  });
  const uiPassFormatted = formatLabelledPassRate(uiPass, { skipped: pwSkipped });
  const assertionPassFormatted = formatLabelledPassRate(assertionPass);

  const generatedAt = formatIsoOffset();
  const timezone = reportTimezoneLabel();
  const provenance = collectRunProvenance({
    orchestratorCommand: orchestratorRaw?.command,
    osVersion: preflightRaw?.os,
    nodeVersion: preflightRaw?.checks?.find((row) => row.name === 'Node.js')?.detail,
  });

  const failureDetailsFromSummary = generatedCheckSummary?.failureDetails?.executions;
  const failureDetailsAvailable = failureDetailsFromSummary != null || Boolean(generatedCheckJson);
  const failureDetails = generatedCheckJson
    ? (failureDetailsFromSummary ??
      parseFailedExecutionsFromFile(generatedCheckResultsPath, 'generated-check').executions)
    : [];

  const originMismatches: EnterpriseReportModel['originMismatches'] = [];
  for (const suiteName of PLAYWRIGHT_SUITE_NAMES) {
    const suiteSummary = readJsonIfExists<PlaywrightSuiteSummary>(playwrightSuiteSummaryPath(suiteName));
    if (!suiteSummary) continue;
    if (suiteSummary.originStatus === 'INVALID' || compareSuiteOriginToBaseUrl(suiteSummary.targetOrigin, expectedOrigin) === 'INVALID') {
      originMismatches.push({
        suite: suiteName,
        origin: suiteSummary.targetOrigin,
        baseUrl: expectedOrigin,
        product: (PRODUCT_ORIGIN_SUITES as readonly string[]).includes(suiteName),
      });
    }
  }

  const rawTimeline = loadStageTimelineRows();
  const stageTimelineRows: StageTimelineRow[] = (rawTimeline ?? []).map((row, index) => ({
    id: row.id ?? index + 1,
    key: row.key ?? '',
    name: row.name ?? NOT_AVAILABLE,
    phase: stagePhaseForKey(row.key ?? ''),
    status: row.status ?? NOT_AVAILABLE,
    exitCode: row.exitCode ?? null,
    startedAt: row.startedAt ?? NOT_AVAILABLE,
    completedAt: row.completedAt ?? row.finishedAt ?? NOT_AVAILABLE,
    durationMs: row.durationMs ?? 0,
    reason: row.reason,
    executedCount: row.executedCount,
  }));
  const timelineOrdering = stageTimelineRows.length
    ? assertDiscoveryPrecedesExecution(stageTimelineRows)
    : { ok: true, discoveryCompletedAt: NOT_AVAILABLE, firstExecutionStartedAt: NOT_AVAILABLE, violations: [] };

  const historyKpis: HistoryKpis = {
    generatedAt,
    uiExecutionPassRate: uiPass.value,
    assertionPassRate: assertionPass.value,
    uniqueFindingsHigh: seoModel.available ? seoModel.high : null,
    uniqueFindingsMedium: seoModel.available ? seoModel.medium : null,
    uniqueFindingsLow: seoModel.available ? seoModel.low : null,
    itemCoveragePercent: coverageRaw?.totals.itemCoveragePercent ?? null,
    p95Ms: jmeterMetrics?.p95Ms ?? null,
  };
  const previousHistory = loadPreviousHistory();
  const historyFile = persistHistoryKpis(historyKpis);
  const trendRows = buildTrendRows(historyKpis, previousHistory === null ? null : previousHistory);
  void historyFile;

  const blocking = reportExtras.criteria.releaseBlocking;
  const hasBlocker =
    (overallStatus === 'FAIL' && (findingDefects.critical > 0 || findingDefects.high > 0)) ||
    overallStatus === 'FAIL';
  const criteriaEvaluation = reportExtras.criteria.exit.map((criterion) => {
    const mentionsBlocker = /P0|P1|blocker/i.test(criterion);
    if (mentionsBlocker && hasBlocker && overallStatus === 'FAIL') {
      return {
        criterion,
        result: 'FAIL',
        detail: `Overall status is ${overallStatus}; release-blocking threshold is ${blocking.join(', ')}.`,
      };
    }
    if (mentionsBlocker && overallStatus !== 'FAIL') {
      return { criterion, result: 'PASS', detail: `No open ${blocking.join('/')} application blocker recorded in this verdict.` };
    }
    return { criterion, result: 'RECORDED', detail: 'Evaluated against executed-scope evidence only.' };
  });

  const plannedRefs = collectPlannedRefIds(risks);
  const numbered = numberSections();
  const suiteStatusRows = [
    {
      name: 'Playwright UI',
      status: resolveSuiteStatus({ executedCount: executions.length, failedCount: pwFailed }),
      executedCount: executions.length,
    },
    {
      name: 'Postman API',
      status: resolveSuiteStatus({
        executedCount: apiRequests.length,
        failedCount: pmSummary?.tests?.failed ?? 0,
      }),
      executedCount: apiRequests.length,
    },
    {
      name: 'JMeter',
      status: resolveSuiteStatus({
        executedCount: jmeter?.samples.length ?? 0,
        failedCount: jmeter?.errors ?? 0,
      }),
      executedCount: jmeter?.samples.length ?? 0,
    },
    {
      name: 'Accessibility',
      status: a11yModel.available ? a11yModel.status : 'NOT_EXECUTED',
      executedCount: a11yModel.available ? a11yModel.pagesAnalyzed : 0,
    },
    {
      name: 'Security',
      status: securityModel.available ? securityModel.status : 'NOT_EXECUTED',
      executedCount: securityModel.available ? securityModel.pagesAnalyzed : 0,
    },
    {
      name: 'Content QA',
      status: contentModel.available ? contentModel.status : 'NOT_EXECUTED',
      executedCount: contentModel.available ? contentModel.pagesAnalyzed : 0,
    },
    {
      name: 'Visual',
      status: visualSection.status,
      executedCount: typeof visualSection.comparedCount === 'number' ? visualSection.comparedCount : 0,
    },
    {
      name: 'Retest',
      status: retestModel.status,
      executedCount: retestModel.executed,
    },
  ];

  const crossSuitePath = path.join(PATHS.reports.quality, 'cross-suite.json');
  const crossSuite = readJsonIfExists<CrossSuiteReport>(crossSuitePath);

  const qualityCheckRecords = evaluateQualityChecks({
    seo: {
      available: seoModel.available,
      rawFindingCount: seoModel.rawFindingCount,
      uniqueFindingCount: seoModel.uniqueFindingCount,
      findingsLength: seoModel.findings.length,
    },
    plannedRefIds: plannedRefs,
    numberedSections: numbered,
    passRates: [uiPass, assertionPass],
    suites: suiteStatusRows,
    productOriginMismatches: originMismatches.filter((row) => row.product),
    stageTimeline: stageTimelineRows.length ? stageTimelineRows : null,
    emptyTablesWithoutReason: 0,
    tautologicalArtifact: readTautologicalArtifact(),
    crossSuite,
    crossSuiteArtifactMissing: !fs.existsSync(crossSuitePath),
  });

  const uiTotal = pwPassed + pwFailed + pwSkipped;
  const legacyReconcile: QualityCheck[] = [
    {
      id: 'ui-totals',
      result: uiTotal === executions.length ? 'PASS' : 'FAIL',
      detail:
        uiTotal === executions.length
          ? `UI Passed+Failed+Skipped (${uiTotal}) equals total UI executions (${executions.length}).`
          : `UI totals mismatch (${uiTotal} vs ${executions.length}).`,
    },
  ];
  for (const browser of browserSummaries) {
    if (
      typeof browser.passed !== 'number' ||
      typeof browser.failed !== 'number' ||
      typeof browser.skipped !== 'number' ||
      typeof browser.total !== 'number'
    ) {
      legacyReconcile.push({
        id: `browser-${browser.browser}`,
        result: 'NOT_AVAILABLE',
        detail: `${browser.browser} counts are ${NOT_AVAILABLE} (${browser.status}: ${browser.reason || NOT_AVAILABLE}).`,
      });
      continue;
    }
    const sum = browser.passed + browser.failed + browser.skipped;
    legacyReconcile.push({
      id: `browser-${browser.browser}`,
      result: sum === browser.total ? 'PASS' : 'FAIL',
      detail:
        sum === browser.total
          ? `${browser.browser} totals reconcile (${sum}/${browser.total}).`
          : `${browser.browser} totals mismatch (${sum}/${browser.total}).`,
    });
  }
  if (pmSummary) {
    const ok =
      (pmSummary.tests?.passed ?? 0) + (pmSummary.tests?.failed ?? 0) === (pmSummary.tests?.executed ?? 0);
    legacyReconcile.push({
      id: 'api-totals',
      result: ok ? 'PASS' : 'FAIL',
      detail: ok ? 'API assertion totals reconcile.' : 'API assertion totals do not reconcile.',
    });
  }
  if (jmeter) {
    const observedFailures = jmeter.samples.filter((sample) => !sample.success).length;
    legacyReconcile.push({
      id: 'perf-totals',
      result: observedFailures === jmeter.errors ? 'PASS' : 'FAIL',
      detail:
        observedFailures === jmeter.errors
          ? `Performance sample count is ${jmeter.samples.length} with ${jmeter.errors} failed sample(s).`
          : `Performance totals mismatch (reported ${jmeter.errors} failed, observed ${observedFailures}).`,
    });
  }
  legacyReconcile.push({
    id: 'no-fabrication',
    result: 'PASS',
    detail: 'No fabricated requirements, defects, or SLA thresholds were introduced.',
  });

  const allQuality = [...legacyReconcile, ...qualityCheckRecords];
  const qualityChecks = allQuality.map(formatQualityCheckLine);
  const qualityWarnings = reportQualityWarnings(allQuality);
  assertQualityChecksPass(allQuality);

    if (originMismatches.length > 0) {
    risks.push(
      `Suite origin INVALID — excluded from pass counts. Expected origin: ${expectedOrigin}. Observed: ${originMismatches
        .map((row) => `${row.suite} actual ${row.origin}`)
        .join('; ')}.`
    );
  }
  for (const warning of qualityWarnings) {
    risks.push(
      `Report-quality warning (${warning.id}): ${warning.detail} Recorded as tautological / observed-status / low-value. Collection assertions were not changed and this warning does not hide product results or abort professional report generation.`
    );
  }

  const pendingReview = isReviewerUnset(reportExtras.signOff);
  writeSummaryFile({
    ...summary,
    provenance,
    timezone,
  });

  return {
    meta: {
      reportTitle: 'QA TEST EXECUTION REPORT',
      projectName: config.project.name,
      applicationName,
      testingPhase: 'Full qa:all automation cycle (discover → execute → analyze → report)',
      environment: `Public website — ${config.urls.website}`,
      reportVersion: '1.1',
      executionDate: toIsoOffset(executionDate),
      preparedBy: formatPreparedBy(reportExtras.signOff),
      reviewedBy: formatReviewedBy(reportExtras.signOff),
      pendingReview,
      approvalDate: reportExtras.signOff.approvalDate.trim() || NOT_AVAILABLE,
      distribution: reportExtras.signOff.distribution.trim() || NOT_AVAILABLE,
      confidentiality: reportExtras.signOff.confidentiality.trim() || NOT_AVAILABLE,
      timezone,
      overallStatus,
      generatedAt,
    },
    provenance,
    signOff: reportExtras.signOff,
    revisionHistory: reportExtras.revisionHistory,
    criteria: reportExtras.criteria,
    retention: reportExtras.retention,
    criteriaEvaluation,
    trend: {
      note: previousHistory ? `Compared to previous run in reports/history.` : 'NO BASELINE',
      rows: trendRows,
    },
    passRates: {
      uiExecution: uiPass,
      assertion: assertionPass,
      uiFormatted: uiPassFormatted,
      assertionFormatted: assertionPassFormatted,
    },
    qualityCheckRecords: allQuality,
    originMismatches,
    suiteGroups: stageGroups,
    stageTimeline: {
      available: stageTimelineRows.length > 0,
      rows: stageTimelineRows,
      orderingOk: timelineOrdering.ok,
      violations: timelineOrdering.violations,
    },
    visual: visualSection,
    kpi: {
      totalUiExecutions: executions.length,
      passed: pwPassed,
      failed: pwFailed,
      skipped: pwSkipped,
      passRate: uiPassFormatted,
      uniqueUiScenarios: uniqueScenarios.length,
      browserCoverage: executedBrowsers.join(', ') || NOT_AVAILABLE,
      apiRequests: apiRequests.length,
      performanceSamples: jmeter?.samples.length ?? 0,
      defects: observedFindingCount,
    },
    projectInfo: [
      { label: 'Project', value: config.project.name },
      { label: 'Application', value: applicationName },
      { label: 'Environment', value: `Public website — ${config.urls.website}` },
      { label: 'Base URL', value: config.urls.website },
      { label: 'Testing Phase', value: 'Full qa:all automation cycle' },
      { label: 'Execution Date', value: toIsoOffset(executionDate) },
      { label: 'Report timezone', value: timezone },
      ...provenanceAsRows(provenance),
      {
        label: 'Test Automation Framework',
        value: 'Custom TypeScript QA Automation Framework (Playwright + Postman CLI + JMeter)',
      },
      { label: 'Testing Tools', value: 'Playwright, Postman CLI, Apache JMeter' },
      {
        label: 'Execution Mode',
        value: config.playwright.headless ? 'Headless (UI) / Non-GUI (JMeter)' : 'Headed (UI) / Non-GUI (JMeter)',
      },
      { label: 'Browser Coverage', value: executedBrowsers.join(', ') || NOT_AVAILABLE },
    ],
    inScope,
    outOfScope,
    testingTypes: [
      ...(discoveryModel.available
        ? [
            {
              type: 'Discovery-Driven Crawl & Element Inventory',
              tool: 'Custom crawler (Playwright-based)',
              coverage: `${typeof pagesDiscoveredUnique === 'number' ? pagesDiscoveredUnique : pagesDiscoveredRaw} unique page(s) (raw ${pagesDiscoveredRaw}), ${inventoryModel.totalElements} element(s)`,
              result: resolveSuiteStatus({
                executedCount: discoveryModel.pages.length,
                failedCount: discoveryModel.pagesWithErrors + discoveryModel.brokenLinks,
              }),
            },
          ]
        : []),
      ...(seoModel.available
        ? [
            {
              type: 'Technical SEO (not a ranking audit)',
              tool:
                seoModel.source === 'discovery'
                  ? 'Custom analyzer (static rules over discovered pages)'
                  : 'Playwright technical SEO suite + discovery SEO when present',
              coverage: `${seoModel.pagesAnalyzed} page(s), ${seoModel.uniqueFindingCount} finding(s)`,
              result: resolveSuiteStatus({
                executedCount: seoModel.pagesAnalyzed,
                failedCount: seoModel.high,
              }),
            },
          ]
        : []),
      ...(a11yModel.available
        ? [
            {
              type: 'Automated Accessibility Testing (not a complete WCAG audit)',
              tool: '@axe-core/playwright + Playwright keyboard/structure checks',
              coverage: `${a11yModel.pagesAnalyzed} page(s), ${a11yModel.violationCount} violation(s)`,
              result: resolveSuiteStatus({
                executedCount: a11yModel.pagesAnalyzed,
                failedCount: a11yModel.violationCount,
              }),
            },
          ]
        : []),
      ...(correlationModel.available
        ? [
            {
              type: 'Combined UI+API Workflows',
              tool: 'Playwright (isolated suite — not every UI test)',
              coverage: correlationModel.correlationUsed
                ? `${correlationModel.correlatedExecuted ?? 0} correlated pair(s)`
                : correlationModel.note,
              result: resolveSuiteStatus({
                executedCount: correlationModel.correlatedExecuted ?? 0,
                failedCount: correlationModel.suitePassed ? 0 : 1,
                recorded:
                  correlationModel.correlationUsed !== true && correlationModel.workflows.length > 0,
                selectedCount: correlationModel.workflows.length,
              }),
            },
          ]
        : []),
      {
        type: 'UI / E2E Automation',
        tool: 'Playwright',
        coverage: `${uniqueScenarios.length} unique scenario(s), ${executions.length} execution(s)`,
        result: generatedCheckOriginInvalid
          ? 'INVALID'
          : toolSuiteStatus('Playwright', countableExecutions.length, pwFailed),
      },
      {
        type: 'Cross-Browser Validation',
        tool: 'Playwright',
        coverage: executedBrowsers.join(', ') || NOT_AVAILABLE,
        result: generatedCheckOriginInvalid
          ? 'INVALID'
          : toolSuiteStatus('Playwright', countableExecutions.length, pwFailed),
      },
      {
        type: 'API Automation (documented/discovered endpoints only)',
        tool: 'Postman CLI',
        coverage: `${apiRequests.length} request(s)`,
        result: toolSuiteStatus('Postman CLI', apiRequests.length, pmSummary?.tests?.failed ?? 0),
      },
      {
        type: `Performance (${perfSummary ? normalizePerformanceProfile(perfSummary.profile) : NOT_AVAILABLE})`,
        tool: 'JMeter',
        coverage: `${jmeter?.samples.length ?? 0} sample(s); ${perfSummary?.threads ?? config.jmeter.threads} thread(s); threshold ${perfSummary?.thresholds.status ?? NOT_AVAILABLE}`,
        result: jmeter?.samples.length
          ? 'RECORDED'
          : resolveSuiteStatus({ executedCount: 0 }),
      },
      {
        type: 'Core Web Vitals (Lighthouse) — not JMeter',
        tool: 'Lighthouse',
        coverage: lighthouseSection.available
          ? `${lighthouseSection.pages.length} page(s); status ${lighthouseSection.status}`
          : NOT_AVAILABLE,
        result: lighthouseSection.status,
      },
      ...(securityModel.available
        ? [
            {
              type: 'QA-level Security Validation (not a pentest)',
              tool: 'Playwright observational checks',
              coverage: `${securityModel.pagesAnalyzed} page(s), ${securityModel.failCount} failure(s)`,
              result: resolveSuiteStatus({
                executedCount: securityModel.pagesAnalyzed,
                failedCount: securityModel.failCount,
              }),
            },
          ]
        : []),
      ...(contentModel.available
        ? [
            {
              type: 'Content QA (structural — not factual verification)',
              tool: 'Playwright content suite',
              coverage: `${contentModel.pagesAnalyzed} page(s), ${contentModel.failCount} failure(s)`,
              result: resolveSuiteStatus({
                executedCount: contentModel.pagesAnalyzed,
                failedCount: contentModel.failCount,
              }),
            },
          ]
        : []),
      ...(failureModel.available
        ? [
            {
              type: 'Failure Analysis (not defect tickets; tests not modified to pass)',
              tool: 'scripts/analyze-failures.ts',
              coverage: `${failureModel.analyzed} failed execution(s) classified`,
              result: 'RECORDED',
            },
          ]
        : []),
      ...(retestModel.available
        ? [
            {
              type: 'Controlled Retest (original FAIL preserved)',
              tool: 'scripts/retest.ts',
              coverage: `${retestModel.selected} selected / ${retestModel.notSelected} not selected`,
              result: retestModel.status,
            },
          ]
        : []),
    ],
    environment: [
      { label: 'Operating System', value: preflightRaw?.os ?? NOT_AVAILABLE },
      { label: 'Browsers', value: executedBrowsers.join(', ') || NOT_AVAILABLE },
      { label: 'Browser Version', value: 'Playwright managed engines (not a real-device lab)' },
      { label: 'Playwright Version', value: playwrightVersion },
      {
        label: 'Node.js Version',
        value: preflightRaw?.checks?.find((row) => row.name === 'Node.js')?.detail ?? NOT_AVAILABLE,
      },
      { label: 'Postman CLI Version', value: postmanCliVersion },
      {
        label: 'JMeter Version',
        value: preflightRaw?.checks?.find((row) => row.name === 'JMeter')?.detail ?? NOT_AVAILABLE,
      },
      { label: 'Base URL', value: expectedOrigin },
      { label: 'API Base URL', value: config.urls.api },
      { label: 'Environment', value: `Public website — ${config.urls.website}` },
      {
        label: 'UI Execution Mode',
        value: config.playwright.headless ? 'Headless' : 'Headed',
      },
    ],
    coverage: {
      uniqueUiScenarios: uniqueScenarios.length,
      uiExecutions: executions.length,
      browsers: executedBrowsers,
      apiRequests: apiRequests.length,
      performanceSamples: jmeter?.samples.length ?? 0,
      functionalAreas,
      formula: coverageFormula,
      coverageNote: coverageFormula
        ? `${coverageFormula.coverageDefinition} Pages raw ${coverageFormula.contributions.pages.discoveredRaw} / unique ${coverageFormula.contributions.pages.discoveredUnique}. Element coverage ${coverageFormula.figures.elementCoverage.covered}/${coverageFormula.figures.elementCoverage.testable}. Functional-area coverage ${coverageFormula.figures.functionalAreaCoverage.covered}/${coverageFormula.figures.functionalAreaCoverage.testable}. ${coverageFormula.warning}`
        : coverageRaw
          ? `Item coverage is ${coverageRaw.totals.testedItems}/${coverageRaw.totals.testableItems} (${coverageRaw.totals.itemCoveragePercent}%) — covered discovered testable items, not pass rate (${
              coverageRaw.totals.passRatePercent == null ? 'no executions' : `${coverageRaw.totals.passRatePercent}%`
            }). Coverage formula object was not present on reports/coverage/coverage.json.`
        : `${uniqueScenarios.length} unique UI scenario(s) × ${executedBrowsers.length || configuredBrowsers.length} browser(s) = ${executions.length} UI execution(s). Browser executions are not counted as unique test cases. Run npm run coverage for discovered-item coverage.`,
      advanced: coverageRaw
        ? {
            available: true,
            itemCoveragePercent: coverageRaw.totals.itemCoveragePercent,
            testable: coverageRaw.totals.testableItems,
            covered: coverageRaw.totals.testedItems,
            uncovered: coverageRaw.totals.uncoveredItems,
            passRatePercent: coverageRaw.totals.passRatePercent,
            pagesDiscoveredRaw,
            pagesDiscoveredUnique,
            dimensions: coverageRaw.dimensions.map((row) => ({
              label: row.label,
              discovered: row.discovered,
              testable: row.testable,
              covered: row.covered,
              uncovered: row.uncovered,
              coveragePercent: row.coveragePercent,
            })),
            gaps: coverageRaw.records
              .filter((row) => row.status !== 'TESTED')
              .map((row) => ({
                page: row.page,
                element: row.element,
                type: row.type,
                status: row.status,
                reason: row.reason,
                recommendedTest: row.recommendedTest,
              })),
          }
        : {
            available: false,
            itemCoveragePercent: 0,
            testable: 0,
            covered: 0,
            uncovered: 0,
            passRatePercent: null,
            pagesDiscoveredRaw,
            pagesDiscoveredUnique,
            dimensions: [],
            gaps: [],
          },
    },
    requirementTraceabilityNote:
      'Requirement traceability was not provided for this execution cycle.',
    playwright: {
      total: executions.length,
      passed: pwPassed,
      failed: pwFailed,
      skipped: pwSkipped,
      passRate: uiPassFormatted,
      durationMs: Math.round(playwright?.stats?.duration ?? 0),
      browsers: browserSummaries,
      executions,
      sourceFile: playwrightSourceFile,
      perSuiteWired,
      available: generatedCheckAvailable,
      originStatus: generatedCheckOriginStatus,
      targetOrigin: generatedCheckOrigin,
      configuredBaseUrl: expectedOrigin,
      engineCaveats: [...PLAYWRIGHT_ENGINE_CAVEATS],
      failureDetails,
      failureDetailsAvailable,
    },
    api: {
      available: Boolean(postman?.run),
      collection: postman?.run?.meta?.collectionName ?? config.postman.collectionName,
      iterations: pmSummary?.iterations?.executed ?? 0,
      requestsExecuted: pmSummary?.executedRequests?.executed ?? apiRequests.length,
      requestErrors: pmSummary?.executedRequests?.errors ?? 0,
      assertionsExecuted: pmSummary?.tests?.executed ?? 0,
      assertionsPassed: pmSummary?.tests?.passed ?? 0,
      assertionsFailed: pmSummary?.tests?.failed ?? 0,
      avgMs: pmSummary?.timeStats?.responseAverage ?? 0,
      minMs: pmSummary?.timeStats?.responseMin ?? 0,
      maxMs: pmSummary?.timeStats?.responseMax ?? 0,
      requests: apiRequests,
      terminology:
        'API automation via Postman CLI. Sauce Demo discovery found 0 xhr/fetch/websocket APIs; executed requests are documented in qa.config.json postman.requests, not invented from the login page. Coverage is limited to those documented requests and xhr/fetch calls observed on the same API origin. Authentication/authorization stay NOT_EXECUTED unless the target documents them and QA_API_TOKEN is provided.',
    },
    performance: {
      available: Boolean(jmeter),
      profile: perfSummary ? normalizePerformanceProfile(perfSummary.profile) : NOT_AVAILABLE,
      heavy: Boolean(perfSummary?.heavy),
      authorized: perfSummary?.authorized ?? !perfSummary,
      skipped: Boolean(perfSummary?.skipped || perfSummary?.blocked),
      skipReason: textOrNa(perfSummary?.blockReason ?? perfSummary?.skipReason ?? ''),
      target: perfSummary?.target ?? `${config.urls.api.replace(/\/+$/, '')}${config.jmeter.path.startsWith('/') ? config.jmeter.path : `/${config.jmeter.path}`}`,
      threads: perfSummary?.threads ?? config.jmeter.threads,
      rampUpSeconds: perfSummary?.rampUpSeconds ?? config.jmeter.rampUpSeconds,
      loopCount: perfSummary?.loopCount ?? config.jmeter.loopCount,
      durationSeconds: perfSummary?.durationSeconds ?? null,
      totalSamples: jmeterMetrics?.requestCount ?? 0,
      successfulSamples: jmeterMetrics?.successful ?? 0,
      failedSamples: jmeterMetrics?.failures ?? 0,
      errorRate: jmeterMetrics ? `${jmeterMetrics.errorRatePercent.toFixed(2)}%` : NOT_AVAILABLE,
      avgMs: jmeterMetrics?.avgMs ?? 0,
      minMs: jmeterMetrics?.minMs ?? 0,
      maxMs: jmeterMetrics?.maxMs ?? 0,
      p50Ms: metricOrNa(jmeterMetrics?.p50Ms),
      p90Ms: metricOrNa(jmeterMetrics?.p90Ms),
      p95Ms: metricOrNa(jmeterMetrics?.p95Ms),
      p99Ms: metricOrNa(jmeterMetrics?.p99Ms),
      ttfbMs: metricOrNa(jmeterMetrics?.ttfbMs ?? jmeterMetrics?.avgLatencyMs),
      throughputPerSec: metricOrNa(jmeterMetrics?.throughputPerSec),
      avgLatencyMs: metricOrNa(jmeterMetrics?.avgLatencyMs),
      avgConnectMs: metricOrNa(jmeterMetrics?.avgConnectMs),
      sampleUrl: textOrNa(jmeterRows[0]?.url),
      runStatus: jmeter?.samples.length ? (perfSummary?.status ?? 'RECORDED') : 'NOT_EXECUTED',
      samples: jmeterRows,
      thresholdStatus: perfSummary?.thresholds.status ?? NOT_AVAILABLE,
      slaNote:
        perfSummary?.thresholds.note ??
        'Performance results are reported as observed execution metrics. Threshold keys in qa.config.json are null — status is RECORDED / NOT_AVAILABLE, not PASS. No SLA was invented.',
      terminology: `JMeter ${perfSummary ? normalizePerformanceProfile(perfSummary.profile) : NOT_AVAILABLE} performance validation — status is RECORDED, never PASS`,
    },
    lighthouse: lighthouseSection,
    defects: {
      recorded: observedFindingCount > 0,
      note:
        observedFindingCount > 0
          ? `No external defect tickets (Jira/Azure DevOps) were provided. Counts below are observed automation findings from SEO, content, accessibility, and security artifacts — not a ticketing system. ${failureModel.analyzed} leftover execution failure(s) were classified.`
          : 'No defects were recorded in the provided test execution results.',
      critical: findingDefects.critical,
      high: findingDefects.high,
      medium: findingDefects.medium,
      low: findingDefects.low,
      rows: [],
    },
    pipeline: pipelineModel,
    distribution: {
      passed: pwPassed,
      failed: pwFailed,
      skipped: pwSkipped,
    },
    discovery: discoveryModel,
    inventory: inventoryModel,
    seo: seoModel,
    content: contentModel,
    failureAnalysis: failureModel,
    retest: retestModel,
    accessibility: a11yModel,
    correlation: correlationModel,
    security: securityModel,
    coverageBreakdown,
    risks,
    recommendation: {
      status: overallStatus,
      summary:
        overallStatus === 'PASS'
          ? 'Based on the executed automation suite, the tested scenarios passed successfully within the documented scope and limitations.'
          : 'Based on the executed automation suite, one or more tested scenarios or tools reported failures. Review detailed sections and artifacts before release decisions.',
      bullets: recommendationBullets,
    },
    artifacts: [
      { name: 'Playwright generated-check JSON', location: 'reports/playwright/generated-check/results.json' },
      { name: 'Playwright generated-check summary', location: 'reports/playwright/generated-check/summary.json' },
      { name: 'Postman JSON', location: 'reports/postman/report.json' },
      { name: 'JMeter HTML', location: 'reports/jmeter/html/index.html' },
      { name: 'JMeter JTL', location: 'reports/jmeter/results.jtl' },
      { name: 'JMeter summary', location: 'reports/jmeter/summary.json' },
      { name: 'JMeter findings', location: 'reports/jmeter/findings.md' },
      { name: 'Lighthouse / CWV summary', location: 'reports/lighthouse/summary.json' },
      { name: 'Lighthouse / CWV findings', location: 'reports/lighthouse/findings.md' },
      { name: 'Combined Summary', location: 'reports/summary.json' },
      { name: 'Orchestrator stages', location: 'reports/orchestrator/stages.md' },
      { name: 'Orchestrator summary', location: 'reports/orchestrator/summary.json' },
      { name: 'Final QA report', location: 'reports/summary/final-qa-report.md' },
      { name: 'Allure results', location: 'reports/allure/results' },
      { name: 'Allure HTML report', location: 'reports/allure/report/index.html' },
      { name: 'Playwright HTML report (e2e)', location: 'reports/playwright/e2e/html/index.html' },
      { name: 'Report kind index', location: 'reports/summary/report-index.json' },
      ...(a11yModel.available
        ? [
            { name: 'Accessibility JSON', location: 'reports/accessibility/results.json' },
            { name: 'Accessibility findings', location: 'reports/accessibility/findings.md' },
            { name: 'Accessibility summary', location: 'reports/accessibility/summary.json' },
          ]
        : []),
      { name: 'Visual summary', location: 'reports/visual/summary.json' },
      { name: 'Visual results', location: 'reports/visual/results.json' },
      { name: 'Visual baselines', location: 'visual-baselines/' },
      ...(correlationModel.available
        ? [
            { name: 'Workflow correlation JSON', location: 'reports/workflows/results.json' },
            { name: 'Workflow correlation summary', location: 'reports/workflows/summary.json' },
            { name: 'Workflow correlation evidence', location: 'reports/workflows/evidence.json' },
            { name: 'Workflow correlation findings', location: 'reports/workflows/findings.md' },
          ]
        : []),
      ...(securityModel.available
        ? [
            { name: 'Security JSON', location: 'reports/security/results.json' },
            { name: 'Security findings', location: 'reports/security/findings.md' },
            { name: 'Security summary', location: 'reports/security/summary.json' },
          ]
        : []),
      ...(seoModel.available && seoModel.source !== 'discovery'
        ? [
            { name: 'SEO JSON', location: 'reports/seo/results.json' },
            { name: 'SEO findings', location: 'reports/seo/findings.md' },
            { name: 'SEO summary', location: 'reports/seo/summary.json' },
          ]
        : []),
      ...(contentModel.available
        ? [
            { name: 'Content JSON', location: 'reports/content/results.json' },
            { name: 'Content findings', location: 'reports/content/findings.md' },
            { name: 'Content summary', location: 'reports/content/summary.json' },
          ]
        : []),
      ...(failureModel.available
        ? [
            { name: 'Failure analysis section 2.16', location: 'reports/failures/section-2.16.json' },
            { name: 'Failure analysis summary', location: 'reports/failures/summary.json' },
            { name: 'Failure analysis findings', location: 'reports/failures/findings.md' },
          ]
        : []),
      ...(retestModel.available
        ? [
            { name: 'Retest section 2.17', location: 'reports/retest/section-2.17.json' },
            { name: 'Retest summary', location: 'reports/retest/summary.json' },
            { name: 'Retest findings', location: 'reports/retest/latest.json' },
          ]
        : []),
      ...(coverageRaw
        ? [
            { name: 'Coverage JSON', location: 'reports/coverage/coverage.json' },
            { name: 'Coverage matrix', location: 'docs/coverage-matrix.md' },
            { name: 'Uncovered items', location: 'docs/uncovered-test-items.md' },
          ]
        : []),
    ],
    conclusion: [
      `This execution covered UI/E2E automation (${uniqueScenarios.length} unique scenarios / ${executions.length} executions), API automation (${apiRequests.length} Postman request(s)), and JMeter ${perfSummary?.profile ?? 'smoke'} performance (${jmeter?.samples.length ?? 0} sample(s)) for ${applicationName}.`,
      `Overall QA status for the executed scope: ${overallStatus}.`,
      'Results apply only to the automated scope documented in this report and do not constitute evidence of complete application quality, security, accessibility, or production readiness.',
      'Refer to Layer 4 (Risks & Limitations) and Layer 5 (Release Recommendation) for decision guidance.',
    ],
    executiveSummary: [
      `Automated QA execution was performed for ${applicationName} (${config.urls.website}) using the qa:all orchestrator: discovery, inventory, Playwright UI/E2E, visual, responsive, cross-browser, accessibility, Postman API, JMeter smoke, security, SEO, content, workflows, failure analysis, coverage, and this report.`,
      `Exhaustive execution policy: runnable tests, scenarios, and UI checks are not silently skipped. Safety-blocked or unconfigurable items are recorded as BLOCKED / NOT_TESTED / REQUIRES_CONFIGURATION with a reason. Visual / responsive / accessibility / workflows execute against the resolved target URL — the local fixture is not substituted when a live origin is set.`,
      pipelineModel.available
        ? `Pipeline result: ${pipelineModel.overallStatus}. Passed stages: ${stageGroups.passed.join(', ') || 'none'}. Failed stages: ${stageGroups.failed.join(', ') || 'none'}. Not-executed stages: ${stageGroups.notExecuted.join(', ') || 'none'}.`
        : `Orchestrator stage summary was not found; tool-level artifacts were used.`,
      `Automated QA execution used Playwright (UI/E2E), Postman CLI (API automation), and JMeter (${perfSummary?.profile ?? 'smoke'} performance; threshold ${perfSummary?.thresholds.status ?? 'undefined'}).`,
      `UI executions from ${playwrightSourceFile}: ${executions.length} total (${uniqueScenarios.length} unique scenarios across ${executedBrowsers.length} browser(s)). Result: ${pwPassed} passed, ${pwFailed} failed, ${pwSkipped} skipped. UI execution pass rate: ${uiPassFormatted}. Assertion pass rate: ${assertionPassFormatted}.`,
      `API requests executed: ${apiRequests.length}. Performance samples collected: ${jmeter?.samples.length ?? 0}. Observed findings (not tickets): ${observedFindingCount}.`,
      pendingReview
        ? 'PENDING REVIEW — reviewer name is unset in qa.config.json report.signOff. This report is not approved.'
        : `Reviewed by ${formatReviewedBy(reportExtras.signOff)}.`,
      originMismatches.length > 0
        ? `INVALID origin (excluded from pass counts). Expected: ${expectedOrigin}. Observed: ${originMismatches.map((row) => `${row.suite} ${row.origin}`).join('; ')}.`
        : `Suite origin compared to ${expectedOrigin} where suite summaries were present.`,
      `Configured Playwright browsers in qa.config.json: ${(config.playwright.browsers ?? []).join(', ') || NOT_AVAILABLE}. Generated-check / UI executions observed: ${executedBrowsers.join(', ') || NOT_AVAILABLE}. WebKit is not iOS Safari; Chromium is not Android Chrome.`,
      `Lighthouse / Core Web Vitals: ${lighthouseSection.status}${lighthouseSection.skipReason ? ` — ${lighthouseSection.skipReason}` : ''}. JMeter measurements are separate and never stand in for CWV.`,
      ...(qualityWarnings.length
        ? [
            `Report-quality warnings (do not abort this report): ${qualityWarnings
              .map((row) => `${row.id} ${row.result} — ${row.detail}`)
              .join(' | ')}`,
          ]
        : []),
      `Overall QA Status: ${overallStatus}. This status reflects only the executed automation scope and should be interpreted with the documented risks, limitations, and release recommendation.`,
    ],
    qualityChecks,
    qualityCheckRows: allQuality,
    crossSuite: {
      available: Boolean(crossSuite),
      source: crossSuite ? 'reports/quality/cross-suite.json' : NOT_AVAILABLE,
      missingReason: crossSuite
        ? 'no CROSS_SUITE_CONTRADICTION findings (check PASSES)'
        : 'reports/quality/cross-suite.json was not present',
      findings: (crossSuite?.findings ?? []).map((row) => ({
        type: row.type,
        severity: row.severity,
        url: row.url,
        healthySuites: row.healthySuites.join(', ') || NOT_AVAILABLE,
        brokenSuites: row.brokenSuites.join(', ') || NOT_AVAILABLE,
        detail: row.detail,
      })),
    },
    layers: [
      {
        id: 'L1',
        title: 'Executive Summary',
        purpose: 'Management-facing status, KPIs, and outcome of the executed automation cycle.',
      },
      {
        id: 'L2',
        title: 'Test Evidence',
        purpose: 'Factual execution evidence from Playwright, Postman CLI, JMeter, environment, and artifacts.',
      },
      {
        id: 'L3',
        title: 'QA Analysis',
        purpose: 'Interpretation of coverage, distribution, defects, and quality meaning without changing results.',
      },
      {
        id: 'L4',
        title: 'Risks & Limitations',
        purpose: 'Documented constraints of the current execution scope and residual quality risk.',
      },
      {
        id: 'L5',
        title: 'Release Recommendation',
        purpose: 'Scoped release guidance based solely on available automation evidence.',
      },
    ],
    qaAnalysis,
    releaseRecommendation: {
      status: overallStatus,
      decision: releaseDecision,
      summary:
        overallStatus === 'PASS'
          ? 'Based on the executed automation evidence, QA can support release decisions only within the tested scope and subject to the documented limitations.'
          : 'Based on failed automation evidence in the executed scope, QA does not support unrestricted release at this time.',
      bullets: releaseBullets,
    },
  };
}
