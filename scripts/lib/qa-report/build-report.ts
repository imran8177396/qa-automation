import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths';
import { loadConfig } from '../load-config';
import { resolvePlaywrightBrowsers } from '../playwright-browsers';
import { parseTextDocument, writeWordDocument } from '../../../npm-docs';
import type { DocsConfig } from '../../../npm-docs/types';
import type { QaConfig } from '../../types';
import {
  loadReportFormat,
  resolveReportOutputPaths,
  type ReportFormat,
  type ReportFormatSection,
} from './format';

interface SummaryFile {
  ranAt: string;
  results: Array<{
    name: string;
    tool: string;
    passed: boolean;
    report?: string;
  }>;
}

interface PlaywrightJsonReport {
  config?: {
    projects?: Array<{ name: string; id: string }>;
  };
  stats?: {
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
        responseStandardDeviation?: number;
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
        status?: string;
        responseTime?: number;
        downloadedBytes?: number;
      };
      tests?: Array<{ name: string; status: string }>;
      errors?: unknown[];
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

interface JmeterStats {
  samples: JmeterSample[];
  errors: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

interface PlaywrightRow {
  browser: string;
  specFile: string;
  testName: string;
  status: string;
  durationMs: number;
  startedAt: string;
  error: string;
}

interface ReportContext {
  config: QaConfig;
  format: ReportFormat;
  summary: SummaryFile | null;
  playwright: PlaywrightJsonReport | null;
  postman: PostmanReport | null;
  jmeter: JmeterStats | null;
  ranAt: string;
  overallPass: boolean;
  pwRows: PlaywrightRow[];
  configuredBrowsers: string[];
  executedBrowsers: string[];
}

type SectionBuilder = (ctx: ReportContext, lines: string[]) => void;

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function statusLabel(passed: boolean): string {
  return passed ? 'PASS' : 'FAIL';
}

function normalizeStatus(status: string): string {
  const upper = status.toUpperCase();
  if (upper === 'PASSED' || upper === 'PASS') return 'PASS';
  if (upper === 'FAILED' || upper === 'FAIL') return 'FAIL';
  if (upper === 'SKIPPED') return 'SKIPPED';
  return upper;
}

function parseJmeterJtl(jtlPath: string): JmeterStats | null {
  if (!fs.existsSync(jtlPath)) {
    return null;
  }

  const lines = fs.readFileSync(jtlPath, 'utf8').trim().split('\n');
  if (lines.length < 2) {
    return null;
  }

  const headers = lines[0].split(',');
  const idx = (name: string) => headers.indexOf(name);
  const samples: JmeterSample[] = [];
  const elapsedValues: number[] = [];
  let errors = 0;

  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const elapsed = Number(cols[idx('elapsed')]);
    const success = cols[idx('success')] === 'true';

    if (!Number.isNaN(elapsed)) {
      elapsedValues.push(elapsed);
    }
    if (!success) {
      errors += 1;
    }

    samples.push({
      label: cols[idx('label')] ?? '',
      url: cols[idx('URL')] ?? '',
      responseCode: cols[idx('responseCode')] ?? '',
      elapsedMs: elapsed,
      success,
      thread: cols[idx('threadName')] ?? '',
    });
  }

  if (elapsedValues.length === 0) {
    return null;
  }

