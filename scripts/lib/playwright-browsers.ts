export type PlaywrightBrowser = 'chromium' | 'firefox' | 'webkit';

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
