import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DESTRUCTIVE_RESILIENCE_KINDS } from './resilience-auth';
import {
  RELIABILITY_CHECK_IDS,
  runReliability,
} from './run-reliability';

const SAFE_IDS = Object.values(RELIABILITY_CHECK_IDS);

test('reliability disabled → NOT_TESTED and no PASS', async () => {
  let fetchCalls = 0;
  const results = await runReliability(
    { enabled: false, healthUrl: 'https://example.test/health' },
    {},
    {
      writeSummary: false,
      argv: [],
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'NOT_TESTED');
  assert.match(results[0].error?.message ?? '', /reliability engine disabled/i);
  assert.equal(results.some((r) => r.status === 'PASS'), false);
  assert.equal(fetchCalls, 0);
  assert.equal(
    results.some((r) => DESTRUCTIVE_RESILIENCE_KINDS.some((k) => r.id.endsWith(`:${k}`))),
    false,
    'disabled run must not emit destructive rows'
  );
});

test('reliability enabled, no URLs → safe REQUIRES_CONFIGURATION; destructive BLOCKED', async () => {
  let fetchCalls = 0;
  const results = await runReliability(
    { enabled: true },
    {},
    {
      writeSummary: false,
      argv: [],
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  for (const id of SAFE_IDS) {
    const row = results.find((r) => r.id === id);
    assert.ok(row, `missing ${id}`);
    assert.equal(row.status, 'REQUIRES_CONFIGURATION', id);
  }
  for (const kind of DESTRUCTIVE_RESILIENCE_KINDS) {
    const row = results.find((r) => r.id === `reliability:${kind}`);
    assert.ok(row, `missing reliability:${kind}`);
    assert.equal(row.status, 'BLOCKED');
    assert.match(
      row.error?.message ?? '',
      /destructive fault injection requires --authorize-destructive or QA_RESILIENCE_AUTHORIZE/
    );
  }
  assert.equal(fetchCalls, 0);
});

test('authorize true → destructive NOT_TESTED; fetchImpl never called for those ids', async () => {
  let fetchCalls = 0;
  const results = await runReliability(
    { enabled: true, healthUrl: 'https://example.test/health' },
    { QA_RESILIENCE_AUTHORIZE: 'true' },
    {
      writeSummary: false,
      argv: [],
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  for (const kind of DESTRUCTIVE_RESILIENCE_KINDS) {
    const row = results.find((r) => r.id === `reliability:${kind}`);
    assert.ok(row);
    assert.equal(row.status, 'NOT_TESTED');
    assert.match(row.error?.message ?? '', /fault injection is not implemented/);
  }
  // Shared health GET (1) + retry first attempt succeeds (1) = 2. Never more for destructive ids.
  assert.equal(fetchCalls, 2);
});

test('authorize via --authorize-destructive argv', async () => {
  const results = await runReliability(
    { enabled: true },
    {},
    {
      writeSummary: false,
      argv: ['--authorize-destructive'],
      fetchImpl: async () => ({ status: 200, ok: true }),
    }
  );
  const chaos = results.find((r) => r.id === 'reliability:chaos');
  assert.ok(chaos);
  assert.equal(chaos.status, 'NOT_TESTED');
  assert.match(chaos.error?.message ?? '', /not implemented/);
});

test('fetchImpl that throws → error-handling FAIL; result is TestResult not throw', async () => {
  let fetchCalls = 0;
  const results = await runReliability(
    { enabled: true, healthUrl: 'https://example.test/health', timeoutMs: 5000 },
    {},
    {
      writeSummary: false,
      argv: [],
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('simulated network failure');
      },
    }
  );
  assert.ok(Array.isArray(results));
  const errorHandling = results.find((r) => r.id === RELIABILITY_CHECK_IDS.errorHandling);
  assert.ok(errorHandling);
  assert.equal(errorHandling.status, 'FAIL');
  assert.match(errorHandling.error?.message ?? '', /simulated network failure/);
  const health = results.find((r) => r.id === RELIABILITY_CHECK_IDS.serviceHealth);
  assert.ok(health);
  assert.equal(health.status, 'FAIL');
  assert.ok(fetchCalls >= 1);
});
