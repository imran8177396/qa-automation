import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import { logStep, logSuccess, logWarn } from '../lib/logger';
import { resolvePlaywrightBrowsers } from '../lib/playwright-browsers';
import { runLocalBin } from '../lib/run-command';
import type { QaConfig } from '../types';

export async function runPlaywright(config: QaConfig): Promise<boolean> {
  if (!config.playwright.enabled) {
    logWarn('Playwright step skipped (disabled in qa.config.json).');
    return true;
  }

  const browsers = resolvePlaywrightBrowsers(config.playwright);
  const headed = process.argv.includes('--headed');

  logStep(`E2E tests (Playwright) — ${browsers.join(', ')}`);

  fs.mkdirSync(PATHS.reports.playwright, { recursive: true });

  runLocalBin('playwright', ['install', ...browsers]);

  const args = ['test', '--reporter=html', '--reporter=json'];

  if (headed) {
    args.push('--headed');
  }

  for (const browser of browsers) {
    args.push(`--project=${browser}`);
  }

  const result = runLocalBin('playwright', args, {
    env: {
      ...process.env,
      QA_PLAYWRIGHT_HEADLESS: headed ? 'false' : String(config.playwright.headless),
      PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(PATHS.reports.playwright, 'results.json'),
    },
  });

  if (result.status === 0) {
    logSuccess(`Playwright E2E tests passed on: ${browsers.join(', ')}`);
    return true;
  }

  return false;
}
