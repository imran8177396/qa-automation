import type { SafetyConfigResolved } from '../core/safety-policy';
import { resolveSafetyConfig } from '../core/safety-policy';
import {
  generationInventoryToPageMapAndUi,
  isGenerationInventory,
  type GenerationInventory,
} from '../discovery/generation-contract';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';
import { buildScenarioInventory, type ScenarioInventoryOptions } from './scenario-inventory';
import type { PlannedCheck } from './types';

/**
 * Historical planning entry — delegates to buildScenarioInventory (one planning algorithm).
 *
 * Prefer writePlannedUiChecks() when writing planned-checks.json. Discovery (qa:all
 * discover stage via scripts/discover.ts) and qa:test both call that write path; the
 * later e2e stage executes PLANNED rows via tests/e2e/generated/discovery-checks.spec.ts.
 * No separate orchestrator stage or test-generation engine is required.
 *
 * Accepts either discovery page-map + ui-inventory, or the generation contract inventory
 * written next to discovery-inventory.json. Does not crawl or scrape.
 */
export function generateUiChecks(
  pageMap: PageMap,
  ui: UiInventory,
  safety: SafetyConfigResolved,
  options?: ScenarioInventoryOptions
): PlannedCheck[];
export function generateUiChecks(
  inventory: GenerationInventory,
  safety: SafetyConfigResolved,
  options?: ScenarioInventoryOptions
): PlannedCheck[];
export function generateUiChecks(
  pageMapOrInventory: PageMap | GenerationInventory,
  uiOrSafety: UiInventory | SafetyConfigResolved,
  safetyOrOptions?: SafetyConfigResolved | ScenarioInventoryOptions,
  options?: ScenarioInventoryOptions
): PlannedCheck[] {
  if (isGenerationInventory(pageMapOrInventory)) {
    return generateFromInventory(
      pageMapOrInventory,
      uiOrSafety as SafetyConfigResolved,
      safetyOrOptions as ScenarioInventoryOptions | undefined
    );
  }
  return buildScenarioInventory(
    pageMapOrInventory,
    uiOrSafety as UiInventory,
    safetyOrOptions as SafetyConfigResolved,
    options
  );
}

/**
 * Adapt GenerationInventory into pageMap + ui, then call generateUiChecks.
 * Does not fetch URLs. Constraints absent from the contract (min/max/options) stay excluded.
 */
export function generateFromInventory(
  inventory: GenerationInventory,
  safety: SafetyConfigResolved = resolveSafetyConfig(),
  options?: ScenarioInventoryOptions
): PlannedCheck[] {
  const { pageMap, ui } = generationInventoryToPageMapAndUi(inventory);
  return buildScenarioInventory(pageMap, ui, safety, options);
}
