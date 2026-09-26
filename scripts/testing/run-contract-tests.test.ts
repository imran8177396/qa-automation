import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runContractTests } from './run-contract-tests';
import type { QaConfig } from '../types';

function emptyQa(): QaConfig {
  return {
    project: { name: 'test' },
    urls: { website: '', api: '' },
    pipeline: { steps: ['api'], failFast: false },
    postman: { enabled: false, collectionName: 't', requests: [] },
    playwright: { enabled: false, headless: true },
    jmeter: { enabled: false, threads: 1, rampUpSeconds: 1, loopCount: 1, path: '/' },
    github: { branches: ['main'], runOnPullRequest: false },
  };
}

test('contract disabled → NOT_TESTED', async () => {
  let fetchCalls = 0;
  const results = await runContractTests({
    config: { enabled: false, usePostmanRequests: false, contracts: [] },
    qaConfig: emptyQa(),
    apiUrl: '',
    writeSummary: false,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('should not fetch');
    },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'NOT_TESTED');
  assert.match(results[0].error?.message ?? '', /contract engine disabled/i);
  assert.equal(fetchCalls, 0);
});

test('contract enabled, usePostmanRequests false, no contracts, empty API → REQUIRES_CONFIGURATION', async () => {
  let fetchCalls = 0;
  const results = await runContractTests({
    config: {
      enabled: true,
      usePostmanRequests: false,
      contracts: [],
      executeNegative: false,
    },
    qaConfig: emptyQa(),
    apiUrl: '',
    env: {},
    writeSummary: false,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('should not fetch');
    },
  });
  assert.ok(results.length >= 1);
  assert.ok(results.every((r) => r.status === 'REQUIRES_CONFIGURATION'));
  assert.ok(
    results.some((r) => /API URL empty|no contracts configured/i.test(r.error?.message ?? ''))
  );
  assert.equal(fetchCalls, 0);
});
