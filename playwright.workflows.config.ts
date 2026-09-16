import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getEnv } from './utils/env';
import { loadConfig } from './scripts/lib/load-config';
import {
  PLAYWRIGHT_FAILURE_ARTIFACTS,
  playwrightAllureReporterConfig,
  playwrightJsonReporterConfig,
  resolvePlaywrightSuiteNameFromEnv,
} from './scripts/lib/playwright-suites';

const rootDir = __dirname;
const generatedEnvPath = path.join(rootDir, 'config', 'generated.env');
if (fs.existsSync(generatedEnvPath)) dotenv.config({ path: generatedEnvPath });

const suiteName = resolvePlaywrightSuiteNameFromEnv('workflows');

export default defineConfig({
  testDir: './tests/e2e/workflows',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/workflows',
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['json', playwrightJsonReporterConfig(suiteName)],
    ['allure-playwright', playwrightAllureReporterConfig(suiteName)],
  ],
  use: {
    baseURL: getEnv('QA_PLAYWRIGHT_BASE_URL', loadConfig().playwright.baseURL),
    headless: getEnv('QA_PLAYWRIGHT_HEADLESS', 'true') === 'true',
    ...PLAYWRIGHT_FAILURE_ARTIFACTS,
  },
  projects: [{ name: 'workflows-chromium', use: { ...devices['Desktop Chrome'] } }],
});
