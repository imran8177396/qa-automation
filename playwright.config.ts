import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import {
  ALL_PLAYWRIGHT_ENGINES,
  PLAYWRIGHT_FAILURE_ARTIFACTS,
  playwrightHtmlReporterConfig,
  playwrightJsonReporterConfig,
  playwrightSuiteOutputDir,
  resolvePlaywrightSuiteNameFromEnv,
} from './scripts/lib/playwright-suites';
import type { PlaywrightConfig } from './scripts/lib/playwright-browsers';
import { engineProject } from './scripts/cross-browser/projects';
import { getEnv } from './utils/env';

const rootDir = __dirname;
const generatedEnvPath = path.join(rootDir, 'config', 'generated.env');

if (fs.existsSync(generatedEnvPath)) {
  dotenv.config({ path: generatedEnvPath });
}

let qaConfig: {
  playwright?: Partial<PlaywrightConfig> & {
    baseURL?: string;
    headless?: boolean;
    workers?: number;
  };
} = {};

const qaConfigPath = path.join(rootDir, 'qa.config.json');
if (fs.existsSync(qaConfigPath)) {
  qaConfig = JSON.parse(fs.readFileSync(qaConfigPath, 'utf8'));
}

const playwrightConfig: PlaywrightConfig = {
  enabled: true,
  baseURL: qaConfig.playwright?.baseURL ?? 'http://localhost',
  browser: qaConfig.playwright?.browser,
  browsers: qaConfig.playwright?.browsers,
  headless: qaConfig.playwright?.headless ?? true,
};

const headlessOverride = getEnv('QA_PLAYWRIGHT_HEADLESS');
const headless = headlessOverride !== '' ? headlessOverride === 'true' : playwrightConfig.headless;

const suiteName = resolvePlaywrightSuiteNameFromEnv('e2e');

/**
 * Chromium, Firefox, and WebKit engine projects are always registered.
 * Suites choose which to launch via `--project`. A skipped engine must be
 * recorded as NOT_EXECUTED with a reason — never omitted from the suite summary.
 *
 * Caveats: WebKit is not iOS Safari. Chromium is not Android Chrome.
 */
const projects = ALL_PLAYWRIGHT_ENGINES.map((browser) => engineProject(browser));

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: ['**/visual/**', '**/responsive/**', '**/accessibility/**', '**/workflows/**'],
  outputDir: path.relative(rootDir, playwrightSuiteOutputDir(suiteName)).replace(/\\/g, '/'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : qaConfig.playwright?.workers,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [
    ['list'],
    ['html', playwrightHtmlReporterConfig(suiteName)],
    ['json', playwrightJsonReporterConfig(suiteName)],
  ],
  use: {
    baseURL: getEnv('QA_PLAYWRIGHT_BASE_URL', playwrightConfig.baseURL),
    headless,
    ...PLAYWRIGHT_FAILURE_ARTIFACTS,
    actionTimeout: 15000,
    navigationTimeout: 35000,
  },
  projects,
});
