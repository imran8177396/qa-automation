/**
 * Optional backup/restore CLI. Loads config flag only — caller evidence classification;
 * does not take backups, restore databases, delete data, open sockets, or hit HTTP.
 */

import { loadConfig } from '../lib/load-config';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { runBackupRestoreChecks } from './capabilities/backup-restore';

async function main(): Promise<number> {
  const loaded = loadConfig();
  const enabled = loaded.tests?.backupRestore?.enabled === true;

  logStep(
    enabled
      ? 'Backup/restore checks enabled — classifying caller-supplied evidence only (none in config)'
      : 'Backup/restore testing is not enabled for this application'
  );

  const results = runBackupRestoreChecks({
    enabled,
    // Config never invents environment, isolated targets, or evidence.
  });

  for (const row of results) {
    const reason =
      typeof row.metadata?.reason === 'string'
        ? row.metadata.reason
        : row.error?.message ?? '';
    logStep(`${row.id}: ${row.status}${reason ? ` — ${reason}` : ''}`);
  }

  const failed = results.some((r) => r.status === 'FAIL');
  if (failed) {
    logError('Backup/restore checks reported FAIL');
    return 1;
  }

  const blocked = results.some(
    (r) =>
      r.status === 'REQUIRES_CONFIGURATION' ||
      r.status === 'BLOCKED' ||
      r.status === 'NOT_TESTED'
  );
  if (blocked) {
    logWarn('Backup/restore checks need isolated env + target + evidence — see statuses above');
  } else if (!enabled) {
    logSuccess('Backup/restore: NOT_APPLICABLE (disabled)');
  } else {
    logSuccess('Backup/restore checks completed');
  }

  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

export { main };
