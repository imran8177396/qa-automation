import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getEnv } from './utils/env';
import { loadConfig } from './scripts/lib/load-config';
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
const suiteName = resolvePlaywrightSuiteNameFromEnv('visual');

/**
 * Visual suite is isolated from functional e2e:
 * - chromium only (cross-browser pixels are not a stable signal)
 * - committed baselines under visual-baselines/
 * - updateSnapshots: 'none' — a mismatch never becomes the new baseline
 */
export default defineConfig({
  testDir: './tests/e2e/visual',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/visual',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60000,
  expect: {
    timeout: 15000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
    },
  },
  updateSnapshots: 'none',
  snapshotPathTemplate: './visual-baselines/{platform}/{projectName}/{arg}{ext}',
  reporter: [
    ['list'],
    ['html', playwrightHtmlReporterConfig(suiteName)],
    ['json', playwrightJsonReporterConfig(suiteName)],
    ['allure-playwright', playwrightAllureReporterConfig(suiteName)],
  ],
  use: {
    baseURL: getEnv('QA_PLAYWRIGHT_BASE_URL', loadConfig().playwright.baseURL),
    headless,
    testIdAttribute: loadConfig().playwright.testIdAttribute ?? 'data-testid',
    ...PLAYWRIGHT_FAILURE_ARTIFACTS,
    actionTimeout: 15000,
    navigationTimeout: 35000,
    colorScheme: 'light',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: 'visual-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        colorScheme: 'light',
      },
    },
  ],
});
