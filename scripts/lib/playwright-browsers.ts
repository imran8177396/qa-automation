import fs from 'fs';

export type PlaywrightBrowser = 'chromium' | 'firefox' | 'webkit';

export const ALL_PLAYWRIGHT_BROWSERS: readonly PlaywrightBrowser[] = ['chromium', 'firefox', 'webkit'];

export interface PlaywrightConfig {
  enabled: boolean;
  baseURL: string;
  /** @deprecated Use browsers[] instead */
  browser?: PlaywrightBrowser;
  browsers?: PlaywrightBrowser[];
  headless: boolean;
}

export function resolvePlaywrightBrowsers(playwright: PlaywrightConfig): PlaywrightBrowser[] {
  if (playwright.browsers?.length) {
    return playwright.browsers;
  }

  if (playwright.browser) {
    return [playwright.browser];
  }

  return ['chromium'];
}

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
