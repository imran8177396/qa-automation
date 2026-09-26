/**
 * Optional mutation CLI. Loads config flag only — in-memory snippets;
 * does not rewrite project files or re-run the suite.
 */

import { loadConfig } from '../lib/load-config';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { runMutationChecks } from './mutation';

async function main(): Promise<number> {
  const loaded = loadConfig();
  const enabled = loaded.tests?.mutation?.enabled === true;

  logStep(
    enabled
      ? 'Mutation checks enabled — classifying caller-supplied in-memory mutants only'
      : 'Mutation testing is not enabled for this application'
  );

  const report = runMutationChecks({
    enabled,
    cases: [],
    runSuite: false,
  });

  logStep(
    `mutation: generated=${report.generated} killed=${report.killed} survived=${report.survived} score=${report.score === null ? 'null' : report.score} status=${report.status} — ${report.reason}`
  );

  if (report.status === 'FAIL') {
    logError('Mutation checks reported FAIL');
    return 1;
  }

  if (report.status === 'BLOCKED' || report.status === 'NOT_TESTED') {
    logWarn('Mutation checks need configuration or detection — see status above');
  } else if (!enabled) {
    logSuccess('Mutation: NOT_APPLICABLE (disabled)');
  } else {
    logSuccess('Mutation checks completed');
  }

  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

export { main };
