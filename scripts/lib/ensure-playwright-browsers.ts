import { logStep, logSuccess, logWarn } from './logger';
import {
  ALL_PLAYWRIGHT_BROWSERS,
  isPlaywrightBrowserInstalled,
  type PlaywrightBrowser,
} from './playwright-browsers';
import { applySafePlaywrightBrowsersPath } from './runtime-env';
import { localBinPath, runCommand } from './run-command';

export interface EnsurePlaywrightBrowsersResult {
  needed: PlaywrightBrowser[];
  missingBefore: PlaywrightBrowser[];
  missingAfter: PlaywrightBrowser[];
  installed: boolean;
  detail: string;
}

/**
 * Ensure Chromium, Firefox, and WebKit binaries are present.
 * Fixes PLAYWRIGHT_BROWSERS_PATH when pointed at a sandbox/invalid dir, then
 * runs `playwright install` for any missing engines.
 */
export function ensurePlaywrightBrowsersInstalled(
  browsers: readonly PlaywrightBrowser[] = ALL_PLAYWRIGHT_BROWSERS
): EnsurePlaywrightBrowsersResult {
  applySafePlaywrightBrowsersPath(process.env);

  const needed = [...browsers];
  const missingBefore = needed.filter((name) => !isPlaywrightBrowserInstalled(name));
  if (missingBefore.length === 0) {
    return {
      needed,
      missingBefore: [],
      missingAfter: [],
      installed: true,
      detail: `already present: ${needed.join(', ')}`,
    };
  }

  logWarn(`Playwright browsers missing: ${missingBefore.join(', ')} — installing`);
  logStep(`npx playwright install ${missingBefore.join(' ')}`);
  const bin = localBinPath('playwright');
  const result = runCommand(bin, ['install', ...missingBefore], { env: process.env });
  const missingAfter = needed.filter((name) => !isPlaywrightBrowserInstalled(name));
  if (missingAfter.length === 0) {
    logSuccess(`Installed Playwright browsers: ${missingBefore.join(', ')}`);
    return {
      needed,
      missingBefore,
      missingAfter: [],
      installed: true,
      detail: `installed ${missingBefore.join(', ')} (exit ${result.status ?? 'null'})`,
    };
  }

  return {
    needed,
    missingBefore,
    missingAfter,
    installed: false,
    detail: `still missing after install: ${missingAfter.join(', ')} — PDF and cross-browser stages need these binaries`,
  };
}
