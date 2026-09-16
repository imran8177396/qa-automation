import { devices, type PlaywrightTestConfig } from '@playwright/test';
import type { PlaywrightBrowser } from '../lib/playwright-browsers';

/**
 * Headless Firefox on Windows often hits SWGL framebuffer mapping failures
 * (`GFX1- RenderCompositorSWGL failed mapping default framebuffer`) and then
 * hangs on `browserContext.close`. Software Webrender keeps the desktop
 * engine usable. This is not a real desktop Firefox profile and not a
 * physical device.
 */
export const FIREFOX_ENGINE_LAUNCH_PREFS = {
  'layers.acceleration.disabled': true,
  'gfx.webrender.software': true,
  'gfx.webrender.all': false,
} as const;

/**
 * Desktop Playwright engine project. `devices['Desktop Safari']` is WebKit
 * desktop emulation — not real iOS Safari, not a physical device.
 */
export function engineProject(browser: PlaywrightBrowser): NonNullable<PlaywrightTestConfig['projects']>[number] {
  const device =
    browser === 'firefox' ? devices['Desktop Firefox'] : browser === 'webkit' ? devices['Desktop Safari'] : devices['Desktop Chrome'];
  return {
    name: browser,
    use: {
      ...device,
      browserName: browser,
      ...(browser === 'firefox'
        ? { launchOptions: { firefoxUserPrefs: { ...FIREFOX_ENGINE_LAUNCH_PREFS } } }
        : {}),
    },
  };
}
