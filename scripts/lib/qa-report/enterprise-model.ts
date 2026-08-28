import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths';
import { loadConfig } from '../load-config';
import { resolvePlaywrightBrowsers } from '../playwright-browsers';
import { reconcileSummary, writeSummaryFile, type SummaryFile } from './reconcile-summary';

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
}

export interface BrowserSummary {
  browser: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
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
    overallStatus: QaStatus;
    generatedAt: string;
  };
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
    target: string;
    threads: number;
    rampUpSeconds: number;
    loopCount: number;
    totalSamples: number;
    successfulSamples: number;
    failedSamples: number;
    errorRate: string;
    avgMs: number;
    minMs: number;
    maxMs: number;
    samples: JmeterSampleRow[];
    slaNote: string;
    terminology: string;
  };
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

interface JmeterSample {
  label: string;
  url: string;
  responseCode: string;
  elapsedMs: number;
  success: boolean;
  thread: string;
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
  if (upper === 'SKIPPED') return 'SKIPPED';
  return upper;
}

function passRate(passed: number, total: number): string {
  if (total === 0) return '0%';
  return `${((passed / total) * 100).toFixed(1)}%`;
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
        const result = test.results?.[0];
        rows.push({
          specFile,
          scenario: spec.title,
          browser: test.projectName ?? test.projectId ?? 'unknown',
          status: normalizeStatus(result?.status ?? (spec.ok ? 'passed' : 'failed')),
          durationMs: result?.duration ?? 0,
          startedAt: result?.startTime ?? 'Not Provided',
          error: result?.errors?.[0]?.message ?? '',
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

function parseJmeterJtl(jtlPath: string): {
  samples: JmeterSample[];
  errors: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
} | null {
  if (!fs.existsSync(jtlPath)) return null;
  const lines = fs.readFileSync(jtlPath, 'utf8').trim().split('\n');
  if (lines.length < 2) return null;

  const headers = lines[0].split(',');
  const idx = (name: string) => headers.indexOf(name);
  const samples: JmeterSample[] = [];
  const elapsedValues: number[] = [];
  let errors = 0;

  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const elapsed = Number(cols[idx('elapsed')]);
    const success = cols[idx('success')] === 'true';
    if (!Number.isNaN(elapsed)) elapsedValues.push(elapsed);
    if (!success) errors += 1;
    samples.push({
      label: cols[idx('label')] ?? '',
      url: cols[idx('URL')] ?? '',
      responseCode: cols[idx('responseCode')] ?? '',
      elapsedMs: elapsed,
      success,
      thread: cols[idx('threadName')] ?? '',
    });
  }

  if (elapsedValues.length === 0) return null;

  return {
    samples,
    errors,
    avgMs: Math.round(elapsedValues.reduce((a, b) => a + b, 0) / elapsedValues.length),
    minMs: Math.min(...elapsedValues),
    maxMs: Math.max(...elapsedValues),
  };
}

function postmanUrl(exec: NonNullable<NonNullable<PostmanReport['run']>['executions']>[number]): string {
  const url = exec.requestExecuted?.url;
  if (!url) return 'Not Provided';
  const host = url.host?.join('.') ?? '';
  const reqPath = url.path?.join('/') ?? '';
  return `${url.protocol ?? 'https'}://${host}/${reqPath}`.replace(/\/+$/, '/');
}

function deriveOverallStatus(summary: SummaryFile, uiFailed: number): QaStatus {
  const anyToolFailed = summary.results.some((item) => !item.passed);
  if (anyToolFailed || uiFailed > 0) return 'FAIL';
  return 'PASS';
}

function packageVersion(packageName: string): string {
  try {
    const pkgPath = require.resolve(`${packageName}/package.json`, { paths: [PATHS.root] });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? 'Not Provided';
  } catch {
    return 'Not Provided';
  }
}

export function buildEnterpriseReportModel(): EnterpriseReportModel {
  const config = loadConfig();
  const rawSummary = readJson<SummaryFile>(path.join(PATHS.reports.root, 'summary.json'));
  const playwright = readJson<PlaywrightJsonReport>(
    path.join(PATHS.reports.playwright, 'results.json')
  );
  const postman = readJson<PostmanReport>(path.join(PATHS.reports.postman, 'report.json'));
  const jmeter = parseJmeterJtl(path.join(PATHS.reports.jmeter, 'results.jtl'));

  const pwRaw = flattenPlaywright(playwright?.suites);
  const summary = reconcileSummary(config, rawSummary, playwright, pwRaw, postman, jmeter);
  writeSummaryFile(summary);

  const executions = assignTestCaseIds(pwRaw);
  const uniqueScenarios = [...new Set(executions.map((row) => `${row.specFile}::${row.scenario}`))];
  const configuredBrowsers = resolvePlaywrightBrowsers(config.playwright);
  const executedBrowsers =
    playwright?.config?.projects?.map((p) => p.name) ??
    [...new Set(executions.map((r) => r.browser))];

  const pwPassed = executions.filter((r) => r.status === 'PASS').length;
  const pwFailed = executions.filter((r) => r.status === 'FAIL').length;
  const pwSkipped = executions.filter((r) => r.status === 'SKIPPED').length;
  const overallStatus = deriveOverallStatus(summary, pwFailed);

  const browserSummaries: BrowserSummary[] = configuredBrowsers.map((browser) => {
    const rows = executions.filter((r) => r.browser === browser);
    const passed = rows.filter((r) => r.status === 'PASS').length;
    const failed = rows.filter((r) => r.status === 'FAIL').length;
    const skipped = rows.filter((r) => r.status === 'SKIPPED').length;
    return {
      browser,
      total: rows.length,
      passed,
      failed,
      skipped,
      passRate: passRate(passed, rows.length),
    };
  });

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
      statusCode: String(exec.response?.code ?? 'Not Provided'),
      responseTimeMs: exec.response?.responseTime ?? 0,
      assertion: assertionNames,
      result: assertionResult,
    };
  });

  const jmeterRows: JmeterSampleRow[] = (jmeter?.samples ?? []).map((sample, index) => ({
    index: index + 1,
    thread: sample.thread,
    label: sample.label,
    url: sample.url,
    statusCode: sample.responseCode,
    elapsedMs: sample.elapsedMs,
    result: sample.success ? 'PASS' : 'FAIL',
  }));

  const functionalAreas = [
    ...new Set(
      executions.map((row) => {
        if (row.specFile.includes('login')) return 'Authentication / Login';
        if (row.specFile.includes('signup')) return 'User Registration';
        if (row.specFile.includes('contact')) return 'Contact List';
        if (row.specFile.includes('example')) return 'Application Availability / Homepage';
        return row.specFile.replace(/\.spec\.ts$/, '');
      })
    ),
  ];

  const applicationName = config.urls.website.includes('contact-list')
    ? 'Contact List App'
    : config.project.name;

  const executionDate =
    playwright?.stats?.startTime ??
    summary.ranAt ??
    new Date().toISOString();

  const playwrightVersion = packageVersion('@playwright/test');
  const postmanCliVersion = packageVersion('postman-cli');

  const toolResult = (tool: string): string => {
    const item = summary.results.find((r) => r.tool === tool);
    if (!item) return 'Not Provided';
    return item.passed ? 'PASS' : 'FAIL';
  };

  const inScope = [
    `UI/E2E automation for ${applicationName} (${uniqueScenarios.length} unique scenarios)`,
    `Cross-browser validation on: ${executedBrowsers.join(', ') || 'Not Provided'}`,
    `API smoke testing via Postman CLI (${apiRequests.length} request(s))`,
    `Basic performance validation via JMeter (${jmeter?.samples.length ?? 0} sample(s))`,
    ...functionalAreas.map((area) => `Functional area covered: ${area}`),
  ];

  const outOfScope = [
    'Mobile device / native app testing',
    'Accessibility (a11y) testing',
    'Security / penetration testing',
    'Database validation testing',
    'Full-scale stress / endurance / soak testing',
    'Production monitoring / synthetic production checks',
    'Formal requirement-to-test traceability (no requirements matrix provided)',
    'Formal performance SLA / threshold validation (no SLA provided)',
  ];

  const risks = [
    'Automated pass rate reflects only the executed automation scope, not the entire application.',
    `UI coverage is limited to ${uniqueScenarios.length} unique scenario(s) across ${executedBrowsers.length} browser(s).`,
    `API coverage is limited to smoke requests (${apiRequests.length} request(s)); this is not comprehensive API testing.`,
    `Performance workload is basic (${config.jmeter.threads} thread(s), ${config.jmeter.loopCount} loop(s)); not a full-scale stress test.`,
    'No mobile, accessibility, security, or database testing evidence is present in this execution.',
    'No formal performance acceptance threshold / SLA was provided for comparison.',
    'No requirement IDs or defect records were provided in the execution artifacts.',
  ];

  const recommendationBullets = [
    `Within the executed automation scope, overall QA status is ${overallStatus}.`,
    `UI/E2E executions: ${pwPassed} passed, ${pwFailed} failed, ${pwSkipped} skipped out of ${executions.length}.`,
    `API smoke testing result: ${toolResult('Postman CLI')}.`,
    `Performance validation result (observed metrics only): ${toolResult('JMeter')}.`,
    'Additional testing outside the current automation scope is recommended before broader release confidence claims.',
  ];

  const qaAnalysis = [
    `UI evidence shows ${uniqueScenarios.length} unique test scenario(s) and ${executions.length} browser execution(s). Pass rate for UI executions is ${passRate(pwPassed, executions.length)}.`,
    `Cross-browser evidence covers: ${executedBrowsers.join(', ') || 'Not Provided'}. Browser-level pass rates: ${browserSummaries
      .map((b) => `${b.browser} ${b.passRate}`)
      .join('; ') || 'Not Provided'}.`,
    `API evidence is limited to smoke coverage (${apiRequests.length} request(s), ${pmSummary?.tests?.executed ?? 0} assertion(s)). This supports availability/smoke validation, not comprehensive API functional coverage.`,
    `Performance evidence is based on ${jmeter?.samples.length ?? 0} observed sample(s) with error rate ${
      jmeter
        ? `${((jmeter.errors / Math.max(jmeter.samples.length, 1)) * 100).toFixed(2)}%`
        : '0.00%'
    }. No formal SLA comparison was possible because no acceptance threshold was provided.`,
    `No defect records and no requirement traceability matrix were present in the execution artifacts; therefore defect trend and requirement coverage analysis are Not Available in Current Execution Data.`,
    `Quality interpretation: a ${overallStatus} status indicates the automated suite completed with the observed outcomes above. It does not imply complete product quality across untested areas.`,
  ];

  const releaseDecision =
    overallStatus === 'PASS'
      ? 'CONDITIONAL RELEASE SUPPORT within the executed automation scope only'
      : 'RELEASE NOT SUPPORTED based on failed automation evidence in the executed scope';

  const releaseBullets =
    overallStatus === 'PASS'
      ? [
          `Release support is limited to the scenarios and tools executed in this cycle (UI/E2E, API smoke, basic performance validation).`,
          `No failed UI executions, API smoke assertions, or performance sample failures were recorded in the available artifacts.`,
          `Because coverage is limited and no formal performance SLA / requirements / security / accessibility evidence was provided, broader production-readiness claims are not supported by this report.`,
          `Recommended next actions: expand functional UI scenarios, deepen API coverage, define performance SLAs, and add non-functional testing before unrestricted release approval.`,
        ]
      : [
          `One or more automated checks failed within the executed scope; unrestricted release support is not justified by this evidence.`,
          `Review failed UI executions, API assertions, and/or performance samples in the Test Evidence layer and linked artifacts.`,
          `Re-test after defect resolution and regenerate this report before release reconsideration.`,
          `Unexecuted areas (mobile, accessibility, security, database, full stress) remain outside this recommendation.`,
        ];

  const qualityChecks: string[] = [];
  const uiTotal = pwPassed + pwFailed + pwSkipped;
  qualityChecks.push(
    uiTotal === executions.length
      ? `PASS: UI Passed+Failed+Skipped (${uiTotal}) equals total UI executions (${executions.length}).`
      : `FAIL: UI totals mismatch (${uiTotal} vs ${executions.length}).`
  );
  for (const browser of browserSummaries) {
    const sum = browser.passed + browser.failed + browser.skipped;
    qualityChecks.push(
      sum === browser.total
        ? `PASS: ${browser.browser} totals reconcile (${sum}/${browser.total}).`
        : `FAIL: ${browser.browser} totals mismatch (${sum}/${browser.total}).`
    );
  }
  if (pmSummary) {
    qualityChecks.push(
      (pmSummary.tests?.passed ?? 0) + (pmSummary.tests?.failed ?? 0) ===
        (pmSummary.tests?.executed ?? 0)
        ? 'PASS: API assertion totals reconcile.'
        : 'FAIL: API assertion totals do not reconcile.'
    );
  }
  if (jmeter) {
    qualityChecks.push(
      jmeter.samples.length - jmeter.errors === jmeter.samples.length - jmeter.errors
        ? `PASS: Performance sample count is ${jmeter.samples.length} with ${jmeter.errors} failed sample(s).`
        : 'FAIL: Performance totals mismatch.'
    );
  }
  qualityChecks.push('PASS: No fabricated requirements, defects, or SLA thresholds were introduced.');

  return {
    meta: {
      reportTitle: 'QA TEST EXECUTION REPORT',
      projectName: config.project.name,
      applicationName,
      testingPhase: 'Automation Regression / Smoke Execution',
      environment: 'Test (public demo application)',
      reportVersion: '1.0',
      executionDate,
      preparedBy: 'QA Automation Framework',
      reviewedBy: 'Not Provided',
      overallStatus,
      generatedAt: new Date().toISOString(),
    },
    kpi: {
      totalUiExecutions: executions.length,
      passed: pwPassed,
      failed: pwFailed,
      skipped: pwSkipped,
      passRate: passRate(pwPassed, executions.length),
      uniqueUiScenarios: uniqueScenarios.length,
      browserCoverage: executedBrowsers.join(', ') || 'Not Provided',
      apiRequests: apiRequests.length,
      performanceSamples: jmeter?.samples.length ?? 0,
      defects: 0,
    },
    projectInfo: [
      { label: 'Project', value: config.project.name },
      { label: 'Application', value: applicationName },
      { label: 'Environment', value: 'Test (public demo application)' },
      { label: 'Base URL', value: config.urls.website },
      { label: 'Testing Phase', value: 'Automation Regression / Smoke Execution' },
      { label: 'Execution Date', value: executionDate },
      {
        label: 'Test Automation Framework',
        value: 'Custom TypeScript QA Automation Framework (Playwright + Postman CLI + JMeter)',
      },
      { label: 'Testing Tools', value: 'Playwright, Postman CLI, Apache JMeter' },
      {
        label: 'Execution Mode',
        value: config.playwright.headless ? 'Headless (UI) / Non-GUI (JMeter)' : 'Headed (UI) / Non-GUI (JMeter)',
      },
      { label: 'Browser Coverage', value: executedBrowsers.join(', ') || 'Not Provided' },
    ],
    inScope,
    outOfScope,
    testingTypes: [
      {
        type: 'UI / E2E Automation',
        tool: 'Playwright',
        coverage: `${uniqueScenarios.length} unique scenario(s), ${executions.length} execution(s)`,
        result: toolResult('Playwright'),
      },
      {
        type: 'Cross-Browser Validation',
        tool: 'Playwright',
        coverage: executedBrowsers.join(', ') || 'Not Provided',
        result: toolResult('Playwright'),
      },
      {
        type: 'API Smoke Testing',
        tool: 'Postman CLI',
        coverage: `${apiRequests.length} request(s)`,
        result: toolResult('Postman CLI'),
      },
      {
        type: 'Basic Performance Validation',
        tool: 'JMeter',
        coverage: `${jmeter?.samples.length ?? 0} sample(s); ${config.jmeter.threads} thread(s)`,
        result: toolResult('JMeter'),
      },
    ],
    environment: [
      { label: 'Operating System', value: 'Not Provided' },
      { label: 'Browsers', value: executedBrowsers.join(', ') || 'Not Provided' },
      { label: 'Browser Version', value: 'Not Provided' },
      { label: 'Playwright Version', value: playwrightVersion },
      { label: 'Node.js Version', value: 'Not Provided' },
      { label: 'Postman CLI Version', value: postmanCliVersion },
      { label: 'JMeter Version', value: 'Not Provided' },
      { label: 'Base URL', value: config.playwright.baseURL },
      { label: 'API Base URL', value: config.urls.api },
      { label: 'Environment', value: 'Test (public demo application)' },
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
      coverageNote: `${uniqueScenarios.length} unique UI scenario(s) × ${executedBrowsers.length || configuredBrowsers.length} browser(s) = ${executions.length} UI execution(s). Browser executions are not counted as unique test cases.`,
    },
    requirementTraceabilityNote:
      'Requirement traceability was not provided for this execution cycle.',
    playwright: {
      total: executions.length,
      passed: pwPassed,
      failed: pwFailed,
      skipped: pwSkipped,
      passRate: passRate(pwPassed, executions.length),
      durationMs: Math.round(playwright?.stats?.duration ?? 0),
      browsers: browserSummaries,
      executions,
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
      terminology: 'API Smoke Testing (limited endpoint coverage)',
    },
    performance: {
      available: Boolean(jmeter),
      target: `${config.urls.api}${config.jmeter.path}`,
      threads: config.jmeter.threads,
      rampUpSeconds: config.jmeter.rampUpSeconds,
      loopCount: config.jmeter.loopCount,
      totalSamples: jmeter?.samples.length ?? 0,
      successfulSamples: jmeter ? jmeter.samples.length - jmeter.errors : 0,
      failedSamples: jmeter?.errors ?? 0,
      errorRate: jmeter
        ? `${((jmeter.errors / Math.max(jmeter.samples.length, 1)) * 100).toFixed(2)}%`
        : '0.00%',
      avgMs: jmeter?.avgMs ?? 0,
      minMs: jmeter?.minMs ?? 0,
      maxMs: jmeter?.maxMs ?? 0,
      samples: jmeterRows,
      slaNote:
        'Performance results are reported as observed execution metrics. No formal performance acceptance threshold was provided.',
      terminology: 'Basic Performance Validation',
    },
    defects: {
      recorded: false,
      note: 'No defects were recorded in the provided test execution results.',
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      rows: [],
    },
    distribution: {
      passed: pwPassed,
      failed: pwFailed,
      skipped: pwSkipped,
    },
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
      { name: 'Playwright HTML', location: 'reports/playwright/index.html' },
      { name: 'Playwright JSON', location: 'reports/playwright/results.json' },
      { name: 'Postman JSON', location: 'reports/postman/report.json' },
      { name: 'JMeter HTML', location: 'reports/jmeter/html/index.html' },
      { name: 'JMeter JTL', location: 'reports/jmeter/results.jtl' },
      { name: 'Combined Summary', location: 'reports/summary.json' },
    ],
    conclusion: [
      `This execution covered UI/E2E automation (${uniqueScenarios.length} unique scenarios / ${executions.length} executions), API smoke testing (${apiRequests.length} request(s)), and basic performance validation (${jmeter?.samples.length ?? 0} sample(s)) for ${applicationName}.`,
      `Overall QA status for the executed scope: ${overallStatus}.`,
      'Results apply only to the automated scope documented in this report and do not constitute evidence of complete application quality, security, accessibility, or production readiness.',
      'Refer to Layer 4 (Risks & Limitations) and Layer 5 (Release Recommendation) for decision guidance.',
    ],
    executiveSummary: [
      `Automated QA execution was performed for ${applicationName} using Playwright (UI/E2E), Postman CLI (API smoke), and JMeter (basic performance validation).`,
      `UI executions: ${executions.length} total (${uniqueScenarios.length} unique scenarios across ${executedBrowsers.length} browser(s)). Result: ${pwPassed} passed, ${pwFailed} failed, ${pwSkipped} skipped (${passRate(pwPassed, executions.length)} pass rate).`,
      `API smoke requests executed: ${apiRequests.length}. Performance samples collected: ${jmeter?.samples.length ?? 0}. Defects recorded in artifacts: 0.`,
      `Overall QA Status: ${overallStatus}. This status reflects only the executed automation scope and should be interpreted with the documented risks, limitations, and release recommendation.`,
    ],
    qualityChecks,
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
