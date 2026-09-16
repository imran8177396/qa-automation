import fs from 'fs';
import { writeJson } from '../discovery/write-json';
import {
  ALL_PLAYWRIGHT_ENGINES,
  PLAYWRIGHT_ENGINE_CAVEATS,
  assertUniquePlaywrightSuitePaths,
  playwrightSuiteDir,
  playwrightSuiteResultsPath,
  playwrightSuiteSummaryPath,
  toPosixRelative,
  type PlaywrightSuiteName,
} from './playwright-suites';
import {
  buildBrowserSuiteStats,
  loadPlaywrightJsonReport,
  parseFailedExecutionsFromFile,
  type PlaywrightBrowserSuiteStats,
  type PlaywrightFailureDetailSection,
} from './playwright-results';
import type { PlaywrightBrowser } from './playwright-browsers';
import {
  assertSuiteOriginMatchesBaseUrl,
  compareSuiteOriginToBaseUrl,
  originOf,
  type SuiteOriginComparison,
} from './suite-origin';

export interface PlaywrightSuiteSummary {
  generatedAt: string;
  suiteName: PlaywrightSuiteName;
  targetOrigin: string;
  configuredBaseUrl: string;
  originStatus: SuiteOriginComparison;
  passed: boolean;
  executed: boolean;
  /** Present when the suite did not run checks (empty/missing plan, etc.). */
  skipReason?: string;
  resultsFile: string;
  browsers: PlaywrightBrowserSuiteStats[];
  engineCaveats: string[];
  failureDetails: PlaywrightFailureDetailSection | null;
}

/** Collision guard + origin record + product-suite preflight. Call at the start of every suite. */
export function preparePlaywrightSuite(input: {
  suiteName: PlaywrightSuiteName;
  targetUrl: string;
  configuredBaseUrl: string;
}): PlaywrightSuiteSummary {
  assertUniquePlaywrightSuitePaths();
  fs.mkdirSync(playwrightSuiteDir(input.suiteName), { recursive: true });
  const started = beginPlaywrightSuiteSummary({
    suiteName: input.suiteName,
    targetOrigin: originOf(input.targetUrl),
    configuredBaseUrl: originOf(input.configuredBaseUrl),
  });
  assertSuiteOriginMatchesBaseUrl(input.suiteName, started.targetOrigin, input.configuredBaseUrl);
  return started;
}

export function beginPlaywrightSuiteSummary(input: {
  suiteName: PlaywrightSuiteName;
  targetOrigin: string;
  configuredBaseUrl: string;
}): PlaywrightSuiteSummary {
  const summary: PlaywrightSuiteSummary = {
    generatedAt: new Date().toISOString(),
    suiteName: input.suiteName,
    targetOrigin: input.targetOrigin,
    configuredBaseUrl: input.configuredBaseUrl,
    originStatus: compareSuiteOriginToBaseUrl(input.targetOrigin, input.configuredBaseUrl),
    passed: false,
    executed: false,
    resultsFile: toPosixRelative(playwrightSuiteResultsPath(input.suiteName)),
    browsers: [],
    engineCaveats: [...PLAYWRIGHT_ENGINE_CAVEATS],
    failureDetails: null,
  };
  writeJson(playwrightSuiteSummaryPath(input.suiteName), summary);
  return summary;
}

export function completePlaywrightSuite(
  started: PlaywrightSuiteSummary,
  input: {
    passed: boolean;
    executedBrowsers: readonly PlaywrightBrowser[];
    skippedBrowsers: ReadonlyArray<{ browser: PlaywrightBrowser; reason: string }>;
  }
): PlaywrightSuiteSummary {
  const resultsFile = playwrightSuiteResultsPath(started.suiteName);
  return finishPlaywrightSuiteSummary(started, {
    passed: input.passed,
    browsers: buildBrowserSuiteStats({
      report: loadPlaywrightJsonReport(resultsFile),
      executedBrowsers: input.executedBrowsers,
      skippedBrowsers: input.skippedBrowsers,
    }),
    failureDetails: parseFailedExecutionsFromFile(resultsFile, started.suiteName),
  });
}

export function finishPlaywrightSuiteSummary(
  started: PlaywrightSuiteSummary,
  update: {
    passed: boolean;
    browsers: PlaywrightBrowserSuiteStats[];
    failureDetails: PlaywrightFailureDetailSection | null;
  }
): PlaywrightSuiteSummary {
  const summary: PlaywrightSuiteSummary = {
    ...started,
    generatedAt: new Date().toISOString(),
    passed: update.passed,
    executed: true,
    browsers: update.browsers,
    failureDetails: update.failureDetails,
  };
  writeJson(playwrightSuiteSummaryPath(started.suiteName), summary);
  return summary;
}

/**
 * Honest empty/missing generated-check plan: 0 checks, executed=false.
 * Process success (passed=true) so test:e2e does not FAIL a suite that never ran.
 */
export function recordPlaywrightSuiteNotExecuted(
  started: PlaywrightSuiteSummary,
  input: { reason: string }
): PlaywrightSuiteSummary {
  const skippedBrowsers = ALL_PLAYWRIGHT_ENGINES.map((browser) => ({
    browser,
    reason: input.reason,
  }));
  const summary: PlaywrightSuiteSummary = {
    ...started,
    generatedAt: new Date().toISOString(),
    passed: true,
    executed: false,
    skipReason: input.reason,
    browsers: buildBrowserSuiteStats({
      report: null,
      executedBrowsers: [],
      skippedBrowsers,
    }),
    failureDetails: null,
  };
  writeJson(playwrightSuiteSummaryPath(started.suiteName), summary);
  return summary;
}
