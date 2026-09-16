import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import {
  PLAYWRIGHT_SUITE_NAMES,
  PLAYWRIGHT_SUITE_OUTPUT_PATHS,
  playwrightSuiteSummaryPath,
  type PlaywrightSuiteName,
} from '../lib/playwright-suites';
import type { PlaywrightSuiteSummary } from '../lib/playwright-suite-summary';
import { readJsonIfExists } from '../discovery/write-json';
import type { PerformanceSummary } from '../performance/types';
import { isLivenessProfile } from '../performance/profiles';
import type { ContentSummary } from '../content/types';
import type { SecuritySummary } from '../security/types';
import type { SeoSuiteSummary } from '../seo/types';
import type { ExecutionEvidence } from './types';

/** Subset of a JMeter summary needed to map coverage evidence status. */
export type JmeterEvidenceSource = Pick<
  PerformanceSummary,
  'skipped' | 'blocked' | 'metrics' | 'thresholds'
> & {
  profile: string;
  status?: PerformanceSummary['status'] | string;
};

function jmeterRunExecuted(summary: JmeterEvidenceSource): boolean {
  return Boolean(summary.metrics) && !summary.skipped && !summary.blocked;
}

/**
 * Liveness (and smoke) never maps to PASS — even with zero sample failures.
 * Undefined / NOT_AVAILABLE thresholds are RECORDED, not invented SLAs.
 * Sample failures stay FAIL. resolveSuiteStatus is not used: a completed
 * zero-failure sample run would otherwise become PASS.
 */
export function jmeterEvidenceStatus(summary: JmeterEvidenceSource): ExecutionEvidence['status'] {
  if (!jmeterRunExecuted(summary)) return 'SKIPPED';

  if ((summary.metrics?.failures ?? 0) > 0) return 'FAIL';

  if (isLivenessProfile(summary.profile) || summary.status === 'RECORDED') {
    return 'RECORDED';
  }

  const thresholdStatus = summary.thresholds?.status;
  if (thresholdStatus === 'breached') return 'FAIL';
  if (thresholdStatus === 'met' && summary.thresholds?.defined) return 'PASS';

  return 'RECORDED';
}

interface PlaywrightResult {
  status?: string;
}

interface PlaywrightTest {
  projectName?: string;
  projectId?: string;
  results?: PlaywrightResult[];
}

interface PlaywrightSpec {
  title?: string;
  file?: string;
  ok?: boolean;
  tests?: PlaywrightTest[];
}

