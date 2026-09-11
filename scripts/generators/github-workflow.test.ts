import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QaConfig } from '../types';
import {
  CI_SECRET_KEYS,
  renderGithubCiWorkflow,
  renderHeavyPerformanceWorkflow,
} from './github-workflow';

function config(): QaConfig {
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
    github: { branches: ['main', 'master'], runOnPullRequest: true },
  };
}

test('CI workflow supports push, pull_request, and workflow_dispatch', () => {
  const yaml = renderGithubCiWorkflow(config());
  assert.match(yaml, /\n  push:\n/);
  assert.match(yaml, /\n  pull_request:\n/);
  assert.match(yaml, /\n  workflow_dispatch:\n/);
});

test('CI workflow uses fixture URL and does not map QA_PLAYWRIGHT_BASE_URL from secrets', () => {
  const yaml = renderGithubCiWorkflow(config());
  assert.match(yaml, /QA_PLAYWRIGHT_BASE_URL: http:\/\/127\.0\.0\.1:4173/);
  assert.doesNotMatch(yaml, /secrets\.QA_PLAYWRIGHT_BASE_URL/);
});

test('CI workflow maps GitHub Secrets for API credentials', () => {
  const yaml = renderGithubCiWorkflow(config());
  for (const key of CI_SECRET_KEYS) {
    assert.match(yaml, new RegExp(`secrets\\.${key}`));
  }
});

test('heavy workflow is manual-only with authorize-heavy gate', () => {
  const yaml = renderHeavyPerformanceWorkflow();
  assert.match(yaml, /workflow_dispatch:/);
  assert.doesNotMatch(yaml, /\n  push:\n/);
  assert.match(yaml, /authorize-heavy/);
});
