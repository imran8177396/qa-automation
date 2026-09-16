import { loadConfig } from './lib/load-config';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { resolveSafetyConfig } from './core/safety-policy';
import { writePlannedUiChecks } from './planning/write-planned-checks';
import { readJsonIfExists } from './discovery/write-json';
import { runPlaywright } from './runners/playwright';
import { DEFAULT_FIXTURE_PORT, ensureFixtureChildProcess } from './testing/serve-fixture-site';
import { printCoverageSummary, runCoverage } from './coverage/run-coverage';
import { isLoopbackUrl } from './orchestrator/resolve-url';
import type { PageMap } from './discovery/page-map';
import type { UiInventory } from './discovery/ui-scan';

async function ensureLocalTarget(seedUrl: string): Promise<{ url: string; close: () => Promise<void> } | null> {
  if (!isLoopbackUrl(seedUrl)) return null;
  const port = Number(new URL(seedUrl).port || DEFAULT_FIXTURE_PORT);
  const server = await ensureFixtureChildProcess(port);
  if (server) logSuccess(`Fixture site listening at ${server.url} (child process)`);
  else logWarn(`Fixture port ${port} already in use — assuming the discovered site is running`);
  return server;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);

  if (!pageMap || !ui) {
    throw new Error('Discovery inventories not found. Run `npm run discover -- <url>` first.');
  }

  logStep('Planning applicable UI checks from discovery');
  const checks = writePlannedUiChecks(pageMap, ui, resolveSafetyConfig(config.safety));

  const planned = checks.filter((check) => check.status === 'PLANNED').length;
  const gated = checks.length - planned;
  logSuccess(`Planned ${checks.length} check(s) — ${planned} runnable, ${gated} not executed (safety/config/blocked)`);

  const server = await ensureLocalTarget(pageMap.seedUrl);
  let playwrightPassed = false;
  try {
    logStep('Executing generated UI checks');
    playwrightPassed = await runPlaywright(config, { suiteName: 'generated-check', grep: '@generated' });
  } finally {
    if (server) await server.close();
  }

  if (playwrightPassed) logSuccess('Generated UI checks passed');
  else logError('Generated UI checks reported failures — see Playwright results (not hidden)');

  logStep('Updating coverage from execution evidence');
  const report = runCoverage();
  printCoverageSummary(report);

  if (!playwrightPassed) process.exit(1);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
