import fs from 'fs';
import path from 'path';
import { PATHS, ROOT } from './paths';
import {
  ALL_PLAYWRIGHT_ENGINES,
  toPosixRelative,
  type PlaywrightSuiteName,
} from './playwright-suites';
import type { PlaywrightBrowser } from './playwright-browsers';
import { NOT_AVAILABLE } from './suite-origin';

export { NOT_AVAILABLE };

export interface PlaywrightJsonError {
  message?: string;
  stack?: string;
}

export interface PlaywrightJsonAttachment {
  name?: string;
  path?: string;
  contentType?: string;
}

export interface PlaywrightJsonResult {
  status?: string;
  duration?: number;
  startTime?: string;
  retry?: number;
  error?: PlaywrightJsonError;
  errors?: PlaywrightJsonError[];
  attachments?: PlaywrightJsonAttachment[];
}

export interface PlaywrightJsonTest {
  projectName?: string;
  projectId?: string;
  annotations?: Array<{ type: string; description?: string }>;
  results?: PlaywrightJsonResult[];
}

export interface PlaywrightJsonSpec {
  title?: string;
  file?: string;
  ok?: boolean;
  tests?: PlaywrightJsonTest[];
}

export interface PlaywrightJsonSuite {
  title?: string;
  file?: string;
  specs?: PlaywrightJsonSpec[];
  suites?: PlaywrightJsonSuite[];
}

export interface PlaywrightJsonReport {
  config?: { projects?: Array<{ name: string }> };
  suites?: PlaywrightJsonSuite[];
  stats?: {
    startTime?: string;
    expected?: number;
    unexpected?: number;
    skipped?: number;
    duration?: number;
  };
}

export interface PlaywrightAssertionPair {
  expected: string;
  actual: string;
}

/**
 * Per failed execution — typed for enterprise report section 2.6.5.
 * The report-generator agent renders this; do not add section 2.6.5 here.
 */
export interface PlaywrightFailedExecution {
  title: string;
  specFile: string;
  projectName: string;
  errorMessage: string;
  assertion: PlaywrightAssertionPair;
  firstRepoStackFrame: string;
  stackTrace: string;
  retryCount: number;
  screenshotPath: string;
  tracePath: string;
  videoPath: string;
}

export interface PlaywrightFailureDetailSection {
  source: 'playwright-failure-details';
  suiteName: PlaywrightSuiteName;
  resultsFile: string;
  executions: PlaywrightFailedExecution[];
}

export type BrowserExecutionStatus = 'EXECUTED' | 'NOT_EXECUTED';

export interface PlaywrightBrowserSuiteStats {
  browser: PlaywrightBrowser;
  status: BrowserExecutionStatus;
  reason: string;
  total: number | typeof NOT_AVAILABLE;
  passed: number | typeof NOT_AVAILABLE;
  failed: number | typeof NOT_AVAILABLE;
  skipped: number | typeof NOT_AVAILABLE;
}

export function walkPlaywrightSpecs(suites: PlaywrightJsonSuite[] | undefined): PlaywrightJsonSpec[] {
  if (!suites) return [];
  const out: PlaywrightJsonSpec[] = [];
  for (const suite of suites) {
    if (suite.specs) out.push(...suite.specs);
    out.push(...walkPlaywrightSpecs(suite.suites));
  }
  return out;
}

export function loadPlaywrightJsonReport(resultsPath: string): PlaywrightJsonReport | null {
  if (!fs.existsSync(resultsPath)) return null;
  return JSON.parse(fs.readFileSync(resultsPath, 'utf8')) as PlaywrightJsonReport;
}

export function combinedErrorMessage(result: PlaywrightJsonResult): string {
  const parts: string[] = [];
  if (result.error?.message) parts.push(result.error.message);
  for (const err of result.errors ?? []) {
    if (err.message && !parts.includes(err.message)) parts.push(err.message);
  }
  return parts.join('\n');
}

export function combinedErrorStack(result: PlaywrightJsonResult): string {
  const parts: string[] = [];
  if (result.error?.stack) parts.push(result.error.stack);
  for (const err of result.errors ?? []) {
    if (err.stack && !parts.includes(err.stack)) parts.push(err.stack);
  }
  return parts.join('\n');
}

