/**
 * Unit tests for optional multi-tenant checks — no network, no product hard-coding.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MULTI_TENANT_CHECK_IDS,
  runMultiTenantChecks,
} from './multi-tenant';

const SOURCE = readFileSync(path.join(__dirname, 'multi-tenant.ts'), 'utf8');

test('enabled false → NOT_APPLICABLE, no FAIL, reason says not enabled; works with no identities', () => {
  const results = runMultiTenantChecks({ enabled: false });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, 'NOT_APPLICABLE');
  assert.notEqual(results[0]?.status, 'FAIL');
  assert.match(
    String(results[0]?.metadata?.reason ?? results[0]?.error?.message ?? ''),
    /multi-tenant testing is not enabled for this application/
  );
  assert.equal(results[0]?.id, MULTI_TENANT_CHECK_IDS.notEnabled);
});

test('enabled true, missing tenantId → REQUIRES_CONFIGURATION', () => {
  const results = runMultiTenantChecks({
    enabled: true,
    tenantA: { identity: {}, body: { n: 1 } },
    tenantB: { identity: { tenantId: 'tenant-b' }, body: { tenantId: 'tenant-b' } },
  });
  const ownA = results.find((r) => r.id === MULTI_TENANT_CHECK_IDS.tenantAOwnData);
  assert.ok(ownA);
  assert.equal(ownA.status, 'REQUIRES_CONFIGURATION');
  assert.match(String(ownA.metadata?.reason ?? ownA.error?.message ?? ''), /tenantId is required/);
});

test('enabled true, isolated bodies → both own-data PASS, cross-access PASS', () => {
  const results = runMultiTenantChecks({
    enabled: true,
    tenantA: {
      identity: { tenantId: 'tenant-a' },
      body: { tenantId: 'tenant-a', n: 1 },
    },
    tenantB: {
      identity: { tenantId: 'tenant-b' },
      body: { tenantId: 'tenant-b', n: 2 },
    },
  });
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.equal(byId[MULTI_TENANT_CHECK_IDS.tenantAOwnData]?.status, 'PASS');
  assert.equal(byId[MULTI_TENANT_CHECK_IDS.tenantBOwnData]?.status, 'PASS');
  assert.equal(byId[MULTI_TENANT_CHECK_IDS.tenantACannotAccessTenantB]?.status, 'PASS');
});

test('A body contains tenant-b → cross-access FAIL; A own-data still PASS when tenant-a present', () => {
  const results = runMultiTenantChecks({
    enabled: true,
    tenantA: {
      identity: { tenantId: 'tenant-a' },
      body: { tenantId: 'tenant-a', leaked: 'tenant-b', n: 1 },
    },
    tenantB: {
      identity: { tenantId: 'tenant-b' },
      body: { tenantId: 'tenant-b', n: 2 },
    },
  });
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.equal(byId[MULTI_TENANT_CHECK_IDS.tenantAOwnData]?.status, 'PASS');
  assert.equal(byId[MULTI_TENANT_CHECK_IDS.tenantACannotAccessTenantB]?.status, 'FAIL');
  assert.equal(byId[MULTI_TENANT_CHECK_IDS.tenantBOwnData]?.status, 'PASS');
});

test('implementation does not hard-code demo product hosts', () => {
  const impl = SOURCE.toLowerCase();
  const forbidden = ['sauce' + 'demo', 'json' + 'placeholder'];
  for (const needle of forbidden) {
    assert.ok(!impl.includes(needle), `must not contain ${needle}`);
  }
});
