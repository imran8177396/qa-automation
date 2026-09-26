/**
 * Unit tests for scripts/testing/capabilities — no network, no secrets, no payloads.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TESTING_CAPABILITIES,
  generateFuzzInputs,
  checkProperties,
  planMutation,
  planRace,
  compareTenantIsolation,
  compareIdempotentResponses,
  signWebhook,
  verifyWebhook,
  duplicateEventIds,
  classifyQueueMessage,
  planBackupRestore,
  scanSensitiveKeys,
  planPrivacyRetention,
} from './index';
import { FUZZ_VERY_LONG_LENGTH } from './fuzz';

const FORBIDDEN_SUBSTRINGS = [
  'DROP TABLE',
  '<script>',
  'ignore previous instructions',
] as const;

test('TESTING_CAPABILITIES lists all ten with no IMPLEMENTED status', () => {
  assert.equal(TESTING_CAPABILITIES.length, 10);
  for (const c of TESTING_CAPABILITIES) {
    assert.notEqual(c.status, 'IMPLEMENTED');
    assert.ok(c.limitation.length > 0);
  }
});

test('fuzz list is non-empty and contains no exploit/jailbreak strings', () => {
  const inputs = generateFuzzInputs();
  assert.ok(inputs.length > 0);
  const serialized = JSON.stringify(inputs);
  for (const bad of FORBIDDEN_SUBSTRINGS) {
    assert.ok(!serialized.includes(bad), `fuzz inputs must not contain ${bad}`);
  }
  const values = inputs.map((i) => i.value);
  assert.ok(values.includes(null));
  assert.ok(values.includes(''));
  assert.ok(values.some((v) => typeof v === 'string' && /^\s+$/.test(v)));
  assert.ok(
    values.some((v) => typeof v === 'string' && v.length === FUZZ_VERY_LONG_LENGTH),
    `expected a string of length ${FUZZ_VERY_LONG_LENGTH}`
  );
});

test('property predicate false → FAIL', () => {
  const results = checkProperties([
    {
      name: 'string length bound',
      inputs: ['ok', 'toolong'],
      predicate: (v) => typeof v === 'string' && v.length <= 2,
    },
    {
      name: 'idempotent sort',
      inputs: [
        [3, 1, 2],
        [1, 2, 3],
      ],
      predicate: (v) => {
        if (!Array.isArray(v)) return false;
        const sorted = [...v].sort((a, b) => Number(a) - Number(b));
        const again = [...sorted].sort((a, b) => Number(a) - Number(b));
        return JSON.stringify(sorted) === JSON.stringify(again);
      },
    },
  ]);
  assert.equal(results[0]?.status, 'FAIL');
  assert.equal(results[0]?.assertion?.expected, 'predicate holds');
  assert.equal(results[0]?.assertion?.actual, 'false');
  assert.equal(results[1]?.status, 'PASS');
});

test('planMutation / planRace (live) / planBackupRestore stay NOT_IMPLEMENTED; race and backup-restore capabilities are PARTIAL', () => {
  assert.equal(planMutation().status, 'NOT_IMPLEMENTED');
  assert.equal(planRace().status, 'NOT_IMPLEMENTED');
  assert.equal(planBackupRestore().status, 'NOT_IMPLEMENTED');
  assert.match(planMutation().reason, /not implemented/i);
  assert.match(planRace().reason, /simultaneous operations are not started/i);
  assert.match(planBackupRestore().reason, /not executed/i);
  assert.match(planBackupRestore().reason, /never deleted/i);
  const raceCap = TESTING_CAPABILITIES.find((c) => c.id === 'race');
  assert.equal(raceCap?.status, 'PARTIAL');
  assert.match(raceCap?.limitation ?? '', /in-memory/i);
  const backupCap = TESTING_CAPABILITIES.find((c) => c.id === 'backup-restore');
  assert.equal(backupCap?.status, 'PARTIAL');
  assert.match(backupCap?.limitation ?? '', /caller evidence/i);
  assert.match(backupCap?.limitation ?? '', /never deleted/i);
});

test('tenant isolation FAIL / PASS / REQUIRES_CONFIGURATION', () => {
  const fail = compareTenantIsolation({
    tenantA: { id: 'tenant-a' },
    tenantB: { id: 'tenant-b' },
    body: { owner: 'tenant-b', data: true },
  });
  assert.equal(fail.status, 'FAIL');
  assert.equal(fail.assertion?.expected, 'other tenant id absent');
  assert.equal(fail.assertion?.actual, 'found');

  const pass = compareTenantIsolation({
    tenantA: { id: 'tenant-a' },
    tenantB: { id: 'tenant-b' },
    body: { owner: 'tenant-a', data: true },
  });
  assert.equal(pass.status, 'PASS');

  const needsConfig = compareTenantIsolation({
    tenantA: { id: '' },
    tenantB: { id: 'tenant-b' },
    body: { ok: true },
  });
  assert.equal(needsConfig.status, 'REQUIRES_CONFIGURATION');
  assert.match(needsConfig.error?.message ?? '', /tenant ids are required/);
});

test('idempotency FAIL on different resource ids; NOT_TESTED when id missing; no HTTP', () => {
  const fail = compareIdempotentResponses(
    { status: 201, resourceId: 'res-1' },
    { status: 201, resourceId: 'res-2' }
  );
  assert.equal(fail.status, 'FAIL');
  assert.match(fail.error?.message ?? '', /different resource id/);

  const missing = compareIdempotentResponses({ status: 200 }, { status: 200 });
  assert.equal(missing.status, 'NOT_TESTED');
  assert.match(missing.error?.message ?? '', /resource id was not returned/);

  const oneMissing = compareIdempotentResponses(
    { status: 200, resourceId: 'res-1' },
    { status: 200 }
  );
  assert.equal(oneMissing.status, 'NOT_TESTED');
});

test('webhook bad signature FAIL, good signature PASS, duplicate ids listed', () => {
  const secret = 'fake-test-secret';
  const body = '{"event":"demo"}';
  const signed = signWebhook(secret, body);
  assert.equal(signed.status, 'PASS');
  if (signed.status !== 'PASS') return;

  const good = verifyWebhook({ secret, body, signature: signed.signature });
  assert.equal(good.status, 'PASS');

  const bad = verifyWebhook({ secret, body, signature: '0'.repeat(signed.signature.length) });
  assert.equal(bad.status, 'FAIL');

  const dups = duplicateEventIds([
    { id: 'evt-1', attempt: 1 },
    { id: 'evt-1', attempt: 1 },
    { id: 'evt-2', attempt: 1 },
  ]);
  assert.deepEqual(dups, ['evt-1']);
});

test('queue out-of-order and failed classification', () => {
  assert.equal(
    classifyQueueMessage({ sequence: 2, expectedSequence: 1 }),
    'out-of-order'
  );
  assert.equal(classifyQueueMessage({ failed: true, duplicate: true, delayMs: 5 }), 'failed');
});

test('privacy FAIL on password key, PASS on safe object, retention NOT_IMPLEMENTED; capability PARTIAL', () => {
  const fail = scanSensitiveKeys({ password: 'fake-placeholder' });
  assert.equal(fail.status, 'FAIL');
  assert.ok(fail.exposed.some((p) => p.includes('password')));
  assert.equal(fail.expected, 'sensitive keys absent');
  assert.equal(JSON.stringify(fail).includes('fake-placeholder'), false);

  const pass = scanSensitiveKeys({ name: 'Ada' });
  assert.equal(pass.status, 'PASS');
  assert.deepEqual(pass.exposed, []);

  const retention = planPrivacyRetention();
  assert.equal(retention.status, 'NOT_IMPLEMENTED');
  assert.match(retention.reason, /retention and deletion are not executed/);

  const privacyCap = TESTING_CAPABILITIES.find((c) => c.id === 'privacy');
  assert.equal(privacyCap?.status, 'PARTIAL');
  assert.match(privacyCap?.limitation ?? '', /live deletion/i);
});
