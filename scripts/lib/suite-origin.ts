import { loadConfig } from './load-config';
import {
  suiteRequiresConfiguredOrigin,
  type PlaywrightSuiteName,
} from './playwright-suites';

export const NOT_AVAILABLE = 'NOT_AVAILABLE';

export type SuiteOriginComparison = 'VALID' | 'INVALID';

/** Origin of a URL, or `NOT_AVAILABLE` when the value cannot be parsed. */
export function originOf(url: string): string {
  if (!url || url === NOT_AVAILABLE) return NOT_AVAILABLE;
  try {
    return new URL(url).origin;
  } catch {
    return NOT_AVAILABLE;
  }
}

/**
 * Compare a suite's recorded target origin to `qa.config.json` playwright.baseURL.
 * Report-generator agent: use this to mark Layer evidence INVALID on mismatch.
 * Does not implement Layer 1 / Layer 4 blocking notes.
 */
export function compareSuiteOriginToBaseUrl(suiteOrigin: string, baseURL: string): SuiteOriginComparison {
  const suite = originOf(suiteOrigin);
  const configured = originOf(baseURL);
  if (suite === NOT_AVAILABLE || configured === NOT_AVAILABLE) return 'INVALID';
  return suite === configured ? 'VALID' : 'INVALID';
}

export function resolveConfiguredPlaywrightBaseUrl(): string {
  const config = loadConfig();
  return config.playwright.baseURL;
}

/** Resolved target the suite will actually hit (env override, then explicit, then config). */
export function resolveSuiteTargetOrigin(explicitUrl?: string): string {
  const raw = explicitUrl || process.env.QA_PLAYWRIGHT_BASE_URL || resolveConfiguredPlaywrightBaseUrl();
  return originOf(raw);
}

/**
 * Fails the run early when a product suite's target does not match
 * `qa.config.json` playwright.baseURL. Visual / responsive / accessibility /
 * workflows are product suites — a live configured origin must not be replaced
 * by the local fixture.
 */
export function assertSuiteOriginMatchesBaseUrl(
  suiteName: PlaywrightSuiteName,
  suiteOrigin: string,
  baseURL: string
): void {
  if (!suiteRequiresConfiguredOrigin(suiteName)) return;
  if (compareSuiteOriginToBaseUrl(suiteOrigin, baseURL) === 'INVALID') {
    throw new Error(
      `Suite '${suiteName}' target origin (${suiteOrigin}) does not match qa.config.json playwright.baseURL (${baseURL}). Refusing to run against the wrong origin.`
    );
  }
}
