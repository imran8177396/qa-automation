import { parsePlannedChecks, type ElementPurpose, type PlannedCheck, type ScenarioKind } from '../planning/types';
import type { AssignedScenario, InventoryItem, InventoryKind, ScenarioId } from './types';

function purposeToKind(purpose: ElementPurpose | undefined): InventoryKind {
  switch (purpose) {
    case 'navigation-link':
      return 'link';
    case 'button':
      return 'button';
    case 'form':
      return 'form';
    case 'select':
      return 'dropdown';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'text-input':
    case 'password-input':
    case 'hidden-input':
      return 'field';
    default:
      return 'ui-component';
  }
}

function scenarioIdFor(check: PlannedCheck): ScenarioId {
  switch (check.scenarioKind) {
    case 'page-reached':
      return check.kind === 'broken-link' ? 'broken-link' : 'page-load';
    case 'positive':
      if (check.kind === 'form-presence') return 'form-presence';
      if (check.kind === 'link-href' || check.kind === 'navigation') return 'navigation';
      return 'visibility';
    case 'negative':
      return check.kind === 'empty-input' ? 'empty-input' : 'invalid-input';
    case 'edge':
      return 'boundary-values';
    case 'field':
      if (check.kind === 'empty-input') return 'empty-input';
      if (
        check.kind === 'invalid-input' ||
        check.kind === 'special-characters' ||
        check.kind === 'unicode-input' ||
        check.kind === 'whitespace-input' ||
        check.kind === 'long-input'
      ) {
        return 'invalid-input';
      }
      if (check.kind === 'boundary-values') return 'boundary-values';
      if (check.kind === 'valid-input') return 'valid-input';
      return 'visibility';
    case 'validation':
      return check.kind === 'required-state' ? 'required-state' : 'required-validation';
    case 'security':
      return 'security-baseline';
    case 'usability-accessibility':
    case 'accessibility':
    case 'usability':
      return 'accessible-name';
    case 'workflow':
      return 'navigation';
    case 'button':
      return 'click-behavior';
    case 'link':
      if (check.kind === 'broken-link') return 'broken-link';
      if (check.kind === 'link-href' || check.kind === 'navigation') return 'navigation';
      if (check.kind === 'security-observation') return 'security-baseline';
      return 'visibility';
    case 'form':
      if (check.kind === 'form-presence') return 'form-presence';
      if (check.kind === 'form-submit') return 'form-presence';
      if (check.kind === 'empty-input') return 'empty-input';
      if (check.kind === 'invalid-input') return 'invalid-input';
      if (check.kind === 'valid-input') return 'valid-input';
      if (check.kind === 'form-boundary' || check.kind === 'boundary-values') return 'boundary-values';
      if (check.kind === 'required-state' || check.kind === 'required-validation') {
        return check.kind === 'required-state' ? 'required-state' : 'required-validation';
      }
      return 'form-presence';
    case 'login':
      if (check.kind === 'form-submit') return 'form-presence';
      if (check.kind === 'empty-input') return 'empty-input';
      if (check.kind === 'invalid-input') return 'invalid-input';
      if (check.kind === 'valid-input') return 'valid-input';
      if (check.kind === 'security-observation') return 'security-baseline';
      return 'form-presence';
    case 'role':
      return 'security-baseline';
    case 'security-context':
      return 'security-baseline';
    case 'api-ui':
      return 'click-behavior';
    case 'state-transition':
      return 'visibility';
    case 'visual':
      return 'visual-regression';
    case 'dynamic':
      if (check.kind === 'valid-input') return 'valid-input';
      if (
        check.kind === 'invalid-input' ||
        check.kind === 'empty-input' ||
        check.kind === 'special-characters' ||
        check.kind === 'long-input'
      ) {
        return 'invalid-input';
      }
      return 'visibility';
    default:
      return 'visibility';
  }
}

function assignedScenario(check: PlannedCheck): AssignedScenario {
  const reason = check.reason ?? `${check.status}: scenario inventory row`;
  const id = scenarioIdFor(check);
  switch (check.status) {
    case 'PLANNED':
      return { id, disposition: 'executable', reason: check.title, tested: false, evidenceIds: [] };
    case 'FAIL':
    case 'PASS':
      // Crawl-evidence finding recorded at plan time — not an invented PASS from execution.
      return { id, disposition: 'executable', reason, tested: true, evidenceIds: [] };
    case 'BLOCKED':
      return { id, disposition: 'blocked-safety', reason, tested: false, evidenceIds: [] };
    case 'REQUIRES_CONFIGURATION':
      return { id, disposition: 'requires-configuration', reason, tested: false, evidenceIds: [] };
    case 'NOT_APPLICABLE':
      return { id, disposition: 'not-implemented', reason, tested: false, evidenceIds: [] };
    case 'NOT_TESTED':
    default:
      return { id, disposition: 'not-implemented', reason, tested: false, evidenceIds: [] };
  }
}

/**
 * Map scenario-inventory planned-check rows into coverage inventory items.
 * Feeds the existing UI/functional dimensions — does not invent a second formula.
 * Unexecuted PLANNED rows stay executable+untested (not TESTED, never inflate to 100%).
 */
export function plannedChecksToCoverageItems(raw: unknown): InventoryItem[] {
  const checks = parsePlannedChecks(raw);
  const items: InventoryItem[] = [];

  for (const check of checks) {
    if (!check.scenarioKind) continue;

    const scenario = assignedScenario(check);
    const isPage = check.scenarioKind === 'page-reached';
    const isWorkflow = check.scenarioKind === 'workflow';
    const isVisual = check.scenarioKind === 'visual';

    const item: InventoryItem = {
      id: `SCN-${check.id}`,
      kind: isPage ? 'page' : isWorkflow ? 'navigation' : isVisual ? 'visual' : purposeToKind(check.purpose),
      name: check.title,
      page: check.screenUrl ?? check.targetUrl,
      locator: check.expect?.locator,
      elementType: check.purpose,
      source: 'discovery',
      applicableScenarios: [scenario],
    };

    if (check.status === 'NOT_APPLICABLE') {
      item.coverageHint = 'not-applicable';
    } else if (check.status === 'NOT_TESTED' || check.status === 'REQUIRES_CONFIGURATION') {
      item.coverageHint = 'untestable';
    }

    items.push(item);
  }

  return items;
}

/** Counts for notes / reporting — never claim 100% from these alone. */
export function summarizeScenarioInventory(raw: unknown): {
  total: number;
  byKind: Partial<Record<ScenarioKind, number>>;
  planned: number;
  gated: number;
} {
  const checks = parsePlannedChecks(raw).filter((c) => c.scenarioKind);
  const byKind: Partial<Record<ScenarioKind, number>> = {};
  let planned = 0;
  let gated = 0;
  for (const check of checks) {
    const kind = check.scenarioKind!;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    if (check.status === 'PLANNED') planned += 1;
    else gated += 1;
  }
  return { total: checks.length, byKind, planned, gated };
}
