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
import { responsiveEngineProjects } from './scripts/responsive/viewports';
import {
  PLAYWRIGHT_FAILURE_ARTIFACTS,
  playwrightAllureReporterConfig,
  playwrightHtmlReporterConfig,
  playwrightJsonReporterConfig,
  resolvePlaywrightSuiteNameFromEnv,
} from './scripts/lib/playwright-suites';

const rootDir = __dirname;
const generatedEnvPath = path.join(rootDir, 'config', 'generated.env');
const capturedUrls = captureShellPlaywrightUrls();

if (fs.existsSync(generatedEnvPath)) {
  dotenv.config({ path: generatedEnvPath });
}

const headlessOverride = getEnv('QA_PLAYWRIGHT_HEADLESS');
const headless = headlessOverride !== '' ? headlessOverride === 'true' : true;
const suiteName = resolvePlaywrightSuiteNameFromEnv('responsive');

/**
 * Responsive suite is isolated from functional e2e and from visual baselines.
 * Projects are form-factor emulated viewports × Chromium / Firefox / WebKit
 * via Playwright `use.viewport` + `page.setViewportSize`. This is not a real
 * device, not iOS Safari, and not Android Chrome. Named Playwright device
 * profiles (iPhone / Pixel) are intentionally not used.
 */
export default defineConfig({
  testDir: './tests/e2e/responsive',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/responsive',
  fullyParallel: true,
  // Live sites (4–6s navigations) + 12 engine×viewport projects: more than 1–2
  // workers previously stacked Firefox setViewportSize/navigation hangs into
  // uniform 60s test timeouts. Cap workers; CI stays serial.
  workers: process.env.CI ? 1 : 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Slow live origin headroom (pages often 4–6s); assertions stay unchanged.
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: [
    ['list'],
    ['html', playwrightHtmlReporterConfig(suiteName)],
    ['json', playwrightJsonReporterConfig(suiteName)],
    ['allure-playwright', playwrightAllureReporterConfig(suiteName)],
  ],
  use: {
    baseURL: resolveConfiguredPlaywrightBaseUrl({
      capturedEnvUrl: capturedUrls.capturedEnvUrl,
      capturedWebsiteUrl: capturedUrls.capturedWebsiteUrl,
      configBaseUrl: configFallbackPlaywrightBaseUrl(loadConfig()),
    }),
    headless,
    ...PLAYWRIGHT_FAILURE_ARTIFACTS,
    // Override retain-on-failure video/trace — prior hangs were teardown-related.
    trace: 'off',
    video: 'off',
    actionTimeout: 20000,
    navigationTimeout: 45000,
    colorScheme: 'light',
  },
  projects: responsiveEngineProjects(),
});
