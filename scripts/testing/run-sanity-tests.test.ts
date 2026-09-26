import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSanity } from './run-sanity-tests';

test('sanity disabled → NOT_TESTED', async () => {
  let fetchCalls = 0;
  const results = await runSanity(
    { enabled: false, checks: [{ id: 'should-not-run', url: 'http://127.0.0.1/x' }] },
    {},
    {
      writeSummary: false,
      lastTargetUrl: null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'NOT_TESTED');
  assert.match(results[0].error?.message ?? '', /sanity engine disabled/i);
  assert.equal(fetchCalls, 0);
});

test('sanity enabled with empty checks → REQUIRES_CONFIGURATION (not regression)', async () => {
  let fetchCalls = 0;
  const results = await runSanity(
    { enabled: true, checks: [], websiteUrl: '' },
    {},
    {
      writeSummary: false,
      lastTargetUrl: null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'REQUIRES_CONFIGURATION');
  assert.match(results[0].error?.message ?? '', /not regression/i);
  assert.equal(fetchCalls, 0);
});

test('sanity check with path /health and no website URL → REQUIRES_CONFIGURATION', async () => {
  let fetchCalls = 0;
  const results = await runSanity(
    {
      enabled: true,
      checks: [{ id: 'health', path: '/health' }],
      websiteUrl: '',
      playwrightBaseUrl: undefined,
    },
    {},
    {
      writeSummary: false,
      lastTargetUrl: null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'health');
  assert.equal(results[0].status, 'REQUIRES_CONFIGURATION');
  assert.equal(fetchCalls, 0);
});

test('sanity check with empty url and no path → REQUIRES_CONFIGURATION', async () => {
  let fetchCalls = 0;
  const results = await runSanity(
    {
      enabled: true,
      checks: [{ id: 'empty-url', url: '' }],
      websiteUrl: '',
    },
    {},
    {
      writeSummary: false,
      lastTargetUrl: null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'empty-url');
  assert.equal(results[0].status, 'REQUIRES_CONFIGURATION');
  assert.equal(fetchCalls, 0);
});
