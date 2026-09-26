/**
 * Optional race CLI. Loads config flag only — in-memory deterministic model;
 * does not start live concurrency, HTTP, database, or payment providers.
 */

import { loadConfig } from '../lib/load-config';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { runRaceChecks } from './capabilities/race';

async function main(): Promise<number> {
  const loaded = loadConfig();
  const enabled = loaded.tests?.race?.enabled === true;

  logStep(
    enabled
      ? 'Race checks enabled — classifying caller-supplied interleavings only (none in config)'
      : 'Race testing is not enabled for this application'
  );

  const results = runRaceChecks({
    enabled,
    // Config never invents interleavings — callers supply scenario bodies at runtime.
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
    logError('Race checks reported FAIL');
    return 1;
  }

  const blocked = results.some(
    (r) =>
      r.status === 'REQUIRES_CONFIGURATION' ||
      r.status === 'BLOCKED' ||
      r.status === 'NOT_TESTED'
  );
  if (blocked) {
    logWarn('Race checks need a caller-supplied interleaving — see statuses above');
  } else if (!enabled) {
    logSuccess('Race: NOT_APPLICABLE (disabled)');
  } else {
    logSuccess('Race checks completed');
  }

  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

export { main };
