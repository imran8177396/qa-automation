import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../lib/load-config';
import { PATHS } from '../lib/paths';
import type { QaConfig } from '../types';
import {
  ARTIFACT_PATHS,
  HEAVY_JMETER_PROFILES,
  JENKINSFILE_PATH,
  JENKINSFILE_PERFORMANCE_PATH,
  JENKINSFILE_REGRESSION_PATH,
  JENKINS_CREDENTIALS,
  JENKINS_FIXTURE_ORIGIN,
  JENKINS_HELPER_GROOVY_PATH,
  JENKINS_HELPER_LOAD_PATH,
  MULTIBRANCH_ALWAYS_STAGES,
  MULTIBRANCH_LIGHTWEIGHT_STAGES,
  MULTIBRANCH_REGRESSION_STAGE,
  PERFORMANCE_JOB_STAGES,
  REGRESSION_JOB_STAGES,
  jenkinsProtectedBranches,
  renderMultibranchJenkinsfile,
  renderPerformanceJenkinsfile,
  renderRegressionJenkinsfile,
} from './jenkins-pipeline';

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

function runnableLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

function assertNoSecretEcho(text: string): void {
  assert.doesNotMatch(text, /echo\s+\$\{?env\.QA_PASSWORD\}?/);
  assert.doesNotMatch(text, /echo\s+"\$\{?QA_PASSWORD\}?"/);
  assert.doesNotMatch(text, /echo\s+"\$2"/);
  assert.doesNotMatch(text, /echo\s+params\.API_URL_OVERRIDE/);
  assert.doesNotMatch(text, /Write-Output\s+\$Value/);
  assert.doesNotMatch(text, /Write-Host\s+\$Value/);
}

