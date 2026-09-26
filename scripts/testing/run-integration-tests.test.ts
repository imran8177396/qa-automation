import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runIntegrationTests } from './run-integration-tests';

test('integration disabled → NOT_TESTED', async () => {
  let fetchCalls = 0;
  const results = await runIntegrationTests({
    config: { enabled: false, checks: [{ name: 'x', kind: 'service-to-service', url: 'http://127.0.0.1' }] },
    writeSummary: false,
    fetchImpl: async () => {
      fetchCalls += 1;
      return { status: 200, ok: true };
    },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'NOT_TESTED');
  assert.match(results[0].error?.message ?? '', /integration engine disabled/i);
  assert.equal(fetchCalls, 0);
});

test('integration enabled with empty checks → REQUIRES_CONFIGURATION', async () => {
  let fetchCalls = 0;
  const results = await runIntegrationTests({
    config: { enabled: true, checks: [] },
    writeSummary: false,
    fetchImpl: async () => {
      fetchCalls += 1;
      return { status: 200, ok: true };
    },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'REQUIRES_CONFIGURATION');
  assert.match(results[0].error?.message ?? '', /no integration checks configured/i);
  assert.equal(fetchCalls, 0);
});

test('integration check with no url → REQUIRES_CONFIGURATION (no network)', async () => {
  let fetchCalls = 0;
  const results = await runIntegrationTests({
    config: {
      enabled: true,
      checks: [{ name: 'missing-url', kind: 'api-to-redis' }],
    },
    env: {},
    writeSummary: false,
    fetchImpl: async () => {
      fetchCalls += 1;
      return { status: 200, ok: true };
    },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'REQUIRES_CONFIGURATION');
  assert.match(results[0].error?.message ?? '', /no resolvable/i);
  assert.equal(fetchCalls, 0);
});
