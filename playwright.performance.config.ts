import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getEnv } from './utils/env';
import { loadConfig } from './scripts/lib/load-config';
import { PLAYWRIGHT_FAILURE_ARTIFACTS, playwrightAllureReporterConfig } from './scripts/lib/playwright-suites';

const rootDir = __dirname;
const generatedEnvPath = path.join(rootDir, 'config', 'generated.env');
if (fs.existsSync(generatedEnvPath)) dotenv.config({ path: generatedEnvPath });

const config = loadConfig();

/**
 * Isolated from functional e2e and from named Playwright suites.
 * Records page-load timings only — not a JMeter profile and not Lighthouse CWV scores.
 */
export default defineConfig({
  testDir: './tests/e2e/performance',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/performance',
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 15000 },
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/performance/playwright-results.json' }],
    ['allure-playwright', playwrightAllureReporterConfig()],
  ],
  use: {
    baseURL: getEnv('QA_PLAYWRIGHT_BASE_URL', config.playwright.baseURL),
    headless: getEnv('QA_PLAYWRIGHT_HEADLESS', 'true') === 'true',
    testIdAttribute: config.playwright.testIdAttribute ?? 'data-testid',
    ...PLAYWRIGHT_FAILURE_ARTIFACTS,
    actionTimeout: 15000,
    navigationTimeout: 35000,
  },
  projects: [{ name: 'perf-ui-chromium', use: { ...devices['Desktop Chrome'] } }],
});
