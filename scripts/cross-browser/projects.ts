import { devices, type PlaywrightTestConfig } from '@playwright/test';
import type { PlaywrightBrowser } from '../lib/playwright-browsers';

export function engineProject(browser: PlaywrightBrowser): NonNullable<PlaywrightTestConfig['projects']>[number] {
  const device =
    browser === 'firefox' ? devices['Desktop Firefox'] : browser === 'webkit' ? devices['Desktop Safari'] : devices['Desktop Chrome'];
  return {
    name: browser,
    use: { ...device, browserName: browser },
  };
}
