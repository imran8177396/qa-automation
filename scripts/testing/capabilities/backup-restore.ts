/**
 * Optional backup/restore infrastructure checks (PARTIAL).
 *
 * Honest limits:
 * - Does not take a backup
 * - Does not restore a database
 * - Does not prove a production backup is valid
 * - Does not delete data (production data is never automatically deleted)
 * - Live backup/restore is not executed — caller-supplied evidence only
 *
 * No filesystem delete, no shell rm, no SQL DROP/DELETE, no HTTP, no DB sockets.
 * Isolated environments do not authorize deletion either.
 */

import {
  makeResult,
  type EngineResultStatus,
  type TestResult,
} from '../../core/engine-contract';
import {
  QA_ENVIRONMENT_NAMES,
  type QaEnvironmentName,
} from '../../core/platform/environment';

/** Live backup/restore against a real store stays refused. */
export interface BackupRestorePlan {
  status: 'NOT_IMPLEMENTED';
  reason: string;
}

const LIVE_BACKUP_RESTORE_REASON =
  'live backup and restore is not executed; does not take a backup, restore a database, or prove a production backup is valid; production data is never deleted';

/**
 * Refuse executing real backup/restore/delete against a target.
 * Evidence-only checks live in runBackupRestoreChecks().
 */
export function planBackupRestore(): BackupRestorePlan {
  return { status: 'NOT_IMPLEMENTED', reason: LIVE_BACKUP_RESTORE_REASON };
}

/** Environments where restore evidence may be classified (never production). */
export const ISOLATED_BACKUP_ENVIRONMENTS = ['local', 'development', 'staging'] as const;

export type IsolatedBackupEnvironment = (typeof ISOLATED_BACKUP_ENVIRONMENTS)[number];

/**
 * Explicit isolated target descriptor — caller must supply; never invent from
 * urls.website or qa.last-target.json.
 */
export interface IsolatedTargetDescriptor {
  /** Non-empty label identifying the isolated target (fixture id, host label, etc.). */
  label: string;
}

/**
 * Caller-supplied evidence only. No disk reads, no restore commands, no reconnect probes.
 */
export interface BackupRestoreEvidence {
  /**
   * Non-empty backup artifact id / path label.
   * PASS for backup-exists only when this is a non-empty string (and not explicitly false).
   */
  backupArtifactId?: string;
  /**
   * Explicit false → FAIL for backup-exists.
   * True alone without a non-empty artifact id does not PASS.
   */
  backupExists?: boolean;
  /** true → PASS readable; false → FAIL; missing → NOT_TESTED. */
  readable?: boolean;
  /**
   * 'succeeded' on an isolated env → PASS restore-succeeds.
   * Any other explicit string → FAIL with that status in the reason.
   * Missing → NOT_TESTED.
   */
  restoreStatus?: string;
  /** Plain JSON-serializable records for deep equality — no app-specific schemas. */
  expectedSnapshot?: Record<string, unknown>;
  actualSnapshot?: Record<string, unknown>;
  /** true → PASS reconnect; false → FAIL; missing → NOT_TESTED. */
  reconnect?: boolean;
}

/**
 * Optional hooks for unit tests — must never be invoked by this module.
 * There is no delete/cleanup implementation; production data is never automatically deleted.
 */
export interface BackupRestoreHooks {
  prepare?: () => void;
  restore?: () => void;
  delete?: () => void;
}

export interface RunBackupRestoreChecksInput {
  enabled: boolean;
  /** Environment name. production → every check BLOCKED. */
  environment?: string;
  /** Required for isolated envs — do not invent. */
  isolatedTarget?: IsolatedTargetDescriptor;
  evidence?: BackupRestoreEvidence;
  /**
   * When true, record BLOCKED — production data is never automatically deleted.
   * Isolated environments do not authorize deletion either. No unlink/SQL/rm.
   */
  cleanup?: boolean;
  /** When true, record BLOCKED — production data is never automatically deleted. */
  deleteProduction?: boolean;
  /** Optional; if present they must not be called. */
  hooks?: BackupRestoreHooks;
}

