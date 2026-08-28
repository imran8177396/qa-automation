import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import {
  resolvePlaywrightBrowsers,
  type PlaywrightBrowser,
  type PlaywrightConfig,
} from './scripts/lib/playwright-browsers';

const rootDir = __dirname;
const generatedEnvPath = path.join(rootDir, 'config', 'generated.env');

if (fs.existsSync(generatedEnvPath)) {
  dotenv.config({ path: generatedEnvPath });
}

let qaConfig: {
  playwright?: Partial<PlaywrightConfig> & {
    baseURL?: string;
    headless?: boolean;
  };
} = {};

const qaConfigPath = path.join(rootDir, 'qa.config.json');
if (fs.existsSync(qaConfigPath)) {
  qaConfig = JSON.parse(fs.readFileSync(qaConfigPath, 'utf8'));
}

const playwrightConfig: PlaywrightConfig = {
  enabled: true,
  baseURL: qaConfig.playwright?.baseURL ?? 'http://localhost',
  browser: qaConfig.playwright?.browser as PlaywrightBrowser | undefined,
  browsers: qaConfig.playwright?.browsers as PlaywrightBrowser[] | undefined,
  headless: qaConfig.playwright?.headless ?? true,
};

const headless =
  process.env.QA_PLAYWRIGHT_HEADLESS !== undefined
    ? process.env.QA_PLAYWRIGHT_HEADLESS === 'true'
    : playwrightConfig.headless;

const browserProjects = {
  chromium: {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  },
  firefox: {
    name: 'firefox',
    use: { ...devices['Desktop Firefox'] },
  },
  webkit: {
    name: 'webkit',
    use: { ...devices['Desktop Safari'] },
  },
} as const;

const projects = resolvePlaywrightBrowsers(playwrightConfig).map(
  (browser) => browserProjects[browser] ?? browserProjects.chromium
);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'reports/playwright' }],
    ['json', { outputFile: 'reports/playwright/results.json' }],
  ],
  use: {
    baseURL: process.env.QA_PLAYWRIGHT_BASE_URL ?? playwrightConfig.baseURL,
    headless,
    trace: 'on-first-retry',
  },
  projects,
});
