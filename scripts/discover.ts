import { PATHS } from './lib/paths';
import { logStep, logSuccess } from './lib/logger';
import { resolveDiscoverUrl } from './discovery/cli';
import { runFullDiscovery } from './discovery/run-discover';
import { mergeCategoryStatus } from './discovery/categories';

async function main(): Promise<void> {
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

  logSuccess(`page-map.json            ${PATHS.pageMapFile}`);
  logSuccess(`ui-inventory.json        ${PATHS.uiInventoryFile}`);
  logSuccess(`workflow-inventory.json  ${PATHS.workflowInventoryFile}`);
  logSuccess(`api-inventory.json       ${PATHS.apiInventoryFile}`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