/** Never truncates. Missing values stay `NOT_AVAILABLE`. */
export function parseAssertionExpectedActual(errorMessage: string): PlaywrightAssertionPair {
  if (!errorMessage) {
    return { expected: NOT_AVAILABLE, actual: NOT_AVAILABLE };
  }
  const expectedMatch = errorMessage.match(/Expected:\s*([^\n\r]+)/);
  const receivedMatch = errorMessage.match(/(?:Received|Actual):\s*([^\n\r]+)/);
  return {
    expected: expectedMatch?.[1]?.trim() || NOT_AVAILABLE,
    actual: receivedMatch?.[1]?.trim() || NOT_AVAILABLE,
  };
}

export function firstRepoStackFrame(stack: string, root = ROOT): string {
  if (!stack) return NOT_AVAILABLE;
  const rootNorm = path.normalize(root);
  const prefix = rootNorm.endsWith(path.sep) ? rootNorm : rootNorm + path.sep;

  for (const line of stack.split(/\r?\n/)) {
    if (line.includes(`${path.sep}node_modules${path.sep}`) || line.includes('/node_modules/')) {
      continue;
    }
    const match = line.match(
      /\(?((?:[A-Za-z]:)?[/\\][^:\n]+|(?:tests|scripts|pages|fixtures|utils)[/\\][^:\n]+):(\d+):(\d+)\)?/
    );
    if (!match) continue;
    const filePart = match[1];
    const loc = `${match[2]}:${match[3]}`;
    if (path.isAbsolute(filePart)) {
      const abs = path.normalize(filePart);
      if (abs.toLowerCase().startsWith(prefix.toLowerCase()) || abs.toLowerCase() === rootNorm.toLowerCase()) {
        return `${toPosixRelative(abs, root)}:${loc}`;
      }
      continue;
    }
    return `${filePart.replace(/\\/g, '/')}:${loc}`;
  }
  return NOT_AVAILABLE;
}

function attachmentPath(
  attachments: PlaywrightJsonAttachment[] | undefined,
  kind: 'screenshot' | 'trace' | 'video'
): string {
  if (!attachments?.length) return NOT_AVAILABLE;
  const match = attachments.find((row) => {
    const name = (row.name ?? '').toLowerCase();
    const type = (row.contentType ?? '').toLowerCase();
    if (kind === 'screenshot') return type.startsWith('image/') || name.includes('screenshot');
    if (kind === 'trace') return name === 'trace' || type.includes('zip') || name.includes('trace');
    return type.startsWith('video/') || name.includes('video');
  });
  if (!match?.path) return NOT_AVAILABLE;
  const abs = path.isAbsolute(match.path) ? match.path : path.resolve(ROOT, match.path);
  if (!fs.existsSync(abs)) {
    return toPosixRelative(abs);
  }
  return toPosixRelative(abs);
}

function isFailedStatus(status: string | undefined): boolean {
  const upper = (status ?? '').toUpperCase();
  return upper === 'FAILED' || upper === 'FAIL' || upper === 'UNEXPECTED' || upper === 'TIMEDOUT' || upper === 'INTERRUPTED';
}

export function parseFailedExecutions(
  report: PlaywrightJsonReport | null,
  suiteName: PlaywrightSuiteName,
  resultsFile: string
): PlaywrightFailureDetailSection {
  const executions: PlaywrightFailedExecution[] = [];
  const specs = walkPlaywrightSpecs(report?.suites);

  for (const spec of specs) {
    const specFile = spec.file ? path.basename(spec.file) : NOT_AVAILABLE;
    for (const test of spec.tests ?? []) {
      const results = test.results ?? [];
      results.forEach((result, index) => {
        if (!isFailedStatus(result.status)) return;
        const errorMessage = combinedErrorMessage(result);
        const stack = combinedErrorStack(result);
        executions.push({
          title: spec.title ?? NOT_AVAILABLE,
          specFile,
          projectName: test.projectName ?? test.projectId ?? NOT_AVAILABLE,
          errorMessage,
          assertion: parseAssertionExpectedActual(errorMessage),
          firstRepoStackFrame: firstRepoStackFrame(stack),
          stackTrace: stack || NOT_AVAILABLE,
          retryCount: result.retry ?? index,
          screenshotPath: attachmentPath(result.attachments, 'screenshot'),
          tracePath: attachmentPath(result.attachments, 'trace'),
          videoPath: attachmentPath(result.attachments, 'video'),
        });
      });
    }
  }

  return {
    source: 'playwright-failure-details',
    suiteName,
    resultsFile: toPosixRelative(resultsFile),
    executions,
  };
}

