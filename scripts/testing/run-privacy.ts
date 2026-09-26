/**
 * Optional privacy CLI. Loads config flag only — caller evidence classification;
 * does not scan live APIs, delete data, enforce retention, write exports, or hit HTTP.
 */

import { loadConfig } from '../lib/load-config';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { runPrivacyChecks } from './capabilities/privacy';

async function main(): Promise<number> {
  const loaded = loadConfig();
  const enabled = loaded.tests?.privacy?.enabled === true;

  logStep(
    enabled
      ? 'Privacy checks enabled — classifying caller-supplied evidence only (none in config)'
      : 'Privacy testing is not enabled for this application'
  );

  const results = runPrivacyChecks({
    enabled,
    // Config never invents payload keys, log entries, or deletion/export evidence.
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
    logError('Privacy checks reported FAIL');
    return 1;
  }

  const blocked = results.some(
    (r) =>
      r.status === 'REQUIRES_CONFIGURATION' ||
      r.status === 'BLOCKED' ||
      r.status === 'NOT_TESTED'
  );
  if (blocked) {
    logWarn('Privacy checks need caller-supplied evidence — see statuses above');
  } else if (!enabled) {
    logSuccess('Privacy: NOT_APPLICABLE (disabled)');
  } else {
    logSuccess('Privacy checks completed');
  }

  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

export { main };
