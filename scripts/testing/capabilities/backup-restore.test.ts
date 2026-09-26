/**
 * Deterministic unit tests for evidence-only backup/restore checks.
 * No filesystem delete, no restore commands, no SQL, no HTTP, no DB.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../../lib/paths';
import {
  BACKUP_RESTORE_CHECK_IDS,
  firstDifferingPath,
  planBackupRestore,
  runBackupRestoreChecks,
} from './backup-restore';

function byId(results: ReturnType<typeof runBackupRestoreChecks>) {
  return Object.fromEntries(results.map((r) => [r.id, r]));
}

function reasonOf(row: { metadata?: Record<string, unknown>; error?: { message?: string } }): string {
  return String(row.metadata?.reason ?? row.error?.message ?? '');
}

function trackingHooks() {
  const called = { prepare: 0, restore: 0, delete: 0 };
  return {
    called,
    hooks: {
      prepare: () => {
        called.prepare += 1;
      },
      restore: () => {
        called.restore += 1;
      },
      delete: () => {
        called.delete += 1;
      },
    },
  };
}

test('planBackupRestore remains NOT_IMPLEMENTED for live backup/restore', () => {
  const plan = planBackupRestore();
  assert.equal(plan.status, 'NOT_IMPLEMENTED');
  assert.match(plan.reason, /not executed/i);
  assert.match(plan.reason, /never deleted/i);
});

test('disabled → NOT_APPLICABLE backup-restore:not-enabled', () => {
  const results = runBackupRestoreChecks({ enabled: false });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, BACKUP_RESTORE_CHECK_IDS.notEnabled);
  assert.equal(results[0]?.status, 'NOT_APPLICABLE');
  assert.match(reasonOf(results[0]!), /not enabled/i);
});

test('production environment → every check BLOCKED; hooks never called', () => {
  const { called, hooks } = trackingHooks();
  const results = runBackupRestoreChecks({
    enabled: true,
    environment: 'production',
    isolatedTarget: { label: 'must-not-matter' },
    evidence: {
      backupArtifactId: 'backup-1',
      readable: true,
      restoreStatus: 'succeeded',
      expectedSnapshot: { a: 1 },
      actualSnapshot: { a: 1 },
      reconnect: true,
    },
    hooks,
  });
  assert.equal(results.length, 5);
  for (const row of results) {
    assert.equal(row.status, 'BLOCKED', row.id);
    assert.match(reasonOf(row), /production data is never deleted/i);
  }
  assert.equal(called.prepare, 0);
  assert.equal(called.restore, 0);
  assert.equal(called.delete, 0);
});

test('missing environment → REQUIRES_CONFIGURATION', () => {
  const results = runBackupRestoreChecks({ enabled: true });
  assert.ok(results.length >= 1);
  for (const row of results) {
    assert.equal(row.status, 'REQUIRES_CONFIGURATION', row.id);
    assert.match(reasonOf(row), /environment/i);
  }
});

test('isolated env without target descriptor → REQUIRES_CONFIGURATION', () => {
  const results = runBackupRestoreChecks({
    enabled: true,
    environment: 'local',
  });
  for (const row of results) {
    assert.equal(row.status, 'REQUIRES_CONFIGURATION', row.id);
    assert.match(reasonOf(row), /isolated target/i);
  }
});

test('missing evidence → NOT_TESTED for each check', () => {
  const results = byId(
    runBackupRestoreChecks({
      enabled: true,
      environment: 'development',
      isolatedTarget: { label: 'fixture-isolated-1' },
    })
  );
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.backupExists]?.status, 'NOT_TESTED');
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.backupReadable]?.status, 'NOT_TESTED');
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.restoreSucceeds]?.status, 'NOT_TESTED');
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.restoredDataConsistent]?.status, 'NOT_TESTED');
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.applicationCanReconnect]?.status, 'NOT_TESTED');
  for (const id of Object.values(BACKUP_RESTORE_CHECK_IDS).filter(
    (x) => x !== BACKUP_RESTORE_CHECK_IDS.notEnabled && x !== BACKUP_RESTORE_CHECK_IDS.cleanupRefused
  )) {
    assert.match(reasonOf(results[id]!), /./);
  }
});

test('all five evidences good on local → PASS', () => {
  const results = byId(
    runBackupRestoreChecks({
      enabled: true,
      environment: 'local',
      isolatedTarget: { label: 'local-fixture-db' },
      evidence: {
        backupArtifactId: 'artifact-label-1',
        readable: true,
        restoreStatus: 'succeeded',
        expectedSnapshot: { rows: [{ id: 1, name: 'a' }], count: 1 },
        actualSnapshot: { rows: [{ id: 1, name: 'a' }], count: 1 },
        reconnect: true,
      },
    })
  );
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.backupExists]?.status, 'PASS');
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.backupReadable]?.status, 'PASS');
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.restoreSucceeds]?.status, 'PASS');
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.restoredDataConsistent]?.status, 'PASS');
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.applicationCanReconnect]?.status, 'PASS');
});

test('backupExists false → FAIL; snapshot mismatch → FAIL with path', () => {
  const results = byId(
    runBackupRestoreChecks({
      enabled: true,
      environment: 'staging',
      isolatedTarget: { label: 'staging-sandbox' },
      evidence: {
        backupExists: false,
        readable: false,
        restoreStatus: 'failed',
        expectedSnapshot: { user: { id: 1 } },
        actualSnapshot: { user: { id: 2 } },
        reconnect: false,
      },
    })
  );
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.backupExists]?.status, 'FAIL');
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.backupReadable]?.status, 'FAIL');
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.restoreSucceeds]?.status, 'FAIL');
  assert.match(reasonOf(results[BACKUP_RESTORE_CHECK_IDS.restoreSucceeds]!), /failed/);
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.restoredDataConsistent]?.status, 'FAIL');
  assert.match(reasonOf(results[BACKUP_RESTORE_CHECK_IDS.restoredDataConsistent]!), /\$\.user\.id/);
  assert.equal(results[BACKUP_RESTORE_CHECK_IDS.applicationCanReconnect]?.status, 'FAIL');
});

test('cleanup / deleteProduction → BLOCKED; hooks never called', () => {
  const { called, hooks } = trackingHooks();
  const cleanup = runBackupRestoreChecks({
    enabled: true,
    environment: 'local',
    isolatedTarget: { label: 'local-fixture' },
    cleanup: true,
    hooks,
  });
  assert.equal(cleanup.length, 1);
  assert.equal(cleanup[0]?.id, BACKUP_RESTORE_CHECK_IDS.cleanupRefused);
  assert.equal(cleanup[0]?.status, 'BLOCKED');
  assert.match(reasonOf(cleanup[0]!), /never automatically deleted/i);

  const del = runBackupRestoreChecks({
    enabled: true,
    environment: 'development',
    isolatedTarget: { label: 'dev-fixture' },
    deleteProduction: true,
    hooks,
  });
  assert.equal(del[0]?.status, 'BLOCKED');
  assert.match(reasonOf(del[0]!), /never automatically deleted/i);

  assert.equal(called.prepare, 0);
  assert.equal(called.restore, 0);
  assert.equal(called.delete, 0);
});

test('firstDifferingPath reports nested mismatch', () => {
  assert.equal(firstDifferingPath({ a: 1 }, { a: 1 }), null);
  assert.equal(firstDifferingPath({ a: { b: 1 } }, { a: { b: 2 } }), '$.a.b');
});

test('PR workflow file text does not contain test:backup-restore', () => {
  const workflowPath = path.join(ROOT, '.github', 'workflows', 'qa-automation.yml');
  const text = fs.readFileSync(workflowPath, 'utf8');
  assert.equal(text.includes('test:backup-restore'), false);
});

test('source has no unlink, rm, DROP, or deleteFile side effects', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backup-restore.ts'), 'utf8');
  assert.equal(/fs\.unlink(?:Sync)?\s*\(/.test(source), false);
  assert.equal(/fs\.rm(?:Sync)?\s*\(/.test(source), false);
  assert.equal(/\bunlinkSync\s*\(/.test(source), false);
  assert.equal(/\bdeleteFile\s*\(/.test(source), false);
  assert.equal(/\bDROP\s+TABLE\b/i.test(source), false);
  assert.equal(/\bDELETE\s+FROM\b/i.test(source), false);
  assert.equal(/Date\.now\s*\(/.test(source), false);
});