interface PlaywrightSuite {
  title?: string;
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightReport {
  suites?: PlaywrightSuite[];
}

interface PostmanExecution {
  item?: { name?: string };
  request?: { method?: string; url?: string | { raw?: string } };
  requestExecuted?: { url?: { protocol?: string; host?: string[]; path?: string[] } };
  assertions?: Array<{ error?: unknown }>;
}

interface PostmanReport {
  run?: { executions?: PostmanExecution[] };
}

const URL_IN_TEXT = /https?:\/\/[^\s)'"]+/gi;
const PATH_IN_TEXT = /(?:^|[\s"'`(=])(\/[A-Za-z0-9._~#?&=+%,/-]*)/g;
const LOCATOR_IN_TEXT = /(?:#[A-Za-z_][\w-]*)|(?:\[[a-z-]+(?:=[^\]]+)?\])|(?:text=[^\s]+)/gi;

function normalizeStatus(status: string | undefined, ok?: boolean): ExecutionEvidence['status'] {
  const upper = (status ?? (ok ? 'passed' : 'failed')).toUpperCase();
  if (upper === 'PASSED' || upper === 'PASS' || upper === 'EXPECTED') return 'PASS';
  if (upper === 'FAILED' || upper === 'FAIL' || upper === 'UNEXPECTED' || upper === 'TIMEDOUT') return 'FAIL';
  if (upper === 'SKIPPED') return 'SKIPPED';
  return 'UNKNOWN';
}

export function extractHints(text: string): { urlHints: string[]; locatorHints: string[] } {
  const urlHints = [...(text.match(URL_IN_TEXT) ?? [])];
  let pathMatch: RegExpExecArray | null;
  PATH_IN_TEXT.lastIndex = 0;
  while ((pathMatch = PATH_IN_TEXT.exec(text)) !== null) {
    const value = pathMatch[1];
    if (value && value.length > 1 && !urlHints.includes(value)) urlHints.push(value);
  }
  const locatorHints = [...(text.match(LOCATOR_IN_TEXT) ?? [])];
  return { urlHints, locatorHints };
}

function flattenPlaywright(
  suites: PlaywrightSuite[] | undefined,
  source: 'playwright' | 'visual' | 'responsive' | 'cross-browser' | 'accessibility' | 'workflow',
  idPrefix: string
): ExecutionEvidence[] {
  if (!suites) return [];
  const rows: ExecutionEvidence[] = [];
  let seq = 1;

  const walk = (nodes: PlaywrightSuite[] | undefined, file: string) => {
    if (!nodes) return;
    for (const suite of nodes) {
      const nextFile = suite.file ?? suite.title ?? file;
      for (const spec of suite.specs ?? []) {
        const specFile = path.basename(spec.file ?? nextFile);
        for (const test of spec.tests ?? []) {
          const result = (test.results ?? [])[(test.results ?? []).length - 1];
          const status = normalizeStatus(result?.status, spec.ok);
          const title = spec.title ?? '';
          const hints = extractHints(`${title} ${specFile}`);
          rows.push({
            id: `${idPrefix}-${String(seq++).padStart(4, '0')}`,
            source,
            title,
            file: specFile,
            urlHints: hints.urlHints,
            locatorHints: hints.locatorHints,
            browser: test.projectName ?? test.projectId,
            status,
            executed: status === 'PASS' || status === 'FAIL',
          });
        }
      }
      walk(suite.suites, nextFile);
    }
  };

  walk(suites, '');
  return rows;
}

function loadSuite(
  suiteName: PlaywrightSuiteName,
  source: 'playwright' | 'visual' | 'responsive' | 'cross-browser' | 'accessibility' | 'workflow',
  idPrefix: string
): ExecutionEvidence[] {
  const filePath = PLAYWRIGHT_SUITE_OUTPUT_PATHS[suiteName];
  if (!fs.existsSync(filePath)) return [];
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PlaywrightReport;
  return flattenPlaywright(report.suites, source, idPrefix);
}

function loadPlaywright(): ExecutionEvidence[] {
  return [
    ...loadSuite('e2e', 'playwright', 'PW'),
    ...loadSuite('generated-check', 'playwright', 'GEN'),
  ];
}

function loadVisual(): ExecutionEvidence[] {
  return loadSuite('visual', 'visual', 'VIS');
}

function loadResponsive(): ExecutionEvidence[] {
  return loadSuite('responsive', 'responsive', 'VP');
}

function loadCrossBrowser(): ExecutionEvidence[] {
  return loadSuite('cross-browser', 'cross-browser', 'XB');
}

function loadAccessibility(): ExecutionEvidence[] {
  return loadSuite('accessibility', 'accessibility', 'A11Y');
}

function loadWorkflows(): ExecutionEvidence[] {
  return loadSuite('workflows', 'workflow', 'WF');
}

function loadSecurity(): ExecutionEvidence[] {
  const filePath = path.join(PATHS.reports.security, 'summary.json');
  if (!fs.existsSync(filePath)) return [];
  const summary = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SecuritySummary;
  return [
    {
      id: 'SEC-0001',
      source: 'security',
      title: 'QA-level security baseline',
      file: 'summary.json',
      urlHints: summary.target ? [summary.target] : [],
      locatorHints: [],
      status: summary.failCount > 0 || !summary.passed ? 'FAIL' : 'PASS',
      executed: true,
    },
  ];
}

function loadSeo(): ExecutionEvidence[] {
  const filePath = path.join(PATHS.reports.seo, 'summary.json');
  if (!fs.existsSync(filePath)) return [];
  const summary = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SeoSuiteSummary;
  return [
    {
      id: 'SEO-0001',
      source: 'seo',
      title: 'Technical SEO baseline',
      file: 'summary.json',
      urlHints: summary.target ? [summary.target] : [],
      locatorHints: [],
      status: summary.failCount > 0 || !summary.passed ? 'FAIL' : 'PASS',
      executed: true,
    },
  ];
}

function loadContent(): ExecutionEvidence[] {
  const filePath = path.join(PATHS.reports.content, 'summary.json');
  if (!fs.existsSync(filePath)) return [];
  const summary = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ContentSummary;
  return [
    {
      id: 'CONTENT-0001',
      source: 'content',
      title: 'Content QA baseline',
      file: 'summary.json',
      urlHints: summary.target ? [summary.target] : [],
      locatorHints: [],
      status: summary.failCount > 0 || !summary.passed ? 'FAIL' : 'PASS',
      executed: true,
    },
  ];
}

function loadJmeter(): ExecutionEvidence[] {
  const filePath = PATHS.jmeterSummary;
  if (!fs.existsSync(filePath)) return [];
  const summary = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PerformanceSummary;
  const executed = jmeterRunExecuted(summary);
  return [
    {
      id: `JMETER-${summary.profile}`,
      source: 'jmeter',
      title: `${summary.profile} performance profile against ${summary.target}`,
      file: path.basename(summary.plan),
      urlHints: summary.target ? [summary.target] : [],
      locatorHints: [],
      status: jmeterEvidenceStatus(summary),
      executed,
    },
  ];
}

function loadPostman(): ExecutionEvidence[] {
  const filePath = path.join(PATHS.reports.postman, 'report.json');
  if (!fs.existsSync(filePath)) return [];
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PostmanReport;
  const rows: ExecutionEvidence[] = [];
  let seq = 1;
  for (const exec of report.run?.executions ?? []) {
    const name = exec.item?.name ?? 'unnamed request';
    const rawUrl =
      typeof exec.request?.url === 'string' ? exec.request.url : exec.request?.url?.raw ?? '';
    const executedUrl = exec.requestExecuted?.url;
    const rebuilt = executedUrl
      ? `${executedUrl.protocol ?? 'https'}://${(executedUrl.host ?? []).join('.')}/${(executedUrl.path ?? []).join('/')}`
      : rawUrl;
    const failed = (exec.assertions ?? []).some((a) => Boolean(a.error));
    const hints = extractHints(`${name} ${rebuilt} ${rawUrl}`);
    if (rebuilt) hints.urlHints.push(rebuilt);
    rows.push({
      id: `PM-${String(seq++).padStart(4, '0')}`,
      source: 'postman',
      title: name,
      urlHints: [...new Set(hints.urlHints)],
      locatorHints: [],
      status: failed ? 'FAIL' : 'PASS',
      executed: true,
    });
  }
  return rows;
}

export function loadExecutionEvidence(): ExecutionEvidence[] {
  return [
    ...loadPlaywright(),
    ...loadVisual(),
    ...loadResponsive(),
    ...loadCrossBrowser(),
    ...loadAccessibility(),
    ...loadWorkflows(),
    ...loadPostman(),
    ...loadJmeter(),
    ...loadSecurity(),
    ...loadSeo(),
    ...loadContent(),
  ];
}

export function playwrightResultsExist(): boolean {
  return (
    fs.existsSync(PLAYWRIGHT_SUITE_OUTPUT_PATHS.e2e) ||
    fs.existsSync(PLAYWRIGHT_SUITE_OUTPUT_PATHS['generated-check'])
  );
}

/** Suite summaries with NOT_EXECUTED / skipReason — recorded, never treated as coverage. */
export function loadSuiteExecutionNotes(): string[] {
  const notes: string[] = [];
  for (const suiteName of PLAYWRIGHT_SUITE_NAMES) {
    const summary = readJsonIfExists<PlaywrightSuiteSummary>(playwrightSuiteSummaryPath(suiteName));
    if (!summary) continue;
    if (summary.skipReason) {
      notes.push(
        `Playwright suite '${suiteName}' is NOT_EXECUTED → recorded, not coverage: ${summary.skipReason}`
      );
    }
    for (const browser of summary.browsers ?? []) {
      if (browser.status === 'NOT_EXECUTED' && browser.reason) {
        notes.push(
          `Browser ${browser.browser} in '${suiteName}' is NOT_EXECUTED → SKIPPED WITH REASON / UNCOVERED: ${browser.reason}`
        );
      }
    }
  }
  return notes;
}
