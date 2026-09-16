import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { loadConfig } from '../lib/load-config';
import type { QaConfig } from '../types';
import {
  CI_NODE_VERSION,
  CI_RUNTIME_SECRET_KEYS,
  CI_SECRET_KEYS,
  CI_WORKFLOW_PATH,
  HEAVY_WORKFLOW_PATH,
  REGRESSION_WORKFLOW_PATH,
  renderGithubCiWorkflow,
  renderGithubRegressionWorkflow,
  renderHeavyPerformanceWorkflow,
} from './github-workflow';

function config(overrides: Partial<QaConfig['github']> = {}): QaConfig {
  return {
    project: { name: 'QA Automation' },
    urls: { website: 'https://example.com', api: 'https://jsonplaceholder.typicode.com' },
    pipeline: { steps: ['sync', 'e2e', 'api', 'load'], failFast: false },
    postman: { enabled: true, collectionName: 'QA Automation API', requests: [] },
    playwright: { enabled: true, baseURL: 'http://127.0.0.1:4173', browsers: ['chromium'], headless: true },
    jmeter: {
      enabled: true,
      path: '/users',
      threads: 5,
      rampUpSeconds: 5,
      loopCount: 1,
      defaultProfile: 'liveness',
      allowHeavyAgainst: [],
      profiles: {
        liveness: { threads: 5, rampUpSeconds: 5, loopCount: 1 },
        load: { threads: 20, rampUpSeconds: 20, loopCount: 5 },
        stress: { threads: 50, rampUpSeconds: 10, loopCount: 10 },
        spike: { threads: 40, rampUpSeconds: 1, loopCount: 3 },
        soak: { threads: 10, rampUpSeconds: 30, loopCount: -1, durationSeconds: 300 },
      },
    },
    github: { branches: ['main', 'master'], runOnPullRequest: true, ...overrides },
  };
}