export const BACKUP_RESTORE_CHECK_IDS = {
  notEnabled: 'backup-restore:not-enabled',
  cleanupRefused: 'backup-restore:cleanup-refused',
  backupExists: 'backup-restore:backup-exists',
  backupReadable: 'backup-restore:backup-readable',
  restoreSucceeds: 'backup-restore:restore-succeeds',
  restoredDataConsistent: 'backup-restore:restored-data-consistent',
  applicationCanReconnect: 'backup-restore:application-can-reconnect',
} as const;

const TEST_TYPE = 'backup-restore';
const CATEGORY = 'specialized';

const LIMITS_NOTE =
  'caller evidence only — does not take a backup, restore a database, prove a production backup is valid, or delete data; live backup/restore is not executed';

const PRODUCTION_BLOCK_REASON =
  'production data is never deleted and restore is not run; live backup/restore is not executed';

const CLEANUP_BLOCK_REASON =
  'production data is never automatically deleted; cleanup/delete is not implemented in any environment; no unlink, rm, or SQL DROP/DELETE';

function isQaEnvironmentName(value: string): value is QaEnvironmentName {
  return (QA_ENVIRONMENT_NAMES as readonly string[]).includes(value);
}

function isIsolatedEnvironment(value: string): value is IsolatedBackupEnvironment {
  return (ISOLATED_BACKUP_ENVIRONMENTS as readonly string[]).includes(value);
}

function backupResult(
  id: string,
  name: string,
  status: EngineResultStatus,
  options: {
    reason?: string;
    assertion?: { expected?: unknown; actual?: unknown };
    metadata?: Record<string, unknown>;
  } = {}
): TestResult {
  const reason = options.reason;
  return makeResult({
    id,
    testType: TEST_TYPE,
    category: CATEGORY,
    name,
    status,
    ...(options.assertion ? { assertion: options.assertion } : {}),
    ...(reason
      ? { error: { message: reason }, metadata: { ...(options.metadata ?? {}), reason } }
      : options.metadata
        ? { metadata: options.metadata }
        : {}),
  });
}

function blockedAllFive(reason: string, metadata: Record<string, unknown> = {}): TestResult[] {
  return [
    backupResult(BACKUP_RESTORE_CHECK_IDS.backupExists, 'Backup exists', 'BLOCKED', {
      reason,
      metadata,
    }),
    backupResult(BACKUP_RESTORE_CHECK_IDS.backupReadable, 'Backup readable', 'BLOCKED', {
      reason,
      metadata,
    }),
    backupResult(BACKUP_RESTORE_CHECK_IDS.restoreSucceeds, 'Restore succeeds', 'BLOCKED', {
      reason,
      metadata,
    }),
    backupResult(
      BACKUP_RESTORE_CHECK_IDS.restoredDataConsistent,
      'Restored data consistent',
      'BLOCKED',
      { reason, metadata }
    ),
    backupResult(
      BACKUP_RESTORE_CHECK_IDS.applicationCanReconnect,
      'Application can reconnect',
      'BLOCKED',
      { reason, metadata }
    ),
  ];
}

function configAllFive(reason: string, metadata: Record<string, unknown> = {}): TestResult[] {
  return [
    backupResult(BACKUP_RESTORE_CHECK_IDS.backupExists, 'Backup exists', 'REQUIRES_CONFIGURATION', {
      reason,
      metadata,
    }),
    backupResult(BACKUP_RESTORE_CHECK_IDS.backupReadable, 'Backup readable', 'REQUIRES_CONFIGURATION', {
      reason,
      metadata,
    }),
    backupResult(BACKUP_RESTORE_CHECK_IDS.restoreSucceeds, 'Restore succeeds', 'REQUIRES_CONFIGURATION', {
      reason,
      metadata,
    }),
    backupResult(
      BACKUP_RESTORE_CHECK_IDS.restoredDataConsistent,
      'Restored data consistent',
      'REQUIRES_CONFIGURATION',
      { reason, metadata }
    ),
    backupResult(
      BACKUP_RESTORE_CHECK_IDS.applicationCanReconnect,
      'Application can reconnect',
      'REQUIRES_CONFIGURATION',
      { reason, metadata }
    ),
  ];
}

