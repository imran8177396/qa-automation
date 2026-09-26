/**
 * Unit tests for in-memory webhook flow — no network, no listen, no secrets logged.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  WEBHOOK_CHECK_IDS,
  runWebhookFlow,
  signWebhook,
} from './webhook';

const SOURCE = readFileSync(path.join(__dirname, 'webhook.ts'), 'utf8');

function byId(results: ReturnType<typeof runWebhookFlow>) {
  return Object.fromEntries(results.map((r) => [r.id, r]));
}

function reasonOf(row: { metadata?: Record<string, unknown>; error?: { message?: string } }): string {
  return String(row.metadata?.reason ?? row.error?.message ?? '');
}

test('disabled → NOT_APPLICABLE, no secret required', () => {
  const results = runWebhookFlow({ enabled: false, deliveries: [] });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, WEBHOOK_CHECK_IDS.notEnabled);
  assert.equal(results[0]?.status, 'NOT_APPLICABLE');
  assert.match(reasonOf(results[0]!), /webhook testing is not enabled for this application/);
});

test('good secret + one delivery → signature PASS; tampered signature FAIL without secret in text', () => {
  const secret = 'test-secret';
  const body = JSON.stringify({ type: 'invoice.paid' });
  const signed = signWebhook(secret, body);
  assert.equal(signed.status, 'PASS');
  if (signed.status !== 'PASS') return;

  const good = byId(
    runWebhookFlow({
      enabled: true,
      secret,
      deliveries: [{ id: 'evt-1', attempt: 1, body, signature: signed.signature }],
    })
  );
  assert.equal(good[WEBHOOK_CHECK_IDS.signature]?.status, 'PASS');

  const bad = byId(
    runWebhookFlow({
      enabled: true,
      secret,
      deliveries: [
        {
          id: 'evt-1',
          attempt: 1,
          body,
          signature: '0'.repeat(signed.signature.length),
        },
      ],
    })
  );
  assert.equal(bad[WEBHOOK_CHECK_IDS.signature]?.status, 'FAIL');
  const failText = JSON.stringify(bad[WEBHOOK_CHECK_IDS.signature]);
  assert.ok(!failText.includes(secret), 'failure text must not contain the secret');
});

test('duplicate same id and same attempt → duplicate FAIL', () => {
  const results = byId(
    runWebhookFlow({
      enabled: true,
      secret: 'test-secret',
      deliveries: [
        { id: 'evt-dup', attempt: 1, body: '{}' },
        { id: 'evt-dup', attempt: 1, body: '{}' },
      ],
    })
  );
  assert.equal(results[WEBHOOK_CHECK_IDS.duplicate]?.status, 'FAIL');
  assert.match(reasonOf(results[WEBHOOK_CHECK_IDS.duplicate]!), /duplicate delivery would be processed as new/);
  assert.match(reasonOf(results[WEBHOOK_CHECK_IDS.duplicate]!), /evt-dup/);
});

test('attempt 1 failed, attempt 2 ok → recovery reason contains failed; retry is not duplicate', () => {
  const results = byId(
    runWebhookFlow({
      enabled: true,
      secret: 'test-secret',
      deliveries: [
        { id: 'evt-1', attempt: 1, body: '{}', failed: true },
        { id: 'evt-1', attempt: 2, body: '{}' },
      ],
    })
  );
  assert.equal(results[WEBHOOK_CHECK_IDS.failureRecovery]?.status, 'PASS');
  assert.match(reasonOf(results[WEBHOOK_CHECK_IDS.failureRecovery]!), /failed/);
  assert.equal(results[WEBHOOK_CHECK_IDS.duplicate]?.status, 'PASS');
  assert.equal(results[WEBHOOK_CHECK_IDS.retry]?.status, 'PASS');
});

test('duration 50 with timeoutMs 10 → TIMEOUT, not PASS', () => {
  const results = byId(
    runWebhookFlow({
      enabled: true,
      secret: 'test-secret',
      timeoutMs: 10,
      deliveries: [{ id: 'evt-1', attempt: 1, body: '{}', durationMs: 50 }],
    })
  );
  assert.equal(results[WEBHOOK_CHECK_IDS.timeout]?.status, 'TIMEOUT');
  assert.notEqual(results[WEBHOOK_CHECK_IDS.timeout]?.status, 'PASS');
  assert.match(reasonOf(results[WEBHOOK_CHECK_IDS.timeout]!), /timeout after 10ms/);
});

test('sequences 1,3,2 → ordering FAIL', () => {
  const results = byId(
    runWebhookFlow({
      enabled: true,
      secret: 'test-secret',
      deliveries: [
        { id: 'a', attempt: 1, body: '{}', sequence: 1 },
        { id: 'b', attempt: 1, body: '{}', sequence: 3 },
        { id: 'c', attempt: 1, body: '{}', sequence: 2 },
      ],
    })
  );
  assert.equal(results[WEBHOOK_CHECK_IDS.ordering]?.status, 'FAIL');
});

test('expectedPayload mismatch → payload FAIL', () => {
  const results = byId(
    runWebhookFlow({
      enabled: true,
      secret: 'test-secret',
      expectedPayload: { type: 'invoice.paid' },
      deliveries: [{ id: 'evt-1', attempt: 1, body: JSON.stringify({ type: 'invoice.failed' }) }],
    })
  );
  assert.equal(results[WEBHOOK_CHECK_IDS.payload]?.status, 'FAIL');
});

test('no http:// request and no listen( in webhook source', () => {
  assert.ok(!SOURCE.includes('http://'), 'webhook.ts must not contain http://');
  assert.ok(!SOURCE.includes('https://'), 'webhook.ts must not contain https://');
  assert.ok(!SOURCE.includes('listen('), 'webhook.ts must not contain listen(');
});