  return {
    samples,
    errors,
    avgMs: Math.round(elapsedValues.reduce((a, b) => a + b, 0) / elapsedValues.length),
    minMs: Math.min(...elapsedValues),
    maxMs: Math.max(...elapsedValues),
  };
}

function flattenPlaywrightRows(
  suites: PlaywrightSuite[] | undefined,
  suiteFile = ''
): PlaywrightRow[] {
  if (!suites) {
    return [];
  }

  const rows: PlaywrightRow[] = [];

  for (const suite of suites) {
    const file = suite.file ?? suite.title ?? suiteFile;

    for (const spec of suite.specs ?? []) {
      const specFile = spec.file ?? file;
      for (const test of spec.tests ?? []) {
        const result = test.results?.[0];
        const status = normalizeStatus(result?.status ?? (spec.ok ? 'passed' : 'failed'));
        rows.push({
          browser: test.projectName ?? test.projectId ?? 'unknown',
          specFile,
          testName: spec.title,
          status,
          durationMs: result?.duration ?? 0,
          startedAt: result?.startTime ?? 'n/a',
          error: result?.errors?.[0]?.message ?? '',
        });
      }
    }

    rows.push(...flattenPlaywrightRows(suite.suites, file));
  }

  return rows;
}

type PostmanExecution = NonNullable<NonNullable<PostmanReport['run']>['executions']>[number];

function postmanUrl(exec: PostmanExecution): string {
  const url = exec.requestExecuted?.url;
  if (!url) {
    return 'n/a';
  }
  const host = url.host?.join('.') ?? '';
  const reqPath = url.path?.join('/') ?? '';
  return `${url.protocol ?? 'https'}://${host}/${reqPath}`.replace(/\/+$/, '/');
}

function addTable(lines: string[], headers: string[], rows: string[][]): void {
  lines.push(`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('');
}

function buildOverviewSection(ctx: ReportContext, lines: string[]): void {
  lines.push(
    `- Project: ${ctx.config.project.name}`,
    `- Generated: ${ctx.ranAt}`,
    `- Overall result: ${ctx.overallPass ? 'PASS' : 'FAIL'}`,
    `- Target application: ${ctx.config.urls.website}`,
    ''
  );
}

function buildEnvironmentsSection(ctx: ReportContext, lines: string[]): void {
  const { config, pwRows, configuredBrowsers, executedBrowsers } = ctx;

  lines.push('### Application URLs', '');
  addTable(lines, ['Environment', 'URL'], [
    ['Website', config.urls.website],
    ['API', config.urls.api],
    ['Login', config.urls.login],
    ['Inventory', config.urls.inventory ?? `${config.urls.website}/inventory.html`],
    ['Checkout', config.urls.checkout ?? `${config.urls.website}/checkout-step-one.html`],
  ]);

  lines.push('### Playwright Environments (Browsers)', '');
  addTable(
    lines,
    ['Browser', 'Configured', 'Tests Run', 'Passed', 'Failed', 'Base URL', 'Headless'],
    configuredBrowsers.map((browser) => {
      const browserRows = pwRows.filter((r) => r.browser === browser);
      const passed = browserRows.filter((r) => r.status === 'PASS').length;
      const failed = browserRows.filter((r) => r.status !== 'PASS' && r.status !== 'SKIPPED').length;
      return [
        browser,
        'Yes',
        String(browserRows.length),
        String(passed),
        String(failed),
        config.playwright.baseURL,
        String(config.playwright.headless),
      ];
    })
  );

  if (executedBrowsers.length > configuredBrowsers.length) {
    lines.push('- Additional browsers executed:', ...executedBrowsers.map((b) => `  - ${b}`), '');
  }

  lines.push('### API Test Environment', '');
  addTable(lines, ['Setting', 'Value'], [
    ['Tool', 'Postman CLI'],
    ['Collection', config.postman.collectionName],
    ['Base URL', config.urls.api],
    ['Assertions enabled', String(config.postman.assertions?.statusCode ?? 200)],
  ]);

  lines.push('### Performance Test Environment', '');
  addTable(lines, ['Setting', 'Value'], [
    ['Tool', 'JMeter'],
    ['Target URL', `${config.urls.api}${config.jmeter.path}`],
    ['Threads', String(config.jmeter.threads)],
    ['Ramp-up (seconds)', String(config.jmeter.rampUpSeconds)],
    ['Loop count', String(config.jmeter.loopCount)],
    ['HTTP method', 'GET'],
  ]);
}

function buildOverallResultsSection(ctx: ReportContext, lines: string[]): void {
  addTable(
    lines,
    ['Tool', 'Test Area', 'Result', 'Report Location'],
    (ctx.summary?.results ?? []).map((item) => [
      item.tool,
      item.name,
      statusLabel(item.passed),
      item.report ?? 'n/a',
    ])
  );
}

function buildPlaywrightDetailSection(ctx: ReportContext, lines: string[]): void {
  const { playwright, pwRows, configuredBrowsers, executedBrowsers } = ctx;

  const pwPassed = pwRows.filter((r) => r.status === 'PASS').length;
  const pwFailed = pwRows.filter((r) => r.status !== 'PASS' && r.status !== 'SKIPPED').length;
  const pwSkipped = pwRows.filter((r) => r.status === 'SKIPPED').length;

  lines.push(
    '### Summary',
    '',
    `- Browsers configured: ${configuredBrowsers.join(', ')}`,
    `- Browsers executed: ${executedBrowsers.join(', ') || 'none'}`,
    `- Total test runs: ${pwRows.length}`,
    `- Passed: ${pwPassed}`,
    `- Failed: ${pwFailed}`,
    `- Skipped: ${pwSkipped}`,
    `- Total duration: ${playwright?.stats?.duration ?? 0} ms`,
    `- HTML report: reports/playwright/index.html`,
    `- JSON report: reports/playwright/results.json`,
    ''
  );

  if (pwRows.length > 0) {
    lines.push('### Results by Browser', '');
    addTable(
      lines,
      ['Browser', 'Total', 'Passed', 'Failed', 'Skipped', 'Pass Rate'],
      configuredBrowsers.map((browser) => {
        const browserRows = pwRows.filter((r) => r.browser === browser);
        const passed = browserRows.filter((r) => r.status === 'PASS').length;
        const failed = browserRows.filter((r) => r.status !== 'PASS' && r.status !== 'SKIPPED').length;
        const skipped = browserRows.filter((r) => r.status === 'SKIPPED').length;
        const rate = browserRows.length
          ? `${((passed / browserRows.length) * 100).toFixed(0)}%`
          : '0%';
        return [browser, String(browserRows.length), String(passed), String(failed), String(skipped), rate];
      })
    );

    for (const browser of configuredBrowsers) {
      const browserRows = pwRows.filter((r) => r.browser === browser);
      if (browserRows.length === 0) {
        continue;
      }

      lines.push(`### Playwright — ${browser}`, '');
      addTable(
        lines,
        ['Spec File', 'Test Case', 'Status', 'Duration (ms)', 'Started At'],
        browserRows.map((row) => [
          row.specFile,
          row.testName,
          row.status,
          String(row.durationMs),
          row.startedAt,
        ])
      );
    }

    const failedRows = pwRows.filter((r) => r.status === 'FAIL' && r.error);
    if (failedRows.length > 0) {
      lines.push('### Playwright Failures', '');
      addTable(
        lines,
        ['Browser', 'Test Case', 'Error'],
        failedRows.map((row) => [row.browser, row.testName, row.error.slice(0, 120)])
      );
    }
  } else {
    lines.push('- No Playwright results found. Run npm run test:e2e first.', '');
  }
}