function runnableLines(yaml: string): string {
  return yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function assertNoSecretEcho(yaml: string): void {
  assert.doesNotMatch(yaml, /echo\s+\$\{\{\s*secrets\./);
  assert.doesNotMatch(yaml, /echo\s+"\$\{?QA_PASSWORD\}?"/);
  assert.doesNotMatch(yaml, /echo\s+"\$2"/);
  assert.doesNotMatch(yaml, /\.env(?![\w-])/);
}

function assertNoHardcodedPasswords(yaml: string): void {
  assert.doesNotMatch(yaml, /password\s*[:=]\s*['"][^$'"\n]+['"]/i);
  assert.doesNotMatch(yaml, /secret_password|Password123|admin123|sauce/i);
}

function assertStandardArtifacts(yaml: string): void {
  assert.match(yaml, /name: allure-report/);
  assert.match(yaml, /reports\/allure\/report\//);
  assert.match(yaml, /reports\/playwright\//);
  assert.match(yaml, /name: playwright-screenshots/);
  assert.match(yaml, /name: playwright-videos/);
  assert.match(yaml, /name: playwright-traces/);
  assert.match(yaml, /reports\/postman\//);
  assert.match(yaml, /reports\/jmeter\//);
  assert.match(yaml, /reports\/summary\//);
  assert.match(yaml, /if: always\(\)/);
  assert.match(yaml, /if-no-files-found: ignore/);
}

test('CI workflow is pull_request + workflow_dispatch and not push', () => {
  const yaml = renderGithubCiWorkflow(config());
  assert.match(yaml, /name: QA CI \(Pull Request\)/);
  assert.match(yaml, /\n  pull_request:\n/);
  assert.match(yaml, /\n  workflow_dispatch:\n/);
  assert.doesNotMatch(yaml, /\n  push:\n/);
  assert.doesNotMatch(yaml, /\n  schedule:\n/);
});

test('CI workflow omits pull_request when config disables it', () => {
  const yaml = renderGithubCiWorkflow(config({ runOnPullRequest: false }));
  assert.doesNotMatch(yaml, /\n  pull_request:\n/);
  assert.match(yaml, /\n  workflow_dispatch:\n/);
});

test('CI workflow uses fixture URL and does not map QA_PLAYWRIGHT_BASE_URL from secrets', () => {
  const yaml = renderGithubCiWorkflow(config());
  assert.match(yaml, /QA_PLAYWRIGHT_BASE_URL: http:\/\/127\.0\.0\.1:4173/);
  assert.match(yaml, /QA_WEBSITE_URL: http:\/\/127\.0\.0\.1:4173\//);
  assert.doesNotMatch(yaml, /secrets\.QA_PLAYWRIGHT_BASE_URL/);
});

test('CI workflow maps GitHub Secrets for API credentials without printing them', () => {
  const yaml = renderGithubCiWorkflow(config());
  for (const key of CI_RUNTIME_SECRET_KEYS) {
    assert.match(yaml, new RegExp(`secrets\\.${key}`));
  }
  for (const key of CI_SECRET_KEYS) {
    assert.match(yaml, new RegExp(`secrets\\.${key}`));
  }
  assertNoSecretEcho(yaml);
  assertNoHardcodedPasswords(yaml);
});

test('CI default performance step is liveness only and does not authorize heavy', () => {
  const yaml = renderGithubCiWorkflow(config());
  const steps = runnableLines(yaml);
  assert.match(steps, /npm run test:performance -- --profile=liveness/);
  assert.doesNotMatch(steps, /--authorize-heavy/);
  assert.doesNotMatch(steps, /QA_PERF_AUTHORIZE\s*[:=]/);
  assert.doesNotMatch(steps, /--profile=load/);
  assert.doesNotMatch(steps, /npm run qa:all/);
});

test('CI pins Node from engines-compatible constant and installs Chromium only', () => {
  const yaml = renderGithubCiWorkflow(config());
  assert.match(yaml, new RegExp(`node-version: "${CI_NODE_VERSION}"`));
  assert.match(yaml, /npx playwright install --with-deps chromium\n/);
  assert.doesNotMatch(yaml, /playwright install --with-deps chromium firefox webkit/);
  assert.match(yaml, /npm run typecheck/);
  assert.match(yaml, /npm run test:e2e/);
  assert.match(yaml, /npm run test:api/);
  assert.match(yaml, /npm run test:accessibility/);
});

test('CI generates combined reports including Allure and uploads required artifacts', () => {
  const yaml = renderGithubCiWorkflow(config());
  assert.match(yaml, /npm run report:all/);
  assertStandardArtifacts(yaml);
});

test('regression workflow runs qa:all on push, schedule, and dispatch — not pull_request', () => {
  const yaml = renderGithubRegressionWorkflow(config());
  assert.match(yaml, /name: QA Regression/);
  assert.match(yaml, /\n  push:\n/);
  assert.match(yaml, /\n  schedule:\n/);
  assert.match(yaml, /\n  workflow_dispatch:\n/);
  assert.doesNotMatch(yaml, /\n  pull_request:\n/);
  assert.match(yaml, /npm run qa:all/);
  assert.doesNotMatch(runnableLines(yaml), /--authorize-heavy/);
  assert.doesNotMatch(runnableLines(yaml), /QA_PERF_AUTHORIZE\s*[:=]/);
  assert.match(yaml, /npx playwright install --with-deps chromium firefox webkit/);
  assertStandardArtifacts(yaml);
  assertNoSecretEcho(yaml);
  assertNoHardcodedPasswords(yaml);
});

test('heavy workflow is dispatch + optional schedule with authorize-heavy gate', () => {
  const yaml = renderHeavyPerformanceWorkflow();
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /\n  schedule:\n/);
  assert.doesNotMatch(yaml, /\n  push:\n/);
  assert.doesNotMatch(yaml, /\n  pull_request:\n/);
  assert.match(yaml, /authorize-heavy/);
  assert.match(yaml, /--authorize-heavy/);
  assert.match(yaml, /inputs\.confirm == 'authorize-heavy'/);
  assert.match(yaml, /vars\.QA_PERF_AUTHORIZE_SCHEDULE/);
  assert.match(yaml, /reports\/jmeter\//);
  assert.match(yaml, /reports\/summary\//);
  assert.match(yaml, /if: always\(\)/);
  assertNoSecretEcho(yaml);
  assertNoHardcodedPasswords(yaml);
});

test('checked-in workflow YAML matches the generator (qa:sync will not drift)', () => {
  const live = loadConfig();
  assert.equal(fs.readFileSync(CI_WORKFLOW_PATH, 'utf8'), renderGithubCiWorkflow(live));
  assert.equal(fs.readFileSync(REGRESSION_WORKFLOW_PATH, 'utf8'), renderGithubRegressionWorkflow(live));
  assert.equal(fs.readFileSync(HEAVY_WORKFLOW_PATH, 'utf8'), renderHeavyPerformanceWorkflow());
});

test('no workflow uploads .env or echoes secret expressions', () => {
  const yamls = [
    renderGithubCiWorkflow(config()),
    renderGithubRegressionWorkflow(config()),
    renderHeavyPerformanceWorkflow(),
  ];
  for (const yaml of yamls) {
    assert.doesNotMatch(yaml, /path:.*\.env/);
    assert.doesNotMatch(yaml, /echo\s+\$\{\{\s*secrets\./);
    assert.match(yaml, /node-version: "20"/);
    assert.match(yaml, /permissions:\n  contents: read/);
  }
});
