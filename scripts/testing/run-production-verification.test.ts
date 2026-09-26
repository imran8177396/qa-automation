import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tallyEngineResults } from '../core/engine-contract';
import {
  PRODUCTION_CHECK_IDS,
  PRODUCTION_VERIFICATION_DISCLAIMER,
  assertProductionSafeProfile,
  productionVerificationAllows,
  runProductionVerification,
} from './run-production-verification';

const ALL_IDS = [
  PRODUCTION_CHECK_IDS.health,
  PRODUCTION_CHECK_IDS.smoke,
  PRODUCTION_CHECK_IDS.criticalApi,
  PRODUCTION_CHECK_IDS.criticalUi,
  PRODUCTION_CHECK_IDS.criticalWorkflow,
] as const;

test('disabled → all five NOT_TESTED; exit policy matches smoke (no FAIL)', async () => {
  let fetchCalls = 0;
  const results = await runProductionVerification(
    {
      enabled: false,
      health: true,
      smoke: true,
      criticalApi: true,
      criticalUi: true,
      criticalWorkflow: true,
      websiteUrl: 'https://example.test',
      apiUrl: 'https://api.example.test',
    },
    {},
    {
      writeSummary: false,
      lastTargetUrl: null,
      argv: [],
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  assert.equal(results.length, 5);
  assert.deepEqual(
    results.map((r) => r.id),
    [...ALL_IDS]
  );
  for (const row of results) {
    assert.equal(row.status, 'NOT_TESTED', row.id);
    assert.match(row.error?.message ?? '', /production verification is disabled/i);
  }
  assert.equal(fetchCalls, 0);
  const tallied = tallyEngineResults(results);
  assert.equal(tallied.failCount, 0);
  assert.equal(tallied.passed, true);
  assert.equal(tallied.notTestedCount, 5);
});

test('enabled, empty URL → REQUIRES_CONFIGURATION for checks that need that URL', async () => {
  let fetchCalls = 0;
  const results = await runProductionVerification(
    {
      enabled: true,
      health: true,
      smoke: true,
      criticalApi: true,
      criticalUi: true,
      criticalWorkflow: true,
      websiteUrl: '',
      apiUrl: '',
    },
    {},
    {
      writeSummary: false,
      lastTargetUrl: null,
      argv: [],
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  assert.equal(results.length, 5);
  for (const id of [
    PRODUCTION_CHECK_IDS.health,
    PRODUCTION_CHECK_IDS.smoke,
    PRODUCTION_CHECK_IDS.criticalUi,
    PRODUCTION_CHECK_IDS.criticalWorkflow,
  ] as const) {
    const row = results.find((r) => r.id === id);
    assert.ok(row, id);
    assert.equal(row.status, 'REQUIRES_CONFIGURATION', id);
    assert.match(row.error?.message ?? '', /no website URL configured/i);
  }
  const api = results.find((r) => r.id === PRODUCTION_CHECK_IDS.criticalApi);
  assert.ok(api);
  assert.equal(api.status, 'REQUIRES_CONFIGURATION');
  assert.match(api.error?.message ?? '', /no API URL configured/i);
  assert.equal(fetchCalls, 0);
});

test('heavy/security/destructive kinds are not allowed', () => {
  for (const kind of [
    'heavy',
    'security',
    'destructive',
    'load',
    'stress',
    'spike',
    'soak',
    'chaos',
    'fault-injection',
  ]) {
    assert.equal(productionVerificationAllows(kind), false, kind);
    assert.equal(assertProductionSafeProfile(kind), false, kind);
  }
  assert.equal(productionVerificationAllows('health'), true);
  assert.equal(productionVerificationAllows('smoke'), true);
  assert.equal(productionVerificationAllows('critical-api'), true);
});

test('result IDs are the five stable production:* ids', async () => {
  const results = await runProductionVerification(
    { enabled: false },
    {},
    { writeSummary: false, lastTargetUrl: null, argv: [] }
  );
  assert.deepEqual(
    results.map((r) => r.id),
    [...ALL_IDS]
  );
});

test('summary text states production is not safe for heavy/security/destructive testing', () => {
  assert.match(
    PRODUCTION_VERIFICATION_DISCLAIMER,
    /does not authorize heavy, security, or destructive testing/i
  );
  assert.equal(
    PRODUCTION_VERIFICATION_DISCLAIMER,
    'Production verification does not authorize heavy, security, or destructive testing.'
  );
});

test('runner source does not embed saucedemo or jsonplaceholder hosts', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'run-production-verification.ts'),
    'utf8'
  );
  assert.equal(/saucedemo/i.test(source), false);
  assert.equal(/jsonplaceholder/i.test(source), false);
});

test('enabled with check flags false → NOT_TESTED without network', async () => {
  let fetchCalls = 0;
  const results = await runProductionVerification(
    {
      enabled: true,
      health: false,
      smoke: false,
      criticalApi: false,
      criticalUi: false,
      criticalWorkflow: false,
      websiteUrl: 'https://example.test/',
      apiUrl: 'https://api.example.test/',
    },
    {},
    {
      writeSummary: false,
      lastTargetUrl: null,
      argv: [],
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  assert.equal(results.length, 5);
  for (const row of results) {
    assert.equal(row.status, 'NOT_TESTED', row.id);
  }
  assert.equal(fetchCalls, 0);
});
