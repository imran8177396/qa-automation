import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getEnv } from './utils/env';
import { loadConfig } from './scripts/lib/load-config';
import { VIEWPORT_NAMES, VIEWPORTS, playwrightUseFor } from './scripts/responsive/viewports';
import {
  PLAYWRIGHT_FAILURE_ARTIFACTS,
  playwrightAllureReporterConfig,
  playwrightHtmlReporterConfig,
  playwrightJsonReporterConfig,
  resolvePlaywrightSuiteNameFromEnv,
} from './scripts/lib/playwright-suites';

const rootDir = __dirname;
const generatedEnvPath = path.join(rootDir, 'config', 'generated.env');

if (fs.existsSync(generatedEnvPath)) {
  dotenv.config({ path: generatedEnvPath });
}

const headlessOverride = getEnv('QA_PLAYWRIGHT_HEADLESS');
const headless = headlessOverride !== '' ? headlessOverride === 'true' : true;
const suiteName = resolvePlaywrightSuiteNameFromEnv('responsive');

/**
 * Responsive suite is isolated from functional e2e and from visual baselines.
 * Projects are form-factor emulated viewports on Chromium via Playwright
 * `use.viewport` + `page.setViewportSize`. This is not a real device,
 * not iOS Safari, and not Android Chrome. Named Playwright device profiles
 * (iPhone / Pixel) are intentionally not used.
 */
export default defineConfig({
  testDir: './tests/e2e/responsive',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/responsive',
  fullyParallel: true,
  workers: process.env.CI ? 1 : 4,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: [
    ['list'],
    ['html', playwrightHtmlReporterConfig(suiteName)],
    ['json', playwrightJsonReporterConfig(suiteName)],
    ['allure-playwright', playwrightAllureReporterConfig(suiteName)],
  ],
  use: {
    baseURL: getEnv('QA_PLAYWRIGHT_BASE_URL', loadConfig().playwright.baseURL),
    headless,
    ...PLAYWRIGHT_FAILURE_ARTIFACTS,
    actionTimeout: 15000,
    navigationTimeout: 35000,
    colorScheme: 'light',
  },
  projects: VIEWPORT_NAMES.map((name) => ({
    name: VIEWPORTS[name].projectName,
    use: playwrightUseFor(VIEWPORTS[name]),
  })),
});
