/**
 * Optional multi-tenant CLI. Loads config flag only — does not invent tenants
 * or call a live API. Caller-supplied identities are not read from qa.config.json.
 */

import { loadConfig } from '../lib/load-config';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { runMultiTenantChecks } from './capabilities/multi-tenant';

function main(): number {
  const loaded = loadConfig();
  const enabled = loaded.tests?.multiTenant?.enabled === true;

  logStep(
    enabled
      ? 'Multi-tenant checks enabled — requiring caller-supplied identities (none in config)'
      : 'Multi-tenant testing is not enabled for this application'
  );

  const results = runMultiTenantChecks({ enabled });
  for (const row of results) {
    const reason =
      typeof row.metadata?.reason === 'string'
        ? row.metadata.reason
        : row.error?.message ?? '';
    logStep(`${row.id}: ${row.status}${reason ? ` — ${reason}` : ''}`);
  }

  const failed = results.some((r) => r.status === 'FAIL');
  if (failed) {
    logError('Multi-tenant checks reported FAIL');
    return 1;
  }

  const blocked = results.some(
    (r) =>
      r.status === 'REQUIRES_CONFIGURATION' ||
      r.status === 'BLOCKED' ||
      r.status === 'NOT_TESTED'
  );
  if (blocked) {
    logWarn('Multi-tenant checks need configuration or evidence — see statuses above');
  } else if (!enabled) {
    logSuccess('Multi-tenant: NOT_APPLICABLE (disabled)');
  } else {
    logSuccess('Multi-tenant checks completed');
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

export { main };
