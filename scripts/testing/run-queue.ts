/**
 * Optional queue CLI. Loads config flag only — does not connect to a broker
 * or read hosts/secrets from qa.config.json.
 */

import { loadConfig } from '../lib/load-config';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { InMemoryQueueAdapter, runQueueChecks } from './capabilities/queue-flow';

async function main(): Promise<number> {
  const loaded = loadConfig();
  const enabled = loaded.tests?.queue?.enabled === true;

  logStep(
    enabled
      ? 'Queue checks enabled — classifying caller-supplied messages (none in config)'
      : 'Queue testing is not enabled for this application'
  );

  const results = await runQueueChecks({
    enabled,
    messages: [],
    adapter: new InMemoryQueueAdapter(),
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
    logError('Queue checks reported FAIL');
    return 1;
  }

  const blocked = results.some(
    (r) =>
      r.status === 'REQUIRES_CONFIGURATION' ||
      r.status === 'BLOCKED' ||
      r.status === 'NOT_TESTED'
  );
  if (blocked) {
    logWarn('Queue checks need configuration or evidence — see statuses above');
  } else if (!enabled) {
    logSuccess('Queue: NOT_APPLICABLE (disabled)');
  } else {
    logSuccess('Queue checks completed');
  }

  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

export { main };
