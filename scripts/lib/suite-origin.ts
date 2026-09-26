import { loadConfig } from './load-config';
import { persistCliWebsiteUrl, readLastTargetUrl, websiteTargetEnv } from './last-target';
import {
  isLoopbackUrl,
  parseOrchestratorCli,
  resolveWebsiteTarget,
} from '../orchestrator/resolve-url';
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
 * Compare a suite's recorded target origin to the resolved Playwright origin.
 * Report-generator agent: use this to mark Layer evidence INVALID on mismatch.
 * Does not implement Layer 1 / Layer 4 blocking notes.
 */
export function compareSuiteOriginToBaseUrl(suiteOrigin: string, baseURL: string): SuiteOriginComparison {
  const suite = originOf(suiteOrigin);
  const configured = originOf(baseURL);
  if (suite === NOT_AVAILABLE || configured === NOT_AVAILABLE) return 'INVALID';
  return suite === configured ? 'VALID' : 'INVALID';
}

export function normalizePlaywrightBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function isValidHttpUrl(url: string): boolean {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function assertValidPlaywrightBaseUrl(url: string): string {
  const normalized = normalizePlaywrightBaseUrl(url);
  if (!isValidHttpUrl(normalized)) {
    throw new Error(
      `No valid Playwright target URL is available (CLI --url, QA_PLAYWRIGHT_BASE_URL / QA_WEBSITE_URL, qa.last-target.json, or qa.config.json urls.website). REQUIRES_CONFIGURATION — refusing to test an unknown or invalid site ('${url || 'empty'}').`
    );
  }
  return normalized;
}

export function captureShellPlaywrightUrls(): {
  capturedEnvUrl: string;
  capturedWebsiteUrl: string;
} {
  return {
    capturedEnvUrl: process.env.QA_PLAYWRIGHT_BASE_URL?.trim() ?? '',
    capturedWebsiteUrl: process.env.QA_WEBSITE_URL?.trim() ?? '',
  };
}

/**
 * Config-only Playwright fallback when CLI / env / last-target are unset:
 * loopback `playwright.baseURL` when explicitly set and loopback, otherwise
 * `urls.website`. Non-loopback `playwright.baseURL` is ignored — it is not a
 * general live-site override. Never invents a host.
 */
export function configFallbackPlaywrightBaseUrl(
  config: {
    playwright?: { baseURL?: string };
    urls?: { website?: string };
  } = loadConfig()
): string {
  const explicit = config.playwright?.baseURL?.trim() ?? '';
  if (explicit && isLoopbackUrl(explicit)) {
    return normalizePlaywrightBaseUrl(explicit);
  }
  return normalizePlaywrightBaseUrl(config.urls?.website?.trim() ?? '');
}

/**
 * Expected Playwright origin via {@link resolveWebsiteTarget} (no discovery seed):
 * 1. orchestrator / CLI `--url` already exported as `QA_PLAYWRIGHT_BASE_URL`
 * 2. `QA_WEBSITE_URL`
 * 3. persisted last-target (`qa.last-target.json`)
 * 4. loopback `playwright.baseURL` only when loopback
 * 5. `qa.config.json` active `environments[active].websiteUrl` or `urls.website`
 *
 * Playwright configs should pass URLs captured *before* loading
 * `config/generated.env`, so a leftover sync file cannot retarget the suite.
 */
export function resolveConfiguredPlaywrightBaseUrl(options?: {
  lastTargetUrl?: string | null;
  capturedEnvUrl?: string;
  capturedWebsiteUrl?: string;
  websiteUrl?: string;
  playwrightBaseUrl?: string;
  /**
   * Precomputed loopback-or-website fallback from {@link configFallbackPlaywrightBaseUrl}.
   * Prefer passing `websiteUrl` + `playwrightBaseUrl` separately when available.
   */
  configBaseUrl?: string;
}): string {
  const loaded = loadConfig();
  const fromPlaywrightEnv = (options?.capturedEnvUrl ?? process.env.QA_PLAYWRIGHT_BASE_URL)?.trim();
  const fromWebsiteEnv = (options?.capturedWebsiteUrl ?? process.env.QA_WEBSITE_URL)?.trim();
  const lastTarget =
    options?.lastTargetUrl !== undefined ? options.lastTargetUrl : readLastTargetUrl();

  let playwrightBaseUrl = options?.playwrightBaseUrl?.trim() || loaded.playwright?.baseURL?.trim() || '';
  let websiteUrl = options?.websiteUrl?.trim() || loaded.urls.website?.trim() || '';

  // Playwright configs historically pass configFallbackPlaywrightBaseUrl() as
  // configBaseUrl. Expand that into step 6 (loopback) or step 7 (website).
  const legacyFallback = options?.configBaseUrl?.trim() || '';
  if (legacyFallback && options?.websiteUrl === undefined && options?.playwrightBaseUrl === undefined) {
    if (isLoopbackUrl(legacyFallback)) {
      playwrightBaseUrl = legacyFallback;
    } else {
      websiteUrl = legacyFallback;
      playwrightBaseUrl = '';
    }
  }

  return normalizePlaywrightBaseUrl(
    resolveWebsiteTarget({
      playwrightEnvUrl: fromPlaywrightEnv,
      websiteEnvUrl: fromWebsiteEnv,
      lastTargetUrl: lastTarget,
      playwrightBaseUrl: playwrightBaseUrl || undefined,
      websiteUrl: websiteUrl || loaded.urls.website,
      environments: loaded.environments,
      activeEnvironment: loaded.environment?.active,
    })
  );
}

/**
 * Persist CLI `--url` / positional URL via `qa.last-target.json`, then export
 * `QA_WEBSITE_URL` + `QA_PLAYWRIGHT_BASE_URL` so every suite in this process
 * hits the same site. Subsequent suite commands reuse the persist file.
 */
export function applyCliWebsiteTarget(argv: string[] = process.argv.slice(2)): string {
  const { url: cliUrl } = parseOrchestratorCli(argv);
  if (cliUrl) {
    const recorded = persistCliWebsiteUrl(cliUrl);
    if (!recorded) {
      throw new Error(
        `Invalid --url '${cliUrl}'. Expected an http(s) URL. REQUIRES_CONFIGURATION — refusing to test an unknown site.`
      );
    }
    Object.assign(process.env, websiteTargetEnv(recorded.websiteUrl));
  }
  const resolved = assertValidPlaywrightBaseUrl(resolveConfiguredPlaywrightBaseUrl());
  Object.assign(process.env, websiteTargetEnv(resolved));
  return resolved;
}

/** Resolved target the suite will actually hit (env override, then explicit, then config). */
export function resolveSuiteTargetOrigin(explicitUrl?: string): string {
  const raw = explicitUrl || process.env.QA_PLAYWRIGHT_BASE_URL || resolveConfiguredPlaywrightBaseUrl();
  return originOf(raw);
}

/**
 * Fails the run early when a product suite's target does not match the
 * resolved origin (`QA_PLAYWRIGHT_BASE_URL` / `--url` / `QA_WEBSITE_URL` /
 * last-target / `urls.website`). Visual / responsive / accessibility /
 * workflows are product suites — a live configured origin must not be
 * replaced by the local fixture.
 */
export function assertSuiteOriginMatchesBaseUrl(
  suiteName: PlaywrightSuiteName,
  suiteOrigin: string,
  baseURL: string
): void {
  if (!suiteRequiresConfiguredOrigin(suiteName)) return;
  if (compareSuiteOriginToBaseUrl(suiteOrigin, baseURL) === 'INVALID') {
    throw new Error(
      `Suite '${suiteName}' target origin (${suiteOrigin}) does not match the resolved Playwright origin (${baseURL}). Refusing to run against the wrong origin.`
    );
  }
}
