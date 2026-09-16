import os from 'os';
import path from 'path';
import { PATHS, ROOT, generatedCheckResultsPath } from './paths';
import type { PlaywrightBrowser } from './playwright-browsers';

/**
 * Named Playwright suites. Each suite MUST write JSON to a unique
 * `reports/playwright/<suiteName>/results.json`. A collision guard fails the
 * run if two suites resolve to the same output path.
 *
 * Section 2.6 (generated checks) reads `generatedCheckResultsPath`.
 */
export const PLAYWRIGHT_SUITE_NAMES = [
  'e2e',
  'generated-check',
  'visual',
  'responsive',
  'cross-browser',
  'accessibility',
  'workflows',
] as const;

export type PlaywrightSuiteName = (typeof PLAYWRIGHT_SUITE_NAMES)[number];

/**
 * Product suites must match `qa.config.json` playwright.baseURL (or the
 * orchestrator `--url` / QA_PLAYWRIGHT_BASE_URL) or the run fails.
 * Visual / responsive / accessibility / workflows are product suites so a live
 * target is never silently replaced by the local fixture.
 */
export const PRODUCT_ORIGIN_SUITES: readonly PlaywrightSuiteName[] = [
  'e2e',
  'generated-check',
  'cross-browser',
  'visual',
  'responsive',
  'accessibility',
  'workflows',
];

/**
 * Legacy name kept for readers. These suites used to be fixture-only; they now
 * follow the resolved UI target. Loopback is fixture-scoped; a live origin is not.
 */
export const FIXTURE_ORIGIN_SUITES: readonly PlaywrightSuiteName[] = [];

/** Real Playwright engines. WebKit ≠ iOS Safari; Chromium ≠ Android Chrome. */
export const ALL_PLAYWRIGHT_ENGINES: readonly PlaywrightBrowser[] = ['chromium', 'firefox', 'webkit'];

export const PLAYWRIGHT_ENGINE_CAVEATS = [
  'WebKit is not iOS Safari.',
  'Chromium is not Android Chrome.',
] as const;

export const PLAYWRIGHT_FAILURE_ARTIFACTS = {
  screenshot: 'only-on-failure' as const,
  video: 'retain-on-failure' as const,
  trace: 'retain-on-failure' as const,
};

export const QA_PLAYWRIGHT_SUITE_ENV = 'QA_PLAYWRIGHT_SUITE';

export function playwrightSuiteDir(suiteName: PlaywrightSuiteName): string {
  return path.join(PATHS.reports.playwright, suiteName);
}

export function playwrightSuiteResultsPath(suiteName: PlaywrightSuiteName): string {
  return path.join(playwrightSuiteDir(suiteName), 'results.json');
}

export function playwrightSuiteSummaryPath(suiteName: PlaywrightSuiteName): string {
  return path.join(playwrightSuiteDir(suiteName), 'summary.json');
}

export function playwrightSuiteHtmlDir(suiteName: PlaywrightSuiteName): string {
  return path.join(playwrightSuiteDir(suiteName), 'html');
}

export function playwrightSuiteOutputDir(suiteName: PlaywrightSuiteName): string {
  return path.join(ROOT, 'test-results', 'playwright', suiteName);
}

export { generatedCheckResultsPath };

export const PLAYWRIGHT_SUITE_OUTPUT_PATHS: Record<PlaywrightSuiteName, string> = {
  e2e: playwrightSuiteResultsPath('e2e'),
  'generated-check': generatedCheckResultsPath,
  visual: playwrightSuiteResultsPath('visual'),
  responsive: playwrightSuiteResultsPath('responsive'),
  'cross-browser': playwrightSuiteResultsPath('cross-browser'),
  accessibility: playwrightSuiteResultsPath('accessibility'),
  workflows: playwrightSuiteResultsPath('workflows'),
};

export function isPlaywrightSuiteName(value: string): value is PlaywrightSuiteName {
  return (PLAYWRIGHT_SUITE_NAMES as readonly string[]).includes(value);
}

export function assertNoDuplicateOutputPaths(pathsBySuite: Record<string, string>): void {
  const seen = new Map<string, string>();
  for (const [suite, filePath] of Object.entries(pathsBySuite)) {
    const resolved = path.resolve(filePath);
    const existing = seen.get(resolved);
    if (existing) {
      throw new Error(
        `Playwright suite output collision: '${suite}' and '${existing}' both resolve to ${resolved}`
      );
    }
    seen.set(resolved, suite);
  }
}

/** Fails the run when two registered suites share an output path. */
export function assertUniquePlaywrightSuitePaths(): void {
  assertNoDuplicateOutputPaths(PLAYWRIGHT_SUITE_OUTPUT_PATHS);
}

export function resolvePlaywrightSuiteNameFromEnv(fallback: PlaywrightSuiteName): PlaywrightSuiteName {
  assertUniquePlaywrightSuitePaths();
  const raw = process.env[QA_PLAYWRIGHT_SUITE_ENV];
  if (!raw || raw.trim() === '') return fallback;
  if (!isPlaywrightSuiteName(raw)) {
    throw new Error(
      `Invalid ${QA_PLAYWRIGHT_SUITE_ENV}='${raw}'. Expected one of: ${PLAYWRIGHT_SUITE_NAMES.join(', ')}`
    );
  }
  return raw;
}

export function suiteRequiresConfiguredOrigin(suiteName: PlaywrightSuiteName): boolean {
  return PRODUCT_ORIGIN_SUITES.includes(suiteName);
}

export function playwrightJsonReporterConfig(suiteName: PlaywrightSuiteName): {
  outputFile: string;
} {
  assertUniquePlaywrightSuitePaths();
  return {
    outputFile: path.relative(ROOT, playwrightSuiteResultsPath(suiteName)).replace(/\\/g, '/'),
  };
}

export function playwrightHtmlReporterConfig(suiteName: PlaywrightSuiteName): {
  outputFolder: string;
  open: 'never';
} {
  return {
    outputFolder: path.relative(ROOT, playwrightSuiteHtmlDir(suiteName)).replace(/\\/g, '/'),
    open: 'never',
  };
}

/**
 * Allure Playwright reporter. Writes raw results only — never replaces list/html/json.
 * Screenshots, video, and traces are attached when Playwright retained them.
 */
export function playwrightAllureReporterConfig(suiteName?: PlaywrightSuiteName): {
  resultsDir: string;
  detail: true;
  suiteTitle: true;
  environmentInfo: Record<string, string>;
} {
  const suite = suiteName ?? process.env[QA_PLAYWRIGHT_SUITE_ENV] ?? 'e2e';
  return {
    resultsDir: toPosixRelative(PATHS.allureResults),
    detail: true,
    suiteTitle: true,
    environmentInfo: {
      suite,
      node_version: process.version,
      os_platform: os.platform(),
      os_release: os.release(),
      baseURL: process.env.QA_PLAYWRIGHT_BASE_URL?.trim() || 'NOT_SET',
    },
  };
}

export function toPosixRelative(absPath: string, root = ROOT): string {
  return path.relative(root, absPath).replace(/\\/g, '/');
}