function buildPostmanDetailSection(ctx: ReportContext, lines: string[]): void {
  const { config, postman } = ctx;
  const pmSummary = postman?.run?.summary;

  lines.push(
    '### Summary',
    '',
    `- Collection: ${postman?.run?.meta?.collectionName ?? config.postman.collectionName}`,
    `- Iterations: ${pmSummary?.iterations?.executed ?? 0}`,
    `- Requests executed: ${pmSummary?.executedRequests?.executed ?? 0}`,
    `- Request errors: ${pmSummary?.executedRequests?.errors ?? 0}`,
    `- Assertions executed: ${pmSummary?.tests?.executed ?? 0}`,
    `- Assertions passed: ${pmSummary?.tests?.passed ?? 0}`,
    `- Assertions failed: ${pmSummary?.tests?.failed ?? 0}`,
    `- Avg response time: ${pmSummary?.timeStats?.responseAverage ?? 0} ms`,
    `- Min response time: ${pmSummary?.timeStats?.responseMin ?? 0} ms`,
    `- Max response time: ${pmSummary?.timeStats?.responseMax ?? 0} ms`,
    `- JSON report: reports/postman/report.json`,
    ''
  );

  const executions = postman?.run?.executions ?? [];
  if (executions.length > 0) {
    lines.push('### Request Details', '');
    addTable(
      lines,
      ['#', 'Request', 'Method', 'URL', 'Status', 'Time (ms)', 'Size (bytes)'],
      executions.map((exec, index) => [
        String(index + 1),
        exec.requestExecuted?.name ?? 'n/a',
        exec.requestExecuted?.method ?? 'GET',
        postmanUrl(exec),
        String(exec.response?.code ?? 'n/a'),
        String(exec.response?.responseTime ?? 0),
        String(exec.response?.downloadedBytes ?? 0),
      ])
    );

    lines.push('### Assertion Results', '');
    const assertionRows: string[][] = [];
    for (const exec of executions) {
      for (const test of exec.tests ?? []) {
        assertionRows.push([
          exec.requestExecuted?.name ?? 'n/a',
          test.name,
          normalizeStatus(test.status),
        ]);
      }
    }
    if (assertionRows.length > 0) {
      addTable(lines, ['Request', 'Assertion', 'Result'], assertionRows);
    } else {
      lines.push('- No assertions recorded.', '');
    }
  } else {
    lines.push('- No Postman results found. Run npm run test:api first.', '');
  }
}