/**
 * First differing JSON path (dot/bracket notation). Returns null when deeply equal.
 * Plain JSON-serializable values only — no invented app schemas.
 */
export function firstDifferingPath(expected: unknown, actual: unknown, path = '$'): string | null {
  if (Object.is(expected, actual)) return null;

  const expType = expected === null ? 'null' : Array.isArray(expected) ? 'array' : typeof expected;
  const actType = actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual;

  if (expType !== actType) {
    return path;
  }

  if (expType !== 'object' && expType !== 'array') {
    return path;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const len = Math.max(expected.length, actual.length);
    for (let i = 0; i < len; i += 1) {
      if (i >= expected.length || i >= actual.length) {
        return `${path}[${i}]`;
      }
      const child = firstDifferingPath(expected[i], actual[i], `${path}[${i}]`);
      if (child !== null) return child;
    }
    return null;
  }

  const expObj = expected as Record<string, unknown>;
  const actObj = actual as Record<string, unknown>;
  const keys = new Set([...Object.keys(expObj), ...Object.keys(actObj)]);
  const sorted = [...keys].sort();
  for (const key of sorted) {
    const childPath = path === '$' ? `$.${key}` : `${path}.${key}`;
    if (!(key in expObj) || !(key in actObj)) {
      return childPath;
    }
    const child = firstDifferingPath(expObj[key], actObj[key], childPath);
    if (child !== null) return child;
  }
  return null;
}

function checkBackupExists(
  evidence: BackupRestoreEvidence | undefined,
  meta: Record<string, unknown>
): TestResult {
  if (evidence?.backupExists === false) {
    return backupResult(BACKUP_RESTORE_CHECK_IDS.backupExists, 'Backup exists', 'FAIL', {
      reason: `backup evidence reports backupExists=false; ${LIMITS_NOTE}`,
      assertion: { expected: true, actual: false },
      metadata: meta,
    });
  }

  const artifact =
    typeof evidence?.backupArtifactId === 'string' ? evidence.backupArtifactId.trim() : '';
  if (artifact.length > 0) {
    return backupResult(BACKUP_RESTORE_CHECK_IDS.backupExists, 'Backup exists', 'PASS', {
      reason: `backup artifact label present; ${LIMITS_NOTE}`,
      assertion: { expected: 'non-empty artifact label', actual: artifact },
      metadata: { ...meta, backupArtifactId: artifact },
    });
  }

  return backupResult(BACKUP_RESTORE_CHECK_IDS.backupExists, 'Backup exists', 'NOT_TESTED', {
    reason: `backup artifact id/path label was not supplied; ${LIMITS_NOTE}`,
    metadata: meta,
  });
}

function checkBackupReadable(
  evidence: BackupRestoreEvidence | undefined,
  meta: Record<string, unknown>
): TestResult {
  if (evidence?.readable === undefined) {
    return backupResult(BACKUP_RESTORE_CHECK_IDS.backupReadable, 'Backup readable', 'NOT_TESTED', {
      reason: `readable evidence was not supplied; files are not opened; ${LIMITS_NOTE}`,
      metadata: meta,
    });
  }
  if (evidence.readable === true) {
    return backupResult(BACKUP_RESTORE_CHECK_IDS.backupReadable, 'Backup readable', 'PASS', {
      reason: `caller evidence reports readable=true; files are not opened; ${LIMITS_NOTE}`,
      assertion: { expected: true, actual: true },
      metadata: meta,
    });
  }
  return backupResult(BACKUP_RESTORE_CHECK_IDS.backupReadable, 'Backup readable', 'FAIL', {
    reason: `caller evidence reports readable=false; ${LIMITS_NOTE}`,
    assertion: { expected: true, actual: false },
    metadata: meta,
  });
}

