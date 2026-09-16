import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import { resolvePlaywrightBrowsers } from '../lib/playwright-browsers';
import type { QaConfig } from '../types';
import { readExistingSeedUrl, isLoopbackUrl } from '../orchestrator/resolve-url';
import { buildPostmanCollection, buildPostmanEnvironment } from './postman-collection';
import { writeJmeterProfilePlans } from '../performance/jmx';

export { generateGithubWorkflow } from './github-workflow';
export { generateJenkinsfiles } from './jenkins-pipeline';

function resolveWebsiteUrl(config: QaConfig): string {
  const seed = readExistingSeedUrl();
  if (seed) return seed.endsWith('/') ? seed : `${seed}/`;
  if (config.playwright.baseURL && isLoopbackUrl(config.playwright.baseURL)) {
    const base = config.playwright.baseURL.replace(/\/+$/, '');
    return `${base}/`;
  }
  return config.urls.website;
}

function resolvePlaywrightBaseUrl(config: QaConfig): string {
  const seed = readExistingSeedUrl();
  if (seed) return seed.replace(/\/+$/, '');
  return config.playwright.baseURL.replace(/\/+$/, '');
}

export function generateEnvFile(config: QaConfig): void {
  const websiteUrl = resolveWebsiteUrl(config);
  const lines = [
    `QA_PROJECT_NAME=${config.project.name}`,
    `QA_WEBSITE_URL=${websiteUrl}`,
    `QA_API_URL=${config.urls.api}`,
  ];

  if (config.urls.login) {
    lines.push(`QA_LOGIN_URL=${config.urls.login}`);
  }
  if (config.credentials) {
    lines.push(`QA_USERNAME=${config.credentials.username}`);
    lines.push(`QA_PASSWORD=${config.credentials.password}`);
  }

  lines.push(
    `QA_PLAYWRIGHT_BASE_URL=${resolvePlaywrightBaseUrl(config)}`,
    `QA_PLAYWRIGHT_BROWSERS=${resolvePlaywrightBrowsers(config.playwright).join(',')}`,
    `QA_PLAYWRIGHT_HEADLESS=${config.playwright.headless}`
  );

  fs.mkdirSync(path.dirname(PATHS.generatedEnv), { recursive: true });
  fs.writeFileSync(PATHS.generatedEnv, `${lines.join('\n')}\n`, 'utf8');
}

export function generatePostmanFiles(config: QaConfig): void {
  const collection = buildPostmanCollection(config);
  const environment = buildPostmanEnvironment(config);

  fs.mkdirSync(path.dirname(PATHS.postmanCollection), { recursive: true });
  const collectionJson = `${JSON.stringify(collection, null, 2)}\n`;
  const environmentJson = `${JSON.stringify(environment, null, 2)}\n`;

  fs.writeFileSync(PATHS.postmanCollection, collectionJson, 'utf8');
  fs.writeFileSync(PATHS.postmanEnvironment, environmentJson, 'utf8');

  fs.mkdirSync(path.dirname(PATHS.postmanExport), { recursive: true });
  fs.writeFileSync(PATHS.postmanExport, collectionJson, 'utf8');
  fs.writeFileSync(PATHS.postmanExportEnvironment, environmentJson, 'utf8');
}

export function generateReportsFolders(): void {
  for (const folder of Object.values(PATHS.reports)) {
    fs.mkdirSync(folder, { recursive: true });
    const keepFile = path.join(folder, '.gitkeep');
    if (!fs.existsSync(keepFile)) {
      fs.writeFileSync(keepFile, '', 'utf8');
    }
  }
  for (const folder of [PATHS.allureResults, PATHS.allureReport, PATHS.allureHistory]) {
    fs.mkdirSync(folder, { recursive: true });
  }
}

export function generateJmeterPlan(config: QaConfig): void {
  writeJmeterProfilePlans(config);
}