function buildJmeterDetailSection(ctx: ReportContext, lines: string[]): void {
  const { config, jmeter } = ctx;

  if (jmeter) {
    const errorRate = jmeter.samples.length
      ? ((jmeter.errors / jmeter.samples.length) * 100).toFixed(2)
      : '0.00';

    lines.push(
      '### Summary',
      '',
      `- Target: ${config.urls.api}${config.jmeter.path}`,
      `- Total samples: ${jmeter.samples.length}`,
      `- Successful samples: ${jmeter.samples.length - jmeter.errors}`,
      `- Failed samples: ${jmeter.errors}`,
      `- Error rate: ${errorRate}%`,
      `- Avg response time: ${jmeter.avgMs} ms`,
      `- Min response time: ${jmeter.minMs} ms`,
      `- Max response time: ${jmeter.maxMs} ms`,
      `- Threads: ${config.jmeter.threads}`,
      `- Ramp-up: ${config.jmeter.rampUpSeconds}s`,
      `- Loop count: ${config.jmeter.loopCount}`,
      `- HTML dashboard: reports/jmeter/html/index.html`,
      `- Results file: reports/jmeter/results.jtl`,
      ''
    );

    lines.push('### Sample Results', '');
    addTable(
      lines,
      ['#', 'Thread', 'Label', 'URL', 'Status Code', 'Time (ms)', 'Result'],
      jmeter.samples.map((sample, index) => [
        String(index + 1),
        sample.thread,
        sample.label,
        sample.url,
        sample.responseCode,
        String(sample.elapsedMs),
        sample.success ? 'PASS' : 'FAIL',
      ])
    );
  } else {
    lines.push('- No JMeter results found. Run npm run test:performance first.', '');
  }
}

function buildArtifactsSection(_ctx: ReportContext, lines: string[]): void {
  lines.push(
    '- Playwright HTML: reports/playwright/index.html',
    '- Playwright JSON: reports/playwright/results.json',
    '- Postman JSON: reports/postman/report.json',
    '- JMeter HTML: reports/jmeter/html/index.html',
    '- JMeter JTL: reports/jmeter/results.jtl',
    '- Combined summary: reports/summary.json',
    ''
  );
}

function buildConclusionSection(ctx: ReportContext, lines: string[]): void {
  lines.push(
    ctx.overallPass
      ? `All QA tools passed across ${ctx.configuredBrowsers.length} browser environment(s), API smoke tests, and performance load test.`
      : 'One or more QA tools reported failures. Review the detailed sections above and open the HTML/JSON artifacts for full diagnostics.',
    ''
  );
}

