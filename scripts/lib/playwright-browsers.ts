import fs from 'fs';

export type PlaywrightBrowser = 'chromium' | 'firefox' | 'webkit';

export const ALL_PLAYWRIGHT_BROWSERS: readonly PlaywrightBrowser[] = ['chromium', 'firefox', 'webkit'];

export interface PlaywrightConfig {
  enabled: boolean;
  /** Optional loopback-only fixture override; live targets use resolveWebsiteTarget. */
  baseURL?: string;
  /** @deprecated Use browsers[] instead */
  browser?: PlaywrightBrowser;
  browsers?: PlaywrightBrowser[];
  headless: boolean;
}

export interface PlaywrightEngineSkip {
  browser: PlaywrightBrowser;
  reason: string;
}

export interface ClassifiedPlaywrightBrowsers {
  requested: PlaywrightBrowser[];
  executableBrowsers: PlaywrightBrowser[];
  skippedBrowsers: PlaywrightEngineSkip[];
}

/**
 * Compulsory desktop engines for every Playwright suite.
 * Config / env cannot drop Firefox or WebKit. WebKit ≠ iOS Safari;
 * Chromium ≠ Android Chrome. Missing binaries are BLOCKED / NOT_TESTED.
 */
export function resolveCompulsoryPlaywrightBrowsers(): PlaywrightBrowser[] {
  return [...ALL_PLAYWRIGHT_BROWSERS];
}

/**
 * Every Playwright run uses Chromium + Firefox + WebKit.
 * `qa.config.json` `playwright.browsers` must list those three so config
 * matches behavior; a subset is ignored rather than silently shrinking the matrix.
 */
export function resolvePlaywrightBrowsers(_playwright?: PlaywrightConfig): PlaywrightBrowser[] {
  return resolveCompulsoryPlaywrightBrowsers();
}

/**
 * Same compulsory matrix as default E2E. Dedicated `@cross-browser` tagging
 * is documentation only — it is not what enables the three engines.
 */
export function resolveCrossBrowserEngines(): PlaywrightBrowser[] {
  return resolveCompulsoryPlaywrightBrowsers();
}

export function missingPlaywrightEngineReason(browser: PlaywrightBrowser): string {
  return `Playwright browser binary not installed (${browser}) — recorded NOT_TESTED / BLOCKED, not silently skipped`;
}

export function playwrightProjectArgs(browsers: readonly PlaywrightBrowser[]): string[] {
  return browsers.map((browser) => `--project=${browser}`);
}

export function classifyCompulsoryPlaywrightBrowsers(
  requested: readonly PlaywrightBrowser[] = ALL_PLAYWRIGHT_BROWSERS
): ClassifiedPlaywrightBrowsers {
  const unique = [...requested];
  const skippedBrowsers = unique
    .filter((browser) => !isPlaywrightBrowserInstalled(browser))
    .map((browser) => ({ browser, reason: missingPlaywrightEngineReason(browser) }));
  const executableBrowsers = unique.filter(
    (browser) => !skippedBrowsers.some((row) => row.browser === browser)
  );
  return { requested: unique, executableBrowsers, skippedBrowsers };
}

export const MISSING_CHROMIUM_UNIT_REASON =
  'REQUIRES_CONFIGURATION / BLOCKED: Playwright Chromium binary is not installed at the resolved browser path. Run npx playwright install chromium. Unit tests do not skip this silently.';

export function isPlaywrightBrowserInstalled(browser: PlaywrightBrowser): boolean {
  try {
    // Lazy require so unit tests do not need a launched browser.
    const playwright = require('@playwright/test') as typeof import('@playwright/test');
    const executable = playwright[browser].executablePath();
    return Boolean(executable && fs.existsSync(executable));
  } catch {
    return false;
  }
}
