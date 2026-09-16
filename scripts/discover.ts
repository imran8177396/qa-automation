import { PATHS } from './lib/paths';
import { loadConfig } from './lib/load-config';
import { loadRuntimeEnv } from './lib/load-runtime-env';
import { logStep, logSuccess } from './lib/logger';
import { resolveDiscoverUrl } from './discovery/cli';
import { runFullDiscovery } from './discovery/run-discover';
import { mergeCategoryStatus } from './discovery/categories';
import { resolveSafetyConfig } from './core/safety-policy';
import { writePlannedUiChecks } from './planning/write-planned-checks';

async function main(): Promise<void> {
  loadRuntimeEnv();
  const { url, maxPages } = resolveDiscoverUrl();
  logStep(`Application discovery — ${url}`);

  const result = await runFullDiscovery(url, maxPages);

  logStep('Discovery summary');
  const allStatus = mergeCategoryStatus([
    ...result.pageMap.categoryStatus,
    ...result.ui.categoryStatus,
    ...result.workflows.categoryStatus,
    ...result.api.categoryStatus,
  ]);

  for (const row of allStatus) {
    const extra = row.reason ? ` — ${row.reason}` : '';
    console.log(`${row.category.padEnd(18)} ${row.status.padEnd(16)} ${row.count}${extra}`);
  }

  logStep('Planning applicable UI checks from discovery');
  const config = loadConfig();
  const checks = writePlannedUiChecks(result.pageMap, result.ui, resolveSafetyConfig(config.safety));
  const planned = checks.filter((check) => check.status === 'PLANNED').length;

  logSuccess(`page-map.json            ${PATHS.pageMapFile}`);
  logSuccess(`ui-inventory.json        ${PATHS.uiInventoryFile}`);
  logSuccess(`workflow-inventory.json  ${PATHS.workflowInventoryFile}`);
  logSuccess(`api-inventory.json       ${PATHS.apiInventoryFile}`);
  logSuccess(`planned-checks.json      ${PATHS.plannedChecksFile} (${planned} runnable / ${checks.length} total)`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
