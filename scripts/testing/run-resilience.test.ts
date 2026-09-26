import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DESTRUCTIVE_RESILIENCE_KINDS } from './resilience-auth';
import {
  RESILIENCE_CHECK_IDS,
  runResilience,
} from './run-resilience';

test('resilience disabled → NOT_TESTED and no PASS', async () => {
  let fetchCalls = 0;
  const results = await runResilience(
    { enabled: false, dependencyUrl: 'https://example.test/dep' },
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
  assert.match(results[0].error?.message ?? '', /resilience engine disabled/i);
  assert.equal(results.some((r) => r.status === 'PASS'), false);
  assert.equal(fetchCalls, 0);
});

test('resilience recovery: no URL → REQUIRES_CONFIGURATION', async () => {
  let fetchCalls = 0;
  const results = await runResilience(
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
  const recovery = results.find((r) => r.id === RESILIENCE_CHECK_IDS.recovery);
  assert.ok(recovery);
  assert.equal(recovery.status, 'REQUIRES_CONFIGURATION');
  const dep = results.find((r) => r.id === RESILIENCE_CHECK_IDS.dependencyUnavailable);
  assert.ok(dep);
  assert.equal(dep.status, 'REQUIRES_CONFIGURATION');
  const health = results.find((r) => r.id === RESILIENCE_CHECK_IDS.serviceHealth);
  assert.ok(health);
  assert.equal(health.status, 'REQUIRES_CONFIGURATION');
  for (const kind of DESTRUCTIVE_RESILIENCE_KINDS) {
    const row = results.find((r) => r.id === `resilience:${kind}`);
    assert.ok(row);
    assert.equal(row.status, 'BLOCKED');
    assert.notEqual(row.status, 'PASS');
    assert.ok((row.error?.message ?? '').length > 0);
  }
  assert.equal(fetchCalls, 0);
});

test('resilience recovery: fetchImpl fails then succeeds → PASS recovered', async () => {
  let fetchCalls = 0;
  const results = await runResilience(
    {
      enabled: true,
      dependencyUrl: 'https://example.test/dep',
      healthUrl: 'https://example.test/health',
    },
    {},
    {
      writeSummary: false,
      argv: [],
      fetchImpl: async (url) => {
        fetchCalls += 1;
        // dependency-unavailable (1), recovery first (2), recovery second (3), health (4)
        if (url.includes('/dep') && fetchCalls <= 2) {
          throw new Error('temporary unavailable');
        }
        return { status: 200, ok: true };
      },
    }
  );
  const recovery = results.find((r) => r.id === RESILIENCE_CHECK_IDS.recovery);
  assert.ok(recovery);
  assert.equal(recovery.status, 'PASS');
  assert.equal(recovery.metadata?.recovered, true);
  assert.ok(fetchCalls >= 3);
  assert.equal(
    results.filter((r) =>
      DESTRUCTIVE_RESILIENCE_KINDS.some((k) => r.id === `resilience:${k}`)
    ).every((r) => r.status === 'BLOCKED'),
    true
  );
});

test('authorize true → destructive NOT_TESTED; no fault injection fetch', async () => {
  let fetchCalls = 0;
  const results = await runResilience(
    { enabled: true, dependencyUrl: 'https://example.test/dep' },
    {},
    {
      writeSummary: false,
      argv: ['--authorize-destructive'],
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  for (const kind of DESTRUCTIVE_RESILIENCE_KINDS) {
    const row = results.find((r) => r.id === `resilience:${kind}`);
    assert.ok(row);
    assert.equal(row.status, 'NOT_TESTED');
    assert.match(row.error?.message ?? '', /not implemented/);
  }
  // dependency-unavailable (1) + recovery (2) + no health URL → 3 GETs max.
  assert.equal(fetchCalls, 3);
});
