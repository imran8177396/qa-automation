/**
 * Deterministic unit tests for evidence-only privacy checks.
 * No network, no fs delete, no realistic customer PII, no secret echoing.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../../lib/paths';
import {
  PRIVACY_CHECK_IDS,
  classifyPrivacyEvidence,
  planPrivacyRetention,
  runPrivacyChecks,
  scanSensitiveKeys,
} from './privacy';

function byId(results: ReturnType<typeof runPrivacyChecks>) {
  return Object.fromEntries(results.map((r) => [r.id, r]));
}

function reasonOf(row: { metadata?: Record<string, unknown>; error?: { message?: string } }): string {
  return String(row.metadata?.reason ?? row.error?.message ?? '');
}

function serializeResults(results: ReturnType<typeof runPrivacyChecks>): string {
  return JSON.stringify(results);
}

function trackingHooks() {
  const called = { delete: 0, export: 0, enforceRetention: 0 };
  return {
    called,
    hooks: {
      delete: () => {
        called.delete += 1;
      },
      export: () => {
        called.export += 1;
      },
      enforceRetention: () => {
        called.enforceRetention += 1;
      },
    },
  };
}

test('planPrivacyRetention remains NOT_IMPLEMENTED', () => {
  const plan = planPrivacyRetention();
  assert.equal(plan.status, 'NOT_IMPLEMENTED');
  assert.match(plan.reason, /retention and deletion are not executed/);
});

test('disabled → NOT_APPLICABLE privacy:not-enabled', () => {
  const results = runPrivacyChecks({ enabled: false });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, PRIVACY_CHECK_IDS.notEnabled);
  assert.equal(results[0]?.status, 'NOT_APPLICABLE');
  assert.match(reasonOf(results[0]!), /not enabled/i);
});

test('enabled with missing evidence → NOT_TESTED per check', () => {
  const results = byId(runPrivacyChecks({ enabled: true }));
  assert.equal(results[PRIVACY_CHECK_IDS.piiExposure]?.status, 'NOT_TESTED');
  assert.equal(results[PRIVACY_CHECK_IDS.sensitiveFieldsInApiResponses]?.status, 'NOT_TESTED');
  assert.equal(results[PRIVACY_CHECK_IDS.logsContainingSecrets]?.status, 'NOT_TESTED');
  assert.equal(results[PRIVACY_CHECK_IDS.logsContainingPasswordsTokens]?.status, 'NOT_TESTED');
  assert.equal(results[PRIVACY_CHECK_IDS.dataDeletion]?.status, 'NOT_TESTED');
  assert.equal(results[PRIVACY_CHECK_IDS.retention]?.status, 'NOT_TESTED');
  assert.equal(results[PRIVACY_CHECK_IDS.export]?.status, 'NOT_TESTED');
  for (const id of Object.values(PRIVACY_CHECK_IDS).filter((x) => x !== PRIVACY_CHECK_IDS.notEnabled)) {
    assert.match(reasonOf(results[id]!), /./);
  }
});

test('PII key present → FAIL with field name; fixture value absent from reason/json', () => {
  const fixtureValue = 'pii-fixture-value';
  const results = byId(
    runPrivacyChecks({
      enabled: true,
      evidence: {
        payloadKeys: ['email', 'displayName'],
        payload: { email: fixtureValue, displayName: 'fixture-label' },
      },
    })
  );
  assert.equal(results[PRIVACY_CHECK_IDS.piiExposure]?.status, 'FAIL');
  assert.match(reasonOf(results[PRIVACY_CHECK_IDS.piiExposure]!), /email/);
  const blob = serializeResults(Object.values(results));
  assert.equal(blob.includes(fixtureValue), false);
});

test('no PII keys → PASS', () => {
  const results = byId(
    runPrivacyChecks({
      enabled: true,
      evidence: { payloadKeys: ['displayName', 'productId'] },
    })
  );
  assert.equal(results[PRIVACY_CHECK_IDS.piiExposure]?.status, 'PASS');
});

test('password/token key in logs → FAIL; token-fixture value not in output', () => {
  const tokenFixture = 'token-fixture';
  const results = byId(
    runPrivacyChecks({
      enabled: true,
      evidence: {
        logEntries: [
          { key: 'password', valuePresent: true },
          { key: 'token', valuePresent: true },
          { key: 'requestId', valuePresent: true },
        ],
        // Intentionally not placing tokenFixture into evidence values that become reasons.
      },
    })
  );
  assert.equal(results[PRIVACY_CHECK_IDS.logsContainingSecrets]?.status, 'FAIL');
  assert.equal(results[PRIVACY_CHECK_IDS.logsContainingPasswordsTokens]?.status, 'FAIL');
  assert.match(reasonOf(results[PRIVACY_CHECK_IDS.logsContainingPasswordsTokens]!), /password|token/i);
  const blob = serializeResults(Object.values(results));
  assert.equal(blob.includes(tokenFixture), false);
  assert.match(reasonOf(results[PRIVACY_CHECK_IDS.logsContainingSecrets]!), /token/i);
});

test('production deletion → BLOCKED; delete hook not called', () => {
  const { called, hooks } = trackingHooks();
  const results = byId(
    runPrivacyChecks({
      enabled: true,
      environment: 'production',
      evidence: { deletionStatus: 'succeeded' },
      hooks,
    })
  );
  assert.equal(results[PRIVACY_CHECK_IDS.dataDeletion]?.status, 'BLOCKED');
  assert.match(reasonOf(results[PRIVACY_CHECK_IDS.dataDeletion]!), /production data is never deleted/i);
  assert.match(reasonOf(results[PRIVACY_CHECK_IDS.dataDeletion]!), /not executed/i);
  assert.equal(called.delete, 0);
  assert.equal(called.export, 0);
  assert.equal(called.enforceRetention, 0);
});

test('retention within policy → PASS; over policy → FAIL; missing numbers → NOT_TESTED', () => {
  const within = byId(
    runPrivacyChecks({
      enabled: true,
      evidence: { retainedDays: 7, policyDays: 30 },
    })
  );
  assert.equal(within[PRIVACY_CHECK_IDS.retention]?.status, 'PASS');

  const over = byId(
    runPrivacyChecks({
      enabled: true,
      evidence: { retainedDays: 90, policyDays: 30 },
    })
  );
  assert.equal(over[PRIVACY_CHECK_IDS.retention]?.status, 'FAIL');

  const missing = byId(runPrivacyChecks({ enabled: true, evidence: { retainedDays: 5 } }));
  assert.equal(missing[PRIVACY_CHECK_IDS.retention]?.status, 'NOT_TESTED');
});

test('export succeeded → PASS; missing → NOT_TESTED', () => {
  const ok = byId(
    runPrivacyChecks({
      enabled: true,
      evidence: { exportStatus: 'succeeded', exportFormat: 'json' },
    })
  );
  assert.equal(ok[PRIVACY_CHECK_IDS.export]?.status, 'PASS');

  const missing = byId(runPrivacyChecks({ enabled: true, evidence: {} }));
  assert.equal(missing[PRIVACY_CHECK_IDS.export]?.status, 'NOT_TESTED');
});

test('sensitive API fields FAIL lists key names only; fixture secret absent', () => {
  const secretFixture = 'token-fixture';
  const results = byId(
    runPrivacyChecks({
      enabled: true,
      evidence: {
        apiFields: ['password', 'userId'],
        payload: { password: secretFixture },
      },
    })
  );
  assert.equal(results[PRIVACY_CHECK_IDS.sensitiveFieldsInApiResponses]?.status, 'FAIL');
  assert.match(reasonOf(results[PRIVACY_CHECK_IDS.sensitiveFieldsInApiResponses]!), /password/);
  assert.equal(serializeResults(Object.values(results)).includes(secretFixture), false);
});

test('classifyPrivacyEvidence accepts security-shaped evidence without enabling config', () => {
  const results = byId(
    classifyPrivacyEvidence(
      {
        payloadKeys: ['fullName'],
        apiFields: ['authorization'],
        logEntries: [{ key: 'secret', valuePresent: true }],
        deletionStatus: 'failed',
        retainedDays: 1,
        policyDays: 1,
        exportStatus: 'succeeded',
        exportFormat: 'csv',
      },
      { environment: 'staging' }
    )
  );
  assert.equal(results[PRIVACY_CHECK_IDS.piiExposure]?.status, 'FAIL');
  assert.equal(results[PRIVACY_CHECK_IDS.sensitiveFieldsInApiResponses]?.status, 'FAIL');
  assert.equal(results[PRIVACY_CHECK_IDS.logsContainingSecrets]?.status, 'FAIL');
  assert.equal(results[PRIVACY_CHECK_IDS.dataDeletion]?.status, 'FAIL');
  assert.equal(results[PRIVACY_CHECK_IDS.retention]?.status, 'PASS');
  assert.equal(results[PRIVACY_CHECK_IDS.export]?.status, 'PASS');
});

test('fixture token value does not appear in result reason (redaction path)', () => {
  const tokenFixture = 'token-fixture';
  // Even if a reason accidentally mentioned an assignment, redactSecrets must strip it.
  // Classification itself must not interpolate values — assert both.
  const results = runPrivacyChecks({
    enabled: true,
    evidence: {
      payloadKeys: ['token'],
      apiFields: ['accessToken'],
      logEntries: [{ key: 'refreshToken', valuePresent: true }],
    },
  });
  const blob = serializeResults(results);
  assert.equal(blob.includes(tokenFixture), false);
  for (const row of results) {
    assert.equal(reasonOf(row).includes(tokenFixture), false);
  }
});

test('legacy scanSensitiveKeys still FAIL on password key without echoing value', () => {
  const fail = scanSensitiveKeys({ password: 'token-fixture' });
  assert.equal(fail.status, 'FAIL');
  assert.ok(fail.exposed.some((p) => p.includes('password')));
  assert.equal(JSON.stringify(fail).includes('token-fixture'), false);
});

test('non-production deletion succeeded → PASS; hook not called', () => {
  const { called, hooks } = trackingHooks();
  const results = byId(
    runPrivacyChecks({
      enabled: true,
      environment: 'local',
      evidence: { deletionStatus: 'succeeded' },
      hooks,
    })
  );
  assert.equal(results[PRIVACY_CHECK_IDS.dataDeletion]?.status, 'PASS');
  assert.equal(called.delete, 0);
});

test('PR workflow file text does not contain test:privacy', () => {
  const workflowPath = path.join(ROOT, '.github', 'workflows', 'qa-automation.yml');
  const text = fs.readFileSync(workflowPath, 'utf8');
  assert.equal(text.includes('test:privacy'), false);
});

test('privacy source does not interpolate payload values into reasons; no delete/fetch side effects', () => {
  const source = fs.readFileSync(path.join(__dirname, 'privacy.ts'), 'utf8');
  // Reasons may include JSON.stringify(status) or field NAMES — never payload/log values.
  assert.equal(/\$\{[^}]*payload\.[^}]+\}/.test(source), false);
  assert.equal(/\$\{[^}]*entry\.value[^}]*\}/.test(source), false);
  assert.equal(/\$\{[^}]*child[^}]*\}/.test(source), false);
  assert.equal(/reason:[^\n]*\$\{[^}]*value[^}]*\}/.test(source), false);
  assert.equal(/fs\.unlink(?:Sync)?\s*\(/.test(source), false);
  assert.equal(/\bDELETE\s+FROM\b/i.test(source), false);
  assert.equal(/fetch\s*\(/.test(source), false);
  assert.equal(/http\.request\s*\(/.test(source), false);
});
