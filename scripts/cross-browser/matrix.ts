import path from 'path';
import { ALL_PLAYWRIGHT_BROWSERS, type PlaywrightBrowser } from '../lib/playwright-browsers';
import {
  NOT_AVAILABLE,
  attachmentPath,
  combinedErrorMessage,
  projectToEngine,
  walkPlaywrightSpecs,
  type PlaywrightJsonReport,
} from '../lib/playwright-results';

export type EngineCellStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'NOT_EXECUTED';

export interface CrossBrowserEngineCell {
  engine: PlaywrightBrowser;
  status: EngineCellStatus;
  durationMs: number | typeof NOT_AVAILABLE;
  errorMessage: string;
  screenshotPath: string;
  tracePath: string;
  videoPath: string;
}

export interface CrossBrowserMatrixRow {
  title: string;
  specFile: string;
  cells: Record<PlaywrightBrowser, CrossBrowserEngineCell>;
  /** True when the same test passed on at least one engine and failed on another. */
  engineSpecificFailure: boolean;
  passedEngines: PlaywrightBrowser[];
  failedEngines: PlaywrightBrowser[];
}

export interface CrossBrowserFinding {
  kind: 'engine-specific-failure' | 'shared-failure';
  title: string;
  specFile: string;
  failedEngines: PlaywrightBrowser[];
  passedEngines: PlaywrightBrowser[];
  errorMessage: string;
  screenshotPath: string;
  tracePath: string;
  videoPath: string;
}

function emptyCell(engine: PlaywrightBrowser): CrossBrowserEngineCell {
  return {
    engine,
    status: 'NOT_EXECUTED',
    durationMs: NOT_AVAILABLE,
    errorMessage: NOT_AVAILABLE,
    screenshotPath: NOT_AVAILABLE,
    tracePath: NOT_AVAILABLE,
    videoPath: NOT_AVAILABLE,
  };
}

function normalizeCellStatus(status: string | undefined, ok?: boolean): EngineCellStatus {
  const upper = (status ?? (ok ? 'passed' : 'failed')).toUpperCase();
  if (upper === 'PASSED' || upper === 'PASS' || upper === 'EXPECTED') return 'PASS';
  if (upper === 'SKIPPED') return 'SKIPPED';
  if (
    upper === 'FAILED' ||
    upper === 'FAIL' ||
    upper === 'UNEXPECTED' ||
    upper === 'TIMEDOUT' ||
    upper === 'INTERRUPTED'
  ) {
    return 'FAIL';
  }
  return 'NOT_EXECUTED';
}

function rowKey(title: string, specFile: string): string {
  return `${specFile}::${title}`;
}

export function buildCrossBrowserMatrix(report: PlaywrightJsonReport | null): CrossBrowserMatrixRow[] {
  const byKey = new Map<string, CrossBrowserMatrixRow>();
  const specs = walkPlaywrightSpecs(report?.suites);

  for (const spec of specs) {
    const title = spec.title ?? NOT_AVAILABLE;
    const specFile = spec.file ? path.basename(spec.file) : NOT_AVAILABLE;
    const key = rowKey(title, specFile);
    const row =
      byKey.get(key) ??
      ({
        title,
        specFile,
        cells: {
          chromium: emptyCell('chromium'),
          firefox: emptyCell('firefox'),
          webkit: emptyCell('webkit'),
        },
        engineSpecificFailure: false,
        passedEngines: [],
        failedEngines: [],
      } satisfies CrossBrowserMatrixRow);

    for (const test of spec.tests ?? []) {
      const engine = projectToEngine(test.projectName ?? test.projectId);
      if (!engine) continue;
      const result = (test.results ?? [])[(test.results ?? []).length - 1];
      const status = normalizeCellStatus(result?.status, spec.ok);
      const errorMessage = result ? combinedErrorMessage(result) : '';
      row.cells[engine] = {
        engine,
        status,
        durationMs: typeof result?.duration === 'number' ? result.duration : NOT_AVAILABLE,
        errorMessage: errorMessage || NOT_AVAILABLE,
        screenshotPath: attachmentPath(result?.attachments, 'screenshot'),
        tracePath: attachmentPath(result?.attachments, 'trace'),
        videoPath: attachmentPath(result?.attachments, 'video'),
      };
    }

    byKey.set(key, row);
  }

  return [...byKey.values()].map((row) => {
    const passedEngines = ALL_PLAYWRIGHT_BROWSERS.filter((engine) => row.cells[engine].status === 'PASS');
    const failedEngines = ALL_PLAYWRIGHT_BROWSERS.filter((engine) => row.cells[engine].status === 'FAIL');
    return {
      ...row,
      passedEngines: [...passedEngines],
      failedEngines: [...failedEngines],
      engineSpecificFailure: passedEngines.length > 0 && failedEngines.length > 0,
    };
  });
}

export function collectCrossBrowserFindings(rows: CrossBrowserMatrixRow[]): CrossBrowserFinding[] {
  const findings: CrossBrowserFinding[] = [];

  for (const row of rows) {
    if (row.failedEngines.length === 0) continue;
    const primaryFail = row.failedEngines[0];
    const cell = primaryFail ? row.cells[primaryFail] : undefined;
    findings.push({
      kind: row.engineSpecificFailure ? 'engine-specific-failure' : 'shared-failure',
      title: row.title,
      specFile: row.specFile,
      failedEngines: [...row.failedEngines],
      passedEngines: [...row.passedEngines],
      errorMessage: cell?.errorMessage ?? NOT_AVAILABLE,
      screenshotPath: cell?.screenshotPath ?? NOT_AVAILABLE,
      tracePath: cell?.tracePath ?? NOT_AVAILABLE,
      videoPath: cell?.videoPath ?? NOT_AVAILABLE,
    });
  }

  return findings;
}

export function summarizeMatrixRows(rows: CrossBrowserMatrixRow[]): Record<
  PlaywrightBrowser,
  { total: number; passed: number; failed: number; skipped: number; notExecuted: number }
> {
  const summary = {
    chromium: { total: 0, passed: 0, failed: 0, skipped: 0, notExecuted: 0 },
    firefox: { total: 0, passed: 0, failed: 0, skipped: 0, notExecuted: 0 },
    webkit: { total: 0, passed: 0, failed: 0, skipped: 0, notExecuted: 0 },
  };

  for (const row of rows) {
    for (const engine of ALL_PLAYWRIGHT_BROWSERS) {
      const status = row.cells[engine].status;
      summary[engine].total += 1;
      if (status === 'PASS') summary[engine].passed += 1;
      else if (status === 'FAIL') summary[engine].failed += 1;
      else if (status === 'SKIPPED') summary[engine].skipped += 1;
      else summary[engine].notExecuted += 1;
    }
  }

  return summary;
}
