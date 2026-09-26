import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEPLOYMENT_CHECK_IDS,
  deploymentAuthorized,
  runDeployment,
} from './run-deployment';

const SAFE_URL_AND_ENV_IDS = [
  DEPLOYMENT_CHECK_IDS.health,
  DEPLOYMENT_CHECK_IDS.readiness,
  DEPLOYMENT_CHECK_IDS.configuration,
  DEPLOYMENT_CHECK_IDS.environment,
  DEPLOYMENT_CHECK_IDS.verification,
] as const;

const DESTRUCTIVE_IDS = [
  DEPLOYMENT_CHECK_IDS.migration,
  DEPLOYMENT_CHECK_IDS.rollback,
] as const;

test('deployment disabled → NOT_TESTED', async () => {
  let fetchCalls = 0;
  const results = await runDeployment(
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
  assert.match(results[0].error?.message ?? '', /deployment engine disabled/i);
  assert.equal(fetchCalls, 0);
  assert.equal(
    results.some((r) => DESTRUCTIVE_IDS.includes(r.id as (typeof DESTRUCTIVE_IDS)[number])),
    false
  );
});

test('enabled, no URLs, empty requiredEnv → REQUIRES_CONFIGURATION; migration/rollback BLOCKED', async () => {
  let fetchCalls = 0;
  const results = await runDeployment(
    { enabled: true, requiredEnv: [] },
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
  for (const id of SAFE_URL_AND_ENV_IDS) {
    const row = results.find((r) => r.id === id);
    assert.ok(row, `missing ${id}`);
    assert.equal(row.status, 'REQUIRES_CONFIGURATION', id);
  }
  for (const id of DESTRUCTIVE_IDS) {
    const row = results.find((r) => r.id === id);
    assert.ok(row, `missing ${id}`);
    assert.equal(row.status, 'BLOCKED');
    assert.match(
      row.error?.message ?? '',
      /destructive deployment action requires --authorize-deployment or QA_DEPLOY_AUTHORIZE/
    );
  }
  assert.equal(fetchCalls, 0);
});

test('authorize flag → migration and rollback NOT_TESTED; fetchImpl not used for those two', async () => {
  let fetchCalls = 0;
  const results = await runDeployment(
    {
      enabled: true,
      healthUrl: 'https://example.test/health',
      readinessUrl: 'https://example.test/ready',
      requiredEnv: ['QA_EXAMPLE_PRESENT'],
    },
    { QA_EXAMPLE_PRESENT: '1' },
    {
      writeSummary: false,
      argv: ['--authorize-deployment'],
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  for (const id of DESTRUCTIVE_IDS) {
    const row = results.find((r) => r.id === id);
    assert.ok(row, `missing ${id}`);
    assert.equal(row.status, 'NOT_TESTED');
    assert.match(row.error?.message ?? '', /migration\/rollback execution is not implemented/);
  }
  // health + readiness + verification (falls back to healthUrl) = 3. Never for destructive ids.
  assert.equal(fetchCalls, 3);
  assert.equal(deploymentAuthorized(['--authorize-deployment'], {}), true);
  assert.equal(deploymentAuthorized([], { QA_DEPLOY_AUTHORIZE: 'true' }), true);
  assert.equal(deploymentAuthorized([], { QA_RESILIENCE_AUTHORIZE: 'true' }), false);
});

test('requiredEnv present → configuration PASS; unset → FAIL with name only', async () => {
  const present = await runDeployment(
    { enabled: true, requiredEnv: ['QA_EXAMPLE_PRESENT'] },
    { QA_EXAMPLE_PRESENT: 'set-in-test' },
    {
      writeSummary: false,
      argv: [],
      fetchImpl: async () => ({ status: 200, ok: true }),
    }
  );
  const configPass = present.find((r) => r.id === DEPLOYMENT_CHECK_IDS.configuration);
  assert.ok(configPass);
  assert.equal(configPass.status, 'PASS');

  const absent = await runDeployment(
    { enabled: true, requiredEnv: ['QA_EXAMPLE_PRESENT'] },
    {},
    {
      writeSummary: false,
      argv: [],
      fetchImpl: async () => ({ status: 200, ok: true }),
    }
  );
  const configFail = absent.find((r) => r.id === DEPLOYMENT_CHECK_IDS.configuration);
  assert.ok(configFail);
  assert.equal(configFail.status, 'FAIL');
  assert.match(configFail.error?.message ?? '', /QA_EXAMPLE_PRESENT/);
  assert.equal((configFail.error?.message ?? '').includes('set-in-test'), false);
});

test('fetchImpl throw → health FAIL; function returns results', async () => {
  const results = await runDeployment(
    { enabled: true, healthUrl: 'https://example.test/health' },
    {},
    {
      writeSummary: false,
      argv: [],
      fetchImpl: async () => {
        throw new Error('network down');
      },
    }
  );
  assert.ok(results.length >= 7);
  const health = results.find((r) => r.id === DEPLOYMENT_CHECK_IDS.health);
  assert.ok(health);
  assert.equal(health.status, 'FAIL');
  assert.match(health.error?.message ?? '', /network down/);
});
