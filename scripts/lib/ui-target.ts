import { loadConfig } from './load-config';
import { isLoopbackUrl, resolveWebsiteTarget } from '../orchestrator/resolve-url';
import { readLastTargetUrl } from './last-target';
import { normalizePlaywrightBaseUrl, NOT_AVAILABLE, originOf } from './suite-origin';
import type { QaConfig } from '../types';

export interface ResolvedUiTarget {
  url: string;
  origin: string;
  isLoopback: boolean;
  source: 'env' | 'last-target' | 'config';
}

/**
 * URL every UI suite (e2e, generated, visual, responsive, a11y, workflows) must hit.
 * Delegates to {@link resolveWebsiteTarget} (no discovery seed): Playwright env,
 * then `QA_WEBSITE_URL`, then last-target, then loopback `playwright.baseURL`,
 * then `urls.website`. Never invents a fixture origin when a live URL is configured.
 */
export function resolveUiTarget(
  config: QaConfig = loadConfig(),
  options?: { lastTargetUrl?: string | null }
): ResolvedUiTarget {
  const playwrightEnv = process.env.QA_PLAYWRIGHT_BASE_URL?.trim() || '';
  const websiteEnv = process.env.QA_WEBSITE_URL?.trim() || '';
  const lastTarget =
    options?.lastTargetUrl !== undefined ? options.lastTargetUrl : readLastTargetUrl();
  const url = normalizePlaywrightBaseUrl(
    resolveWebsiteTarget({
      playwrightEnvUrl: playwrightEnv,
      websiteEnvUrl: websiteEnv,
      lastTargetUrl: lastTarget,
      playwrightBaseUrl: config.playwright?.baseURL,
      websiteUrl: config.urls.website,
      environments: config.environments,
      activeEnvironment: config.environment?.active,
    })
  );
  return {
    url,
    origin: originOf(url),
    isLoopback: isLoopbackUrl(url),
    source: playwrightEnv || websiteEnv ? 'env' : lastTarget ? 'last-target' : 'config',
  };
}

export function isFixtureUiTarget(config?: QaConfig): boolean {
  return resolveUiTarget(config).isLoopback;
}

/**
 * Sauce Demo origin used ONLY for example-spec applicability (Swag Labs /
 * data-test checks). Never a navigation or config fallback.
 */
export const EXAMPLE_WEBSITE_ORIGIN = 'https://www.saucedemo.com';

/**
 * True when the resolved website origin is the Sauce Demo example origin the
 * user actually targeted (CLI / env / last-target / explicit resolvedUrl).
 * Example-only Swag Labs / data-test specs must use this gate — they must not
 * assert against an arbitrary `--url` origin.
 */
export function isExampleWebsiteTarget(
  config: QaConfig = loadConfig(),
  options?: { lastTargetUrl?: string | null; resolvedUrl?: string }
): boolean {
  const resolved = options?.resolvedUrl ?? resolveUiTarget(config, options).url;
  const current = originOf(resolved);
  if (current === NOT_AVAILABLE) return false;
  return current === EXAMPLE_WEBSITE_ORIGIN;
}

export const EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON =
  'NOT_APPLICABLE: Sauce Demo / Swag Labs example assertions apply only when the resolved website origin is the Sauce Demo example the user actually targeted. A different --url / QA_WEBSITE_URL / QA_PLAYWRIGHT_BASE_URL target is covered by discovery-driven and generic suites — not by inventing example locators.';