const SECTION_BUILDERS: Record<string, SectionBuilder> = {
  overview: buildOverviewSection,
  environments: buildEnvironmentsSection,
  'overall-results': buildOverallResultsSection,
  'playwright-detail': buildPlaywrightDetailSection,
  'postman-detail': buildPostmanDetailSection,
  'jmeter-detail': buildJmeterDetailSection,
  artifacts: buildArtifactsSection,
  conclusion: buildConclusionSection,
};

function buildReportContext(format: ReportFormat): ReportContext {
  const config = loadConfig();
  const summary = readJson<SummaryFile>(path.join(PATHS.reports.root, 'summary.json'));
  const playwright = readJson<PlaywrightJsonReport>(
    path.join(PATHS.reports.playwright, 'results.json')
  );
  const postman = readJson<PostmanReport>(path.join(PATHS.reports.postman, 'report.json'));
  const jmeter = parseJmeterJtl(path.join(PATHS.reports.jmeter, 'results.jtl'));

  const ranAt = summary?.ranAt ?? new Date().toISOString();
  const overallPass = summary?.results.every((item) => item.passed) ?? false;
  const pwRows = flattenPlaywrightRows(playwright?.suites);
  const configuredBrowsers = resolvePlaywrightBrowsers(config.playwright);
  const executedBrowsers =
    playwright?.config?.projects?.map((p) => p.name) ??
    [...new Set(pwRows.map((r) => r.browser))];

  return {
    config,
    format,
    summary,
    playwright,
    postman,
    jmeter,
    ranAt,
    overallPass,
    pwRows,
    configuredBrowsers,
    executedBrowsers,
  };
}

function appendSection(section: ReportFormatSection, ctx: ReportContext, lines: string[]): void {
  lines.push(section.heading, '');

  const builder = SECTION_BUILDERS[section.id];
  if (!builder) {
    lines.push(`- Section "${section.id}" has no builder registered.`, '');
    return;
  }

  builder(ctx, lines);
}

export function buildQaReportText(format?: ReportFormat): string {
  const reportFormat = format ?? loadReportFormat();
  const ctx = buildReportContext(reportFormat);

  const lines: string[] = [
    `@title ${ctx.config.project.name} ${reportFormat.meta.titleSuffix}`,
    `@author ${reportFormat.meta.author}`,
    `@date ${ctx.ranAt.slice(0, 10)}`,
    '',
  ];

  for (const section of reportFormat.sections) {
    if (!section.enabled) {
      continue;
    }
    appendSection(section, ctx, lines);
  }

  return lines.join('\n');
}

export async function generateQaReportDocx(format?: ReportFormat): Promise<{
  txtPath: string;
  docxPath: string;
  format: ReportFormat;
}> {
  const config = loadConfig();
  if (config.report?.enabled === false) {
    throw new Error('Report generation is disabled in qa.config.json (report.enabled = false).');
  }

  const reportFormat = format ?? loadReportFormat();
  const { txtPath, docxPath } = resolveReportOutputPaths(reportFormat);

  const configPath = path.join(PATHS.root, 'docs.config.json');
  const docsConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as DocsConfig;

  const reportText = buildQaReportText(reportFormat);
  fs.mkdirSync(path.dirname(txtPath), { recursive: true });
  fs.writeFileSync(txtPath, reportText, 'utf8');

  const parsed = parseTextDocument(reportText);
  await writeWordDocument(parsed, docsConfig, docxPath);

  return { txtPath, docxPath, format: reportFormat };
}

if (require.main === module) {
  generateQaReportDocx()
    .then(({ txtPath, docxPath, format }) => {
      console.log(`Format:       ${format.id} v${format.version}`);
      console.log(`Text report:  ${txtPath}`);
      console.log(`Word report:  ${docxPath}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
