import { resolveSafetyConfig } from '../core/safety-policy';
import { readJsonIfExists, writeJson } from '../discovery/write-json';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';
import type { ApiInventory } from '../discovery/api-observe';
import type { WorkflowInventory } from '../discovery/workflows';
import { loadConfig } from '../lib/load-config';
import { PATHS } from '../lib/paths';
import { logError, logStep, logSuccess } from '../lib/logger';
import { generateUiChecks } from '../planning/generate-ui-checks';
import { buildDiscoveryInventory } from './discovery-inventory';

function main(): void {
  logStep('Inventory generation — classify, plan, generate');
  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const api = readJsonIfExists<ApiInventory>(PATHS.apiInventoryFile);
  const workflows = readJsonIfExists<WorkflowInventory>(PATHS.workflowInventoryFile);

  if (!pageMap) {
    logError(`Missing ${PATHS.pageMapFile}. Run discovery first.`);
    process.exit(1);
  }
  if (!ui) {
    logError(`Missing ${PATHS.uiInventoryFile}. Run discovery first.`);
    process.exit(1);
  }

  const config = loadConfig();
  const safety = resolveSafetyConfig(config.safety);
  const inventory = buildDiscoveryInventory(pageMap, ui, safety);
  writeJson(PATHS.inventoryFile, inventory);

  const checks = generateUiChecks(pageMap, ui, safety);
  writeJson(PATHS.plannedChecksFile, checks);
  writeJson(PATHS.uiChecksFile, checks);

  const planned = checks.filter((check) => check.status === 'PLANNED').length;
  console.log(`Pages            ${pageMap.pages.length}`);
  console.log(`Routes           ${pageMap.routes.length}`);
  console.log(`UI elements      ${ui.elements.length}`);
  console.log(`Observed APIs    ${api?.calls.length ?? 0}`);
  console.log(`Workflows        ${workflows?.workflows.length ?? 0}`);
  console.log(`Planned checks   ${planned} runnable / ${checks.length} total`);
  logSuccess(`Wrote ${PATHS.inventoryFile}`);
  logSuccess(`Wrote ${PATHS.plannedChecksFile}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
}