function checkRestoreSucceeds(
  evidence: BackupRestoreEvidence | undefined,
  environment: IsolatedBackupEnvironment,
  meta: Record<string, unknown>
): TestResult {
  const status = evidence?.restoreStatus;
  if (status === undefined || status === null || String(status).trim() === '') {
    return backupResult(BACKUP_RESTORE_CHECK_IDS.restoreSucceeds, 'Restore succeeds', 'NOT_TESTED', {
      reason: `restoreStatus evidence was not supplied; restore is never invoked; ${LIMITS_NOTE}`,
      metadata: meta,
    });
  }
  const normalized = String(status).trim();
  if (normalized === 'succeeded') {
    return backupResult(BACKUP_RESTORE_CHECK_IDS.restoreSucceeds, 'Restore succeeds', 'PASS', {
      reason: `caller evidence reports restoreStatus=succeeded on isolated environment ${environment}; restore is never invoked; ${LIMITS_NOTE}`,
      assertion: { expected: 'succeeded', actual: normalized },
      metadata: { ...meta, restoreStatus: normalized },
    });
  }
  return backupResult(BACKUP_RESTORE_CHECK_IDS.restoreSucceeds, 'Restore succeeds', 'FAIL', {
    reason: `caller evidence reports restoreStatus=${JSON.stringify(normalized)}; expected succeeded; restore is never invoked; ${LIMITS_NOTE}`,
    assertion: { expected: 'succeeded', actual: normalized },
    metadata: { ...meta, restoreStatus: normalized },
  });
}

function checkRestoredDataConsistent(
  evidence: BackupRestoreEvidence | undefined,
  meta: Record<string, unknown>
): TestResult {
  const expected = evidence?.expectedSnapshot;
  const actual = evidence?.actualSnapshot;
  if (expected === undefined || actual === undefined) {
    return backupResult(
      BACKUP_RESTORE_CHECK_IDS.restoredDataConsistent,
      'Restored data consistent',
      'NOT_TESTED',
      {
        reason: `expected and/or actual snapshot was not supplied; snapshots are not invented; ${LIMITS_NOTE}`,
        metadata: meta,
      }
    );
  }
  const diff = firstDifferingPath(expected, actual);
  if (diff === null) {
    return backupResult(
      BACKUP_RESTORE_CHECK_IDS.restoredDataConsistent,
      'Restored data consistent',
      'PASS',
      {
        reason: `expected and actual snapshots are deeply equal; ${LIMITS_NOTE}`,
        metadata: meta,
      }
    );
  }
  return backupResult(
    BACKUP_RESTORE_CHECK_IDS.restoredDataConsistent,
    'Restored data consistent',
    'FAIL',
    {
      reason: `snapshot mismatch at ${diff}; ${LIMITS_NOTE}`,
      assertion: { expected, actual },
      metadata: { ...meta, firstDifferingPath: diff },
    }
  );
}