export function parseFailedExecutionsFromFile(
  resultsFile: string,
  suiteName: PlaywrightSuiteName
): PlaywrightFailureDetailSection {
  return parseFailedExecutions(loadPlaywrightJsonReport(resultsFile), suiteName, resultsFile);
}

function projectToEngine(projectName: string | undefined): PlaywrightBrowser | null {
  const lower = (projectName ?? '').toLowerCase();
  if (lower === 'chromium' || lower.includes('chromium') || lower.includes('chrome')) return 'chromium';
  if (lower === 'firefox' || lower.includes('firefox')) return 'firefox';
  if (lower === 'webkit' || lower.includes('webkit') || lower.includes('safari')) return 'webkit';
  return null;
}

export function collectExecutedEngineStats(
  report: PlaywrightJsonReport | null,
  fallbackEngine?: PlaywrightBrowser
): Map<PlaywrightBrowser, { total: number; passed: number; failed: number; skipped: number }> {
  const stats = new Map<PlaywrightBrowser, { total: number; passed: number; failed: number; skipped: number }>();
  const specs = walkPlaywrightSpecs(report?.suites);

  for (const spec of specs) {
    for (const test of spec.tests ?? []) {
      const engine = projectToEngine(test.projectName ?? test.projectId) ?? fallbackEngine;
      if (!engine) continue;
      const results = test.results ?? [];
      const result = results[results.length - 1];
      const status = (result?.status ?? (spec.ok ? 'passed' : 'failed')).toUpperCase();
      const current = stats.get(engine) ?? { total: 0, passed: 0, failed: 0, skipped: 0 };
      current.total += 1;
      if (status === 'PASSED' || status === 'PASS' || status === 'EXPECTED') current.passed += 1;
      else if (status === 'SKIPPED') current.skipped += 1;
      else current.failed += 1;
      stats.set(engine, current);
    }
  }

  return stats;
}

export function buildBrowserSuiteStats(input: {
  report: PlaywrightJsonReport | null;
  executedBrowsers: readonly PlaywrightBrowser[];
  skippedBrowsers: ReadonlyArray<{ browser: PlaywrightBrowser; reason: string }>;
}): PlaywrightBrowserSuiteStats[] {
  const fallback = input.executedBrowsers.length === 1 ? input.executedBrowsers[0] : undefined;
  const executed = collectExecutedEngineStats(input.report, fallback);
  const rows: PlaywrightBrowserSuiteStats[] = [];

  for (const browser of ALL_PLAYWRIGHT_ENGINES) {
    const skipped = input.skippedBrowsers.find((row) => row.browser === browser);
    if (skipped) {
      rows.push({
        browser,
        status: 'NOT_EXECUTED',
        reason: skipped.reason,
        total: NOT_AVAILABLE,
        passed: NOT_AVAILABLE,
        failed: NOT_AVAILABLE,
        skipped: NOT_AVAILABLE,
      });
      continue;
    }

    if (!input.executedBrowsers.includes(browser)) {
      rows.push({
        browser,
        status: 'NOT_EXECUTED',
        reason: `not listed in qa.config.json playwright.browsers`,
        total: NOT_AVAILABLE,
        passed: NOT_AVAILABLE,
        failed: NOT_AVAILABLE,
        skipped: NOT_AVAILABLE,
      });
      continue;
    }

    const counts = executed.get(browser);
    rows.push({
      browser,
      status: 'EXECUTED',
      reason: '',
      total: counts?.total ?? 0,
      passed: counts?.passed ?? 0,
      failed: counts?.failed ?? 0,
      skipped: counts?.skipped ?? 0,
    });
  }

  return rows;
}

export function playwrightResultsExistAt(resultsPath: string): boolean {
  return fs.existsSync(resultsPath);
}

export function anyPlaywrightSuiteResultsExist(suiteNames: readonly PlaywrightSuiteName[]): boolean {
  return suiteNames.some((name) =>
    fs.existsSync(path.join(PATHS.reports.playwright, name, 'results.json'))
  );
}
