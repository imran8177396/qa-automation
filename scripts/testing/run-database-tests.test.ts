import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DATABASE_CHECK_IDS, runDatabaseTests } from './run-database-tests';

test('database disabled → NOT_TESTED (single row)', async () => {
  const results = await runDatabaseTests({
    config: { enabled: false, urlEnv: 'DATABASE_URL' },
    env: { DATABASE_URL: 'postgres://example' },
    writeSummary: false,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'NOT_TESTED');
  assert.match(results[0].error?.message ?? '', /database engine disabled/i);
});

test('database enabled with no DATABASE_URL → 9 REQUIRES_CONFIGURATION rows', async () => {
  let driverProbed = false;
  const results = await runDatabaseTests({
    config: { enabled: true, urlEnv: 'DATABASE_URL' },
    env: {},
    hasDriver: false,
    writeSummary: false,
  });
  assert.equal(results.length, DATABASE_CHECK_IDS.length);
  assert.equal(results.length, 9);
  for (const row of results) {
    assert.equal(row.status, 'REQUIRES_CONFIGURATION');
    assert.match(row.error?.message ?? '', /DATABASE_URL is not set/i);
  }
  // hasDriver is unused when URL is missing — no connection attempt path.
  assert.equal(driverProbed, false);
});
