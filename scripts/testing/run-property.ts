/**
 * Optional property CLI. Loads config flag only — sample adapter only;
 * does not install or require fast-check.
 */

import { loadConfig } from '../lib/load-config';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { BuiltinSampleAdapter, runPropertyChecks } from './property';

async function main(): Promise<number> {
  const loaded = loadConfig();
  const enabled = loaded.tests?.property?.enabled === true;

  logStep(
    enabled
      ? 'Property checks enabled — evaluating caller-supplied samples via builtin adapter'
      : 'Property-based testing is not enabled for this application'
  );

  const results = await runPropertyChecks({
    enabled,
    adapter: new BuiltinSampleAdapter(),
    properties: [],
  });
  for (const row of results) {
    logStep(`${row.name}: ${row.status} — ${row.reason}`);
  }

  const failed = results.some((r) => r.status === 'FAIL');
  if (failed) {
    logError('Property checks reported FAIL');
    return 1;
  }

  const blocked = results.some(
    (r) => r.status === 'BLOCKED' || r.status === 'NOT_TESTED'
  );
  if (blocked) {
    logWarn('Property checks need configuration or samples — see statuses above');
  } else if (!enabled) {
    logSuccess('Property: NOT_APPLICABLE (disabled)');
  } else {
    logSuccess('Property checks completed');
  }

  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

export { main };
