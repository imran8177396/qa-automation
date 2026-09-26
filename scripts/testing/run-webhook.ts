/**
 * Optional webhook CLI. Loads config flag only — does not open a port,
 * call a webhook URL, or read secrets from qa.config.json.
 */

import { loadConfig } from '../lib/load-config';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { runWebhookChecks } from './capabilities/webhook';

function main(): number {
  const loaded = loadConfig();
  const enabled = loaded.tests?.webhook?.enabled === true;

  logStep(
    enabled
      ? 'Webhook checks enabled — requiring caller-supplied deliveries (none in config)'
      : 'Webhook testing is not enabled for this application'
  );

  const results = runWebhookChecks({ enabled, deliveries: [] });
  for (const row of results) {
    const reason =
      typeof row.metadata?.reason === 'string'
        ? row.metadata.reason
        : row.error?.message ?? '';
    logStep(`${row.id}: ${row.status}${reason ? ` — ${reason}` : ''}`);
  }

  const failed = results.some((r) => r.status === 'FAIL');
  if (failed) {
    logError('Webhook checks reported FAIL');
    return 1;
  }

  const blocked = results.some(
    (r) =>
      r.status === 'REQUIRES_CONFIGURATION' ||
      r.status === 'BLOCKED' ||
      r.status === 'NOT_TESTED'
  );
  if (blocked) {
    logWarn('Webhook checks need configuration or evidence — see statuses above');
  } else if (!enabled) {
    logSuccess('Webhook: NOT_APPLICABLE (disabled)');
  } else {
    logSuccess('Webhook checks completed');
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

export { main };
