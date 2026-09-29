import { resolveSafetyConfig, type SafetyConfigResolved } from '../core/safety-policy';
import { readJsonIfExists, writeJson } from '../discovery/write-json';
import {
  isGenerationInventory,
  type GenerationInventory,
} from '../discovery/generation-contract';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';
import { loadConfig } from '../lib/load-config';
import { PATHS } from '../lib/paths';
import { logError, logStep, logSuccess } from '../lib/logger';
import { generateFromInventory, generateUiChecks } from './generate-ui-checks';
import type { PlannedCheck } from './types';

/**
 * Public write entry for the discovery-driven UI / scenario inventory.
 * Calls generateUiChecks → buildScenarioInventory (one planning layer).
 *
 * Callers: scripts/discover.ts (qa:all discovery stage), coverage-planning /
 * inventory stages, and scripts/run-qa-test.ts. Execution stays on the existing
 * e2e generated harness — no extra orchestrator stage.
 *
 * Accepts page-map + ui-inventory, or the generation contract inventory.
 * Does not scrape the application again.
 */
export function writePlannedUiChecks(
  pageMap: PageMap,
  ui: UiInventory,
  safety: SafetyConfigResolved
): PlannedCheck[];
export function writePlannedUiChecks(
  inventory: GenerationInventory,
  safety: SafetyConfigResolved
): PlannedCheck[];
export function writePlannedUiChecks(
  pageMapOrInventory: PageMap | GenerationInventory,
  uiOrSafety: UiInventory | SafetyConfigResolved,
  safety?: SafetyConfigResolved
): PlannedCheck[] {
  const checks = isGenerationInventory(pageMapOrInventory)
    ? generateFromInventory(pageMapOrInventory, uiOrSafety as SafetyConfigResolved)
    : generateUiChecks(pageMapOrInventory, uiOrSafety as UiInventory, safety as SafetyConfigResolved);
  writeJson(PATHS.plannedChecksFile, checks);
  writeJson(PATHS.uiChecksFile, checks);
  return checks;
}

function main(): void {
  logStep('Planning UI checks from current discovery inventories');
  const generationInventory = readJsonIfExists<GenerationInventory>(PATHS.generationInventoryFile);
  if (generationInventory && isGenerationInventory(generationInventory)) {
    const config = loadConfig();
    const checks = writePlannedUiChecks(generationInventory, resolveSafetyConfig(config.safety));
    const planned = checks.filter((check) => check.status === 'PLANNED').length;
    const blocked = checks.filter((check) => check.status === 'BLOCKED').length;
    logSuccess(
      `Wrote ${PATHS.plannedChecksFile} from generation-inventory.json — ${checks.length} total (${planned} runnable, ${blocked} blocked, ${checks.length - planned - blocked} not-tested/requires-configuration)`
    );
    return;
  }

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
