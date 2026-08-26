import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const rootDir = __dirname;
const generatedEnvPath = path.join(rootDir, 'config', 'generated.env');

if (fs.existsSync(generatedEnvPath)) {
  dotenv.config({ path: generatedEnvPath });
}

let qaConfig: {
  playwright?: { baseURL?: string; browser?: string; headless?: boolean };
} = {};

const qaConfigPath = path.join(rootDir, 'qa.config.json');
if (fs.existsSync(qaConfigPath)) {
  qaConfig = JSON.parse(fs.readFileSync(qaConfigPath, 'utf8'));
}

const browser = qaConfig.playwright?.browser ?? 'chromium';
const headless =
  process.env.QA_PLAYWRIGHT_HEADLESS !== undefined
    ? process.env.QA_PLAYWRIGHT_HEADLESS === 'true'
    : qaConfig.playwright?.headless ?? true;

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

const selectedBrowser =
  browserProjects[browser as keyof typeof browserProjects] ?? browserProjects.chromium;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'reports/playwright' }]],
  use: {
    baseURL: process.env.QA_PLAYWRIGHT_BASE_URL ?? qaConfig.playwright?.baseURL,
    headless,
    trace: 'on-first-retry',
  },
  projects: [selectedBrowser],
});
