import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getEnv } from './utils/env';
import { loadConfig } from './scripts/lib/load-config';
import {
  captureShellPlaywrightUrls,
  configFallbackPlaywrightBaseUrl,
  resolveConfiguredPlaywrightBaseUrl,
} from './scripts/lib/suite-origin';
import { engineProjects } from './scripts/cross-browser/projects';
import { PLAYWRIGHT_FAILURE_ARTIFACTS, playwrightAllureReporterConfig } from './scripts/lib/playwright-suites';

const rootDir = __dirname;
const generatedEnvPath = path.join(rootDir, 'config', 'generated.env');
const capturedUrls = captureShellPlaywrightUrls();
if (fs.existsSync(generatedEnvPath)) dotenv.config({ path: generatedEnvPath });

const config = loadConfig();

/**
 * Isolated from functional e2e and from named Playwright suites.
 * Records page-load timings only — not a JMeter profile and not Lighthouse CWV scores.
 * Runs on Chromium + Firefox + WebKit desktop engines.
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
    baseURL: resolveConfiguredPlaywrightBaseUrl({
      capturedEnvUrl: capturedUrls.capturedEnvUrl,
      capturedWebsiteUrl: capturedUrls.capturedWebsiteUrl,
      configBaseUrl: configFallbackPlaywrightBaseUrl(config),
    }),
    headless: getEnv('QA_PLAYWRIGHT_HEADLESS', 'true') === 'true',
    testIdAttribute: config.playwright.testIdAttribute ?? 'data-testid',
    ...PLAYWRIGHT_FAILURE_ARTIFACTS,
    actionTimeout: 15000,
    navigationTimeout: 35000,
  },
  projects: engineProjects(),
});
