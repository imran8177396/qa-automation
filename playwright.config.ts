import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import {
  PLAYWRIGHT_FAILURE_ARTIFACTS,
  playwrightAllureReporterConfig,
  playwrightHtmlReporterConfig,
  playwrightJsonReporterConfig,
  playwrightSuiteOutputDir,
  resolvePlaywrightSuiteNameFromEnv,
} from './scripts/lib/playwright-suites';
import type { PlaywrightConfig } from './scripts/lib/playwright-browsers';
import { engineProjects } from './scripts/cross-browser/projects';
import { getEnv } from './utils/env';
import {
  captureShellPlaywrightUrls,
  configFallbackPlaywrightBaseUrl,
  resolveConfiguredPlaywrightBaseUrl,
} from './scripts/lib/suite-origin';

const rootDir = __dirname;
const generatedEnvPath = path.join(rootDir, 'config', 'generated.env');
const localEnvPath = path.join(rootDir, '.env');

/** Orchestrator / CI / shell — captured before dotenv so generated.env cannot clobber it. */
const capturedShellUrls = captureShellPlaywrightUrls();

if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath });
}

const userBaseUrl = capturedShellUrls.capturedEnvUrl || process.env.QA_PLAYWRIGHT_BASE_URL?.trim() || '';
const userWebsiteUrl = capturedShellUrls.capturedWebsiteUrl || process.env.QA_WEBSITE_URL?.trim() || '';

if (fs.existsSync(generatedEnvPath)) {
  dotenv.config({ path: generatedEnvPath });
}

let qaConfig: {
  urls?: { website?: string; api?: string };
  playwright?: Partial<PlaywrightConfig> & {
    baseURL?: string;
    headless?: boolean;
    workers?: number;
    retries?: number;
    testIdAttribute?: string;
  };
} = {};

const qaConfigPath = path.join(rootDir, 'qa.config.json');
if (fs.existsSync(qaConfigPath)) {
  qaConfig = JSON.parse(fs.readFileSync(qaConfigPath, 'utf8'));
}

const playwrightConfig: Pick<PlaywrightConfig, 'enabled' | 'browser' | 'browsers' | 'headless'> = {
  enabled: true,
  browser: qaConfig.playwright?.browser,
  browsers: qaConfig.playwright?.browsers,
  headless: qaConfig.playwright?.headless ?? true,
};

/**
 * Origin: shell / orchestrator `QA_PLAYWRIGHT_BASE_URL`, then `QA_WEBSITE_URL`,
 * then persisted last-target, then `urls.website` (optional `playwright.baseURL`
 * only when explicitly set). A stale `config/generated.env` from a previous
 * qa:sync must not retarget the suite at leftover hosts.
 */
const resolvedBaseUrl = resolveConfiguredPlaywrightBaseUrl({
  capturedEnvUrl: userBaseUrl,
  capturedWebsiteUrl: userWebsiteUrl,
  configBaseUrl: configFallbackPlaywrightBaseUrl({
    playwright: qaConfig.playwright,
    urls: qaConfig.urls,
  }),
});
process.env.QA_PLAYWRIGHT_BASE_URL = resolvedBaseUrl;

const headlessOverride = getEnv('QA_PLAYWRIGHT_HEADLESS');
const headless = headlessOverride !== '' ? headlessOverride === 'true' : playwrightConfig.headless;

const suiteName = resolvePlaywrightSuiteNameFromEnv('e2e');

const DEFAULT_CI_RETRIES = 2;
const DEFAULT_LOCAL_RETRIES = 0;

/**
 * `qa.config.json` playwright.retries overrides the defaults. A retried test that
 * fails every attempt stays FAIL; one that only passes on retry is reported flaky.
 * Retries are never a way to turn a real failure green.
 */
const retries =
  typeof qaConfig.playwright?.retries === 'number'
    ? qaConfig.playwright.retries
    : process.env.CI
      ? DEFAULT_CI_RETRIES
      : DEFAULT_LOCAL_RETRIES;

/** Playwright's own default. Override per project via `qa.config.json` playwright.testIdAttribute. */
const DEFAULT_TEST_ID_ATTRIBUTE = 'data-testid';
const testIdAttribute = qaConfig.playwright?.testIdAttribute ?? DEFAULT_TEST_ID_ATTRIBUTE;

/**
 * Chromium, Firefox, and WebKit engine projects are always registered.
 * Suites choose which to launch via `--project`. A skipped engine must be
 * recorded as NOT_EXECUTED with a reason — never omitted from the suite summary.
 *
 * Caveats: WebKit is not iOS Safari. Chromium is not Android Chrome.
 */
const projects = engineProjects();

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: ['**/visual/**', '**/responsive/**', '**/accessibility/**', '**/workflows/**', '**/performance/**'],
  outputDir: path.relative(rootDir, playwrightSuiteOutputDir(suiteName)).replace(/\\/g, '/'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries,
  workers: process.env.CI ? 1 : qaConfig.playwright?.workers,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [
    ['list'],
    ['html', playwrightHtmlReporterConfig(suiteName)],
    ['json', playwrightJsonReporterConfig(suiteName)],
    ['allure-playwright', playwrightAllureReporterConfig(suiteName)],
  ],
  use: {
    baseURL: resolvedBaseUrl,
    headless,
    testIdAttribute,
    ...PLAYWRIGHT_FAILURE_ARTIFACTS,
    actionTimeout: 15000,
    navigationTimeout: 35000,
  },
  projects,
});