function assertNoHardcodedSecrets(text: string): void {
  assert.doesNotMatch(text, /password\s*[:=]\s*['"][^$'"\n]+['"]/i);
  assert.doesNotMatch(text, /secret_password|Password123|admin123|secret_token/i);
  assert.doesNotMatch(text, /authorization:\s*['"]Bearer\s+[A-Za-z0-9]/i);
}

function assertNoInventedProductUrls(text: string): void {
  assert.doesNotMatch(text, /saucedemo\.com/i);
  assert.doesNotMatch(text, /jsonplaceholder\.typicode\.com/i);
}

function assertBalancedGroovy(text: string, label: string): void {
  let braces = 0;
  let parens = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let lineComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') braces += 1;
    if (ch === '}') braces -= 1;
    if (ch === '(') parens += 1;
    if (ch === ')') parens -= 1;
    assert.ok(braces >= 0, `${label} has an extra closing brace`);
    assert.ok(parens >= 0, `${label} has an extra closing paren`);
  }

  assert.equal(quote, null, `${label} has an unclosed string`);
  assert.equal(braces, 0, `${label} has unbalanced braces (${braces})`);
  assert.equal(parens, 0, `${label} has unbalanced parens (${parens})`);
}

function assertRequiredStages(text: string, stages: readonly string[]): void {
  for (const stage of stages) {
    assert.match(text, new RegExp(`stage\\('${stage.replace(/[()]/g, '\\$&')}'\\)`));
  }
}

function helperAndScripts(): string {
  const scriptsDir = path.join(PATHS.root, 'jenkins', 'scripts');
  const names = fs.readdirSync(scriptsDir);
  return names.map((name) => fs.readFileSync(path.join(scriptsDir, name), 'utf8')).join('\n');
}

test('protected branches come from qa.config.json github.branches plus develop', () => {
  assert.deepEqual(jenkinsProtectedBranches(config()), ['main', 'master', 'develop']);
  assert.deepEqual(jenkinsProtectedBranches(config({ branches: ['release'] })), ['release', 'develop']);
});

test('Multibranch Jenkinsfile is lightweight on CHANGE_ID / feature and qa:all on protected branches', () => {
  const groovy = renderMultibranchJenkinsfile(config());
  assert.match(groovy, /pipeline\s*\{/);
  assert.match(groovy, /CHANGE_ID|QA_PIPELINE_PROFILE/);
  assert.match(groovy, /environment name: 'QA_PIPELINE_PROFILE', value: 'lightweight'/);
  assert.match(groovy, /environment name: 'QA_PIPELINE_PROFILE', value: 'regression'/);
  assert.match(groovy, /npm run qa:all/);
  assert.doesNotMatch(runnableLines(groovy), /--authorize-heavy/);
  assert.doesNotMatch(runnableLines(groovy), /QA_PERF_AUTHORIZE\s*[:=]/);
  assert.match(groovy, new RegExp(JENKINS_FIXTURE_ORIGIN.replace(/\./g, '\\.')));
  assert.match(groovy, new RegExp(`load '${JENKINS_HELPER_LOAD_PATH}'`));
  assertRequiredStages(groovy, MULTIBRANCH_ALWAYS_STAGES);
  assertRequiredStages(groovy, MULTIBRANCH_LIGHTWEIGHT_STAGES);
  assertRequiredStages(groovy, [MULTIBRANCH_REGRESSION_STAGE]);
  assertNoSecretEcho(groovy);
  assertNoHardcodedSecrets(groovy);
  assertNoInventedProductUrls(groovy);
  assertBalancedGroovy(groovy, 'multibranch Jenkinsfile');
});

test('Multibranch Jenkinsfile does not run qa:all on the lightweight path', () => {
  const groovy = renderMultibranchJenkinsfile(config());
  assert.match(groovy, /when \{ environment name: 'QA_PIPELINE_PROFILE', value: 'lightweight' \}/);
  assert.match(groovy, /run test:e2e/);
  assert.match(groovy, /run test:api/);
  assert.match(groovy, /run test:accessibility/);
  assert.match(groovy, /run test:performance -- --profile=liveness/);
  assert.match(groovy, /run discover --/);
});

test('Regression Jenkinsfile always runs qa:all and never authorizes heavy JMeter', () => {
  const groovy = renderRegressionJenkinsfile();
  assertRequiredStages(groovy, REGRESSION_JOB_STAGES);
  assert.match(groovy, /npm run qa:all/);
  assert.doesNotMatch(runnableLines(groovy), /--authorize-heavy/);
  assert.doesNotMatch(runnableLines(groovy), /QA_PERF_AUTHORIZE\s*[:=]/);
  assert.doesNotMatch(groovy, /CHANGE_ID/);
  assertNoSecretEcho(groovy);
  assertNoHardcodedSecrets(groovy);
  assertNoInventedProductUrls(groovy);
  assertBalancedGroovy(groovy, 'regression Jenkinsfile');
});

test('Performance Jenkinsfile requires AUTHORIZE_HEAVY=true and defaults to false', () => {
  const groovy = renderPerformanceJenkinsfile();
  assertRequiredStages(groovy, PERFORMANCE_JOB_STAGES);
  assert.match(groovy, /booleanParam\(/);
  assert.match(groovy, /name: 'AUTHORIZE_HEAVY'/);
  assert.match(groovy, /defaultValue: false/);
  assert.match(runnableLines(groovy), /--authorize-heavy/);
  for (const profile of HEAVY_JMETER_PROFILES) {
    assert.match(groovy, new RegExp(`'${profile}'`));
  }
  assert.match(groovy, /assertHeavyAuthorized/);
  assert.doesNotMatch(groovy, /defaultValue: true/);
  assertNoSecretEcho(groovy);
  assertNoHardcodedSecrets(groovy);
  assertNoInventedProductUrls(groovy);
  assertBalancedGroovy(groovy, 'performance Jenkinsfile');
});

test('Jenkinsfiles bind documented credential IDs and archive required artifacts', () => {
  const jenkinsfiles = [
    renderMultibranchJenkinsfile(config()),
    renderRegressionJenkinsfile(),
    renderPerformanceJenkinsfile(),
  ];
  for (const text of jenkinsfiles) {
    assert.match(text, /bindQaRuntimeCredentials/);
    assert.match(text, /recordAllCredentialAvailability/);
    assert.doesNotMatch(text, /path:.*\.env/);
  }
  const helper = fs.readFileSync(JENKINS_HELPER_GROOVY_PATH, 'utf8');
  assert.match(helper, /isUnix\(\)/);
  assert.match(helper, /CHANGE_ID/);
  assert.match(helper, /BRANCH_NAME/);
  for (const cred of JENKINS_CREDENTIALS) {
    assert.match(helper, new RegExp(`'${cred.id}'`));
    assert.match(helper, new RegExp(`'${cred.env}'`));
  }
  assert.match(helper, /archiveArtifacts\(/);
  assert.match(helper, /excludes:.*\.env/);
  for (const artifact of ARTIFACT_PATHS) {
    assert.match(helper, /reports\/\*\*/);
    assert.ok(artifact.length > 0);
  }
  assert.match(helper, /test-results\/\*\*/);
  assert.doesNotMatch(runnableLines(helper), /--authorize-heavy/);
  assertNoSecretEcho(helper);
  assertNoHardcodedSecrets(helper);
  assertBalancedGroovy(helper, 'qa-pipeline.groovy');
});

test('checked-in Jenkinsfiles match the generator (qa:sync will not drift)', () => {
  const live = loadConfig();
  assert.equal(fs.readFileSync(JENKINSFILE_PATH, 'utf8'), renderMultibranchJenkinsfile(live));
  assert.equal(fs.readFileSync(JENKINSFILE_REGRESSION_PATH, 'utf8'), renderRegressionJenkinsfile());
  assert.equal(fs.readFileSync(JENKINSFILE_PERFORMANCE_PATH, 'utf8'), renderPerformanceJenkinsfile());
});

test('PATHS and helper scripts stay portable and do not echo secrets', () => {
  assert.equal(PATHS.jenkinsfile, JENKINSFILE_PATH);
  assert.equal(PATHS.jenkinsfileRegression, JENKINSFILE_REGRESSION_PATH);
  assert.equal(PATHS.jenkinsfilePerformance, JENKINSFILE_PERFORMANCE_PATH);
  const scripts = helperAndScripts();
  assertNoSecretEcho(scripts);
  assertNoHardcodedSecrets(scripts);
  assertNoInventedProductUrls(scripts);
  assert.match(scripts, /start-fixture/);
  assert.match(scripts, /record-credential-status|value not printed/);
});

test('gitignore does not ignore jenkins sources', () => {
  const ignore = fs.readFileSync(path.join(PATHS.root, '.gitignore'), 'utf8');
  assert.doesNotMatch(ignore, /^jenkins\/$/m);
  assert.doesNotMatch(ignore, /^Jenkinsfile/m);
});