function checkApplicationCanReconnect(
  evidence: BackupRestoreEvidence | undefined,
  environment: IsolatedBackupEnvironment,
  meta: Record<string, unknown>
): TestResult {
  if (evidence?.reconnect === undefined) {
    return backupResult(
      BACKUP_RESTORE_CHECK_IDS.applicationCanReconnect,
      'Application can reconnect',
      'NOT_TESTED',
      {
        reason: `reconnect evidence was not supplied; no socket or DB connection is opened; ${LIMITS_NOTE}`,
        metadata: meta,
      }
    );
  }
  if (evidence.reconnect === true) {
    return backupResult(
      BACKUP_RESTORE_CHECK_IDS.applicationCanReconnect,
      'Application can reconnect',
      'PASS',
      {
        reason: `caller evidence reports reconnect=true on isolated environment ${environment}; no socket or DB connection is opened; ${LIMITS_NOTE}`,
        assertion: { expected: true, actual: true },
        metadata: meta,
      }
    );
  }
  return backupResult(
    BACKUP_RESTORE_CHECK_IDS.applicationCanReconnect,
    'Application can reconnect',
    'FAIL',
    {
      reason: `caller evidence reports reconnect=false; ${LIMITS_NOTE}`,
      assertion: { expected: true, actual: false },
      metadata: meta,
    }
  );
}

/**
 * Optional backup/restore checks. Disabled → single NOT_APPLICABLE.
 * Production → every check BLOCKED (hooks never called).
 * Cleanup/delete requested → BLOCKED (production data is never automatically deleted).
 * Missing environment or isolated target → REQUIRES_CONFIGURATION.
 * Evidence-driven results only — no restore, delete, fs, SQL, or HTTP.
 */
export function runBackupRestoreChecks(input: RunBackupRestoreChecksInput): TestResult[] {
  if (input.enabled !== true) {
    return [
      backupResult(BACKUP_RESTORE_CHECK_IDS.notEnabled, 'Backup/restore testing', 'NOT_APPLICABLE', {
        reason:
          'backup/restore testing is not enabled for this application; live backup/restore is not executed; production data is never deleted',
      }),
    ];
  }

  // There is no delete/cleanup implementation. Isolated env does not authorize deletion either.
  // Production data is never automatically deleted.
  if (input.cleanup === true || input.deleteProduction === true) {
    return [
      backupResult(BACKUP_RESTORE_CHECK_IDS.cleanupRefused, 'Cleanup / delete refused', 'BLOCKED', {
        reason: CLEANUP_BLOCK_REASON,
        metadata: {
          cleanup: input.cleanup === true,
          deleteProduction: input.deleteProduction === true,
        },
      }),
    ];
  }

  const envRaw = typeof input.environment === 'string' ? input.environment.trim() : '';
  if (!envRaw) {
    return configAllFive(
      'environment name is required (local | development | staging | production); production is never a safe restore target; urls.website and qa.last-target.json are not used'
    );
  }

  if (!isQaEnvironmentName(envRaw)) {
    return configAllFive(
      `unknown environment ${JSON.stringify(envRaw)}; expected local | development | staging | production (REQUIRES_CONFIGURATION)`
    );
  }

  if (envRaw === 'production') {
    // prepare/restore/delete must not be called — hooks are intentionally unused.
    return blockedAllFive(PRODUCTION_BLOCK_REASON, { environment: 'production' });
  }

  if (!isIsolatedEnvironment(envRaw)) {
    return configAllFive(
      `environment ${JSON.stringify(envRaw)} is not an isolated backup/restore target`,
      { environment: envRaw }
    );
  }

  const targetLabel =
    typeof input.isolatedTarget?.label === 'string' ? input.isolatedTarget.label.trim() : '';
  if (!targetLabel) {
    return configAllFive(
      'isolated target descriptor (non-empty label) is required; do not invent hosts from urls.website or qa.last-target.json; production data is never deleted',
      { environment: envRaw }
    );
  }

  const evidence = input.evidence;
  const meta = { environment: envRaw, isolatedTarget: targetLabel };

  // hooks (prepare/restore/delete) are intentionally never called — no restore, no delete.
  return [
    checkBackupExists(evidence, meta),
    checkBackupReadable(evidence, meta),
    checkRestoreSucceeds(evidence, envRaw, meta),
    checkRestoredDataConsistent(evidence, meta),
    checkApplicationCanReconnect(evidence, envRaw, meta),
  ];
}
