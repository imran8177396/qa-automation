import { PATHS } from '../lib/paths';
import { logStep, logSuccess, logWarn } from '../lib/logger';
import { runLocalBin } from '../lib/run-command';
import type { QaConfig } from '../types';

export async function runPlaywright(config: QaConfig): Promise<boolean> {
  if (!config.playwright.enabled) {
    logWarn('Playwright step skipped (disabled in qa.config.json).');
    return true;
  }

  logStep('E2E tests (Playwright)');

  runLocalBin('playwright', ['install', config.playwright.browser]);

  const args = ['test'];

  if (config.playwright.browser) {
    args.push(`--project=${config.playwright.browser}`);
  }

  const result = runLocalBin('playwright', args, {
    env: {
      ...process.env,
      QA_PLAYWRIGHT_HEADLESS: String(config.playwright.headless),
    },
  });

  if (result.status === 0) {
    logSuccess('Playwright E2E tests passed');
    return true;
  }

  return false;
}
