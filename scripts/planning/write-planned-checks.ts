import { resolveSafetyConfig } from '../core/safety-policy';
import { readJsonIfExists, writeJson } from '../discovery/write-json';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';
import { loadConfig } from '../lib/load-config';
import { PATHS } from '../lib/paths';
import { logError, logStep, logSuccess } from '../lib/logger';
import { generateUiChecks } from './generate-ui-checks';
import type { PlannedCheck } from './types';
import type { SafetyConfigResolved } from '../core/safety-policy';

export function writePlannedUiChecks(
  pageMap: PageMap,
  ui: UiInventory,
  safety: SafetyConfigResolved
): PlannedCheck[] {
  const checks = generateUiChecks(pageMap, ui, safety);
  writeJson(PATHS.plannedChecksFile, checks);
  writeJson(PATHS.uiChecksFile, checks);
  return checks;
}

function main(): void {
  logStep('Planning UI checks from current discovery inventories');
  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  if (!pageMap || !ui) {
    logError('Discovery inventories not found. Run `npm run discover -- <url>` first.');
    process.exit(1);
  }
  const config = loadConfig();
  const checks = writePlannedUiChecks(pageMap, ui, resolveSafetyConfig(config.safety));
  const planned = checks.filter((check) => check.status === 'PLANNED').length;
  const blocked = checks.filter((check) => check.status === 'BLOCKED').length;
  logSuccess(
    `Wrote ${PATHS.plannedChecksFile} — ${checks.length} total (${planned} runnable, ${blocked} blocked, ${checks.length - planned - blocked} not-tested/requires-configuration)`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
}
