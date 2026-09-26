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
    playwright: { enabled: true, baseURL: 'http://127.0.0.1:4173', browsers: ['chromium', 'firefox', 'webkit'], headless: true },
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

/** Strip YAML comments but keep workflow body for trigger checks. */
function onBlock(yaml: string): string {
  const match = yaml.match(/\non:\n([\s\S]*?)\n(?:concurrency|permissions|jobs):/);
  assert.ok(match, 'expected an on: trigger block');
  return match[1];
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

test('CI PR tier includes unit, smoke, API, critical E2E, accessibility, security-light', () => {
  const yaml = renderGithubCiWorkflow(config());
  assert.match(yaml, new RegExp(`node-version: "${CI_NODE_VERSION}"`));
  assert.match(yaml, /npx playwright install --with-deps chromium firefox webkit/);
  assert.match(yaml, /npm run typecheck/);
  assert.match(yaml, /npm run test:unit/);
  assert.match(yaml, /npm run test:smoke/);
  assert.match(yaml, /name: critical E2E/);
  assert.match(yaml, /npm run test:e2e/);
  assert.match(yaml, /npm run test:api/);
  assert.match(yaml, /npm run test:accessibility/);
  assert.match(yaml, /name: security-light/);
  assert.match(yaml, /npm run test:security/);
});

test('CI PR tier excludes main/scheduled/authorized engines', () => {
  const yaml = renderGithubCiWorkflow(config());
  const steps = runnableLines(yaml);
  assert.doesNotMatch(steps, /test:visual/);
  assert.doesNotMatch(steps, /test:integration/);
  assert.doesNotMatch(steps, /test:contract/);
  assert.doesNotMatch(steps, /test:resilience/);
  assert.doesNotMatch(steps, /test:ai/);
  assert.doesNotMatch(steps, /test:production-verification/);
  assert.doesNotMatch(steps, /test:e2e:cross-browser/);
  assert.doesNotMatch(steps, /test:responsive/);
  assert.doesNotMatch(steps, /test:seo/);
  assert.doesNotMatch(steps, /test:content/);
  assert.doesNotMatch(steps, /test:regression/);
  assert.doesNotMatch(steps, /test:dependencies/);
  assert.doesNotMatch(steps, /authorize-heavy/);
  assert.doesNotMatch(steps, /QA_RESILIENCE_AUTHORIZE/);
});

test('CI generates combined reports including Allure and uploads required artifacts', () => {
  const yaml = renderGithubCiWorkflow(config());
  assert.match(yaml, /npm run report:all/);
  assertStandardArtifacts(yaml);
});

test('regression workflow is push/schedule/dispatch — not pull_request — and lists main tier commands', () => {
  const yaml = renderGithubRegressionWorkflow(config());
  assert.match(yaml, /name: QA Regression/);
  assert.match(yaml, /\n  push:\n/);
  assert.match(yaml, /\n  schedule:\n/);
  assert.match(yaml, /\n  workflow_dispatch:\n/);
  assert.doesNotMatch(yaml, /\n  pull_request:\n/);
  assert.doesNotMatch(onBlock(yaml), /pull_request/);
  assert.match(yaml, /npm run test:e2e/);
  assert.match(yaml, /npm run test:visual/);
  assert.match(yaml, /npm run test:regression/);
  assert.match(yaml, /npm run test:seo/);
  assert.match(yaml, /npm run test:content/);
  assert.match(yaml, /npm run test:integration/);
  assert.match(yaml, /npm run test:contract/);
  assert.match(yaml, /npm run test:responsive/);
  assert.match(yaml, /npm run test:security/);
  assert.match(yaml, /npm run test:accessibility/);
  assert.match(yaml, /npm run test:api/);
  assert.doesNotMatch(runnableLines(yaml), /npm run qa:all/);
  assert.doesNotMatch(runnableLines(yaml), /QA_PERF_AUTHORIZE\s*[:=]/);
  assert.match(yaml, /npx playwright install --with-deps chromium firefox webkit/);
  assertStandardArtifacts(yaml);
  assertNoSecretEcho(yaml);
  assertNoHardcodedPasswords(yaml);
});

test('regression schedule steps include dependency, cross-browser, AI, and deep security', () => {
  const yaml = renderGithubRegressionWorkflow(config());
  assert.match(yaml, /npm run test:dependencies/);
  assert.match(yaml, /npm run test:e2e:cross-browser/);
  assert.match(yaml, /npm run test:ai/);
  assert.match(yaml, /name: deep security/);
  assert.match(yaml, /github\.event_name == 'schedule'/);
});

test('regression authorized jobs gate resilience and production; allow_production defaults false', () => {
  const yaml = renderGithubRegressionWorkflow(config());
  assert.match(yaml, /authorize_destructive:/);
  assert.match(yaml, /allow_production:/);
  assert.match(yaml, /default: false/);
  assert.match(yaml, /inputs\.authorize_destructive == true/);
  assert.match(yaml, /inputs\.allow_production == true/);
  assert.match(yaml, /npm run test:resilience -- --authorize-destructive/);
  assert.match(yaml, /npm run test:production-verification/);
  assert.match(yaml, /QA_RESILIENCE_AUTHORIZE: "true"/);
  assert.doesNotMatch(yaml, /allow_production:[\s\S]*?default: true/);
  assert.doesNotMatch(yaml, /authorize_destructive:[\s\S]*?default: true/);
});

test('heavy workflow is dispatch + optional schedule with authorize-heavy gate and never pull_request', () => {
  const yaml = renderHeavyPerformanceWorkflow();
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /\n  schedule:\n/);
  assert.doesNotMatch(yaml, /\n  push:\n/);
  assert.doesNotMatch(yaml, /\n  pull_request:\n/);
  assert.doesNotMatch(onBlock(yaml), /pull_request/);
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

test('checked-in PR workflow excludes heavy/main-only engines as text', () => {
  const pr = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
  assert.doesNotMatch(pr, /test:visual/);
  assert.doesNotMatch(pr, /test:integration/);
  assert.doesNotMatch(pr, /test:contract/);
  assert.doesNotMatch(pr, /test:resilience/);
  assert.doesNotMatch(pr, /test:ai/);
  assert.doesNotMatch(pr, /test:production-verification/);
  assert.doesNotMatch(pr, /test:e2e:cross-browser/);
  assert.doesNotMatch(pr, /authorize-heavy/);
});

test('checked-in regression workflow contains main tier commands', () => {
  const reg = fs.readFileSync(REGRESSION_WORKFLOW_PATH, 'utf8');
  assert.match(reg, /test:e2e/);
  assert.match(reg, /test:visual/);
  assert.match(reg, /test:regression/);
  assert.match(reg, /test:seo/);
  assert.match(reg, /test:content/);
});

test('heavy and production jobs are not triggered by pull_request', () => {
  const heavy = fs.readFileSync(HEAVY_WORKFLOW_PATH, 'utf8');
  const reg = fs.readFileSync(REGRESSION_WORKFLOW_PATH, 'utf8');
  assert.doesNotMatch(onBlock(heavy), /pull_request/);
  assert.doesNotMatch(onBlock(reg), /pull_request/);
  assert.match(reg, /production-verification:/);
  assert.match(reg, /allow_production:/);
  assert.match(reg, /default: false/);
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
