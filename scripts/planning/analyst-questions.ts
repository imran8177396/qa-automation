/**
 * Analyst-style questions answered from GenerationInventory (+ optional extras).
 * Derives evidence only — never crawls, never invents controls or PASS rows.
 */

import type {
  GenerationInventory,
  GenerationInventoryElement,
  GenerationInventoryScreen,
} from '../discovery/generation-contract';
import { A11Y_AUTOMATED_LIMIT } from '../core/safety-policy';
import { FILLABLE_ELEMENT_KINDS, type ElementKind } from '../discovery/element-kind';

/** Question ids and prompts the engine asks of the discovered application. */
export const ANALYST_QUESTIONS = [
  { id: 'exists', prompt: 'What exists in this application?' },
  { id: 'interact', prompt: 'What can the user interact with?' },
  { id: 'enter', prompt: 'What can the user enter?' },
  { id: 'go-wrong', prompt: 'What can go wrong?' },
  { id: 'valid-inputs', prompt: 'What are the valid inputs?' },
  { id: 'invalid-inputs', prompt: 'What are the invalid inputs?' },
  { id: 'boundaries', prompt: 'What are the boundaries?' },
  { id: 'states', prompt: 'What states can this screen enter?' },
  { id: 'workflows', prompt: 'What workflows connect this screen to others?' },
  { id: 'permissions', prompt: 'What permissions apply?' },
  { id: 'security', prompt: 'What security risks apply?' },
  { id: 'accessibility', prompt: 'What accessibility requirements apply?' },
  { id: 'dependency-failure', prompt: 'What happens when dependencies fail?' },
  { id: 'unexpected-behavior', prompt: 'What happens when the user behaves unexpectedly?' },
] as const;

export interface AnalystAnswer {
  questionId: string;
  prompt: string;
  status: 'ANSWERED' | 'NOT_TESTED' | 'REQUIRES_CONFIGURATION';
  evidenceCount: number;
  summary: string;
}

export interface AnalystQuestionExtras {
  workflowCount?: number;
  stateCount?: number;
  permissionRuleCount?: number;
  navigationEdgeCount?: number;
  /** When true, dependency failure was observed externally — never invented here. */
  dependencyFailureObserved?: boolean;
}

/** Optional constraint-shaped fields — only count when present on an inventory element. */
type OptionalConstraintFields = {
  validation?: unknown;
  min?: unknown;
  max?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  pattern?: unknown;
  state?: unknown;
};

const ENTERABLE_CATEGORY = new Set([
  'input',
  'textarea',
  'select',
  'email',
  'search',
  'file',
  'file-upload',
]);

const AUTH_LABEL = /\b(password|login|auth|sign[\s-]?in|username|credential)\b/i;

function allElements(inventory: GenerationInventory): GenerationInventoryElement[] {
  return inventory.screens.flatMap((s) => s.elements ?? []);
}

function isDecorative(el: GenerationInventoryElement): boolean {
  return el.type === 'decorative' || el.category === 'decorative';
}

function isEnterable(el: GenerationInventoryElement): boolean {
  const type = (el.type ?? '').toLowerCase();
  const category = (el.category ?? '').toLowerCase();
  if (FILLABLE_ELEMENT_KINDS.has(type as ElementKind)) return true;
  if (type === 'file-upload' || type === 'file' || type.includes('file')) return true;
  if (ENTERABLE_CATEGORY.has(category)) return true;
  if (ENTERABLE_CATEGORY.has(type)) return true;
  if (type.includes('email') || type.includes('search') || type.includes('textarea')) return true;
  if (type.includes('select') || type.endsWith('-input') || type === 'input') return true;
  return false;
}

function hasNonEmptyLabel(el: GenerationInventoryElement): boolean {
  return typeof el.label === 'string' && el.label.trim().length > 0;
}

function isSecurityRelevant(el: GenerationInventoryElement): boolean {
  const type = (el.type ?? '').toLowerCase();
  const category = (el.category ?? '').toLowerCase();
  const label = typeof el.label === 'string' ? el.label : '';
  if (type.includes('password') || category.includes('password')) return true;
  if (
    type === 'file-upload' ||
    type === 'file' ||
    type.includes('file') ||
    category === 'file' ||
    category === 'file-upload' ||
    category.includes('file')
  ) {
    return true;
  }
  if (AUTH_LABEL.test(label) || AUTH_LABEL.test(type) || AUTH_LABEL.test(category)) return true;
  return false;
}

function hasBoundaryConstraint(el: GenerationInventoryElement): boolean {
  const raw = el as GenerationInventoryElement & OptionalConstraintFields;
  return (
    raw.min !== undefined ||
    raw.max !== undefined ||
    raw.minLength !== undefined ||
    raw.maxLength !== undefined ||
    raw.pattern !== undefined
  );
}

function hasValidationConstraints(el: GenerationInventoryElement): boolean {
  const raw = el as GenerationInventoryElement & OptionalConstraintFields;
  if (!('validation' in raw) || raw.validation === undefined) return false;
  return Array.isArray(raw.validation) && raw.validation.length > 0;
}

function contractMentionsValidationField(elements: GenerationInventoryElement[]): boolean {
  return elements.some((el) => 'validation' in (el as object));
}

function screenNonDefaultState(screen: GenerationInventoryScreen): boolean {
  const raw = screen as GenerationInventoryScreen & OptionalConstraintFields;
  if (!('state' in raw) || raw.state === undefined || raw.state === null) return false;
  const state = String(raw.state);
  return state.length > 0 && state !== 'default';
}

function answer(
  questionId: string,
  prompt: string,
  status: AnalystAnswer['status'],
  evidenceCount: number,
  summary: string
): AnalystAnswer {
  return { questionId, prompt, status, evidenceCount, summary };
}

/**
 * Answer analyst questions from inventory (+ optional extras) only.
 * Does not crawl. Unanswered questions stay NOT_TESTED / REQUIRES_CONFIGURATION.
 */
export function answerAnalystQuestions(
  inventory: GenerationInventory,
  extras?: AnalystQuestionExtras
): AnalystAnswer[] {
  const screens = inventory?.screens ?? [];
  const elements = allElements(inventory);
  const interactive = elements.filter((el) => !isDecorative(el));
  const enterable = elements.filter(isEnterable);
  const requiredFields = elements.filter((el) => el.required === true);
  const withValidation = elements.filter(hasValidationConstraints);
  const withBoundaries = elements.filter(hasBoundaryConstraint);
  const labeled = elements.filter(hasNonEmptyLabel);
  const securityRelevant = elements.filter(isSecurityRelevant);
  const screensWithState = screens.filter(screenNonDefaultState);

  const workflowCount = extras?.workflowCount ?? 0;
  const navigationEdgeCount = extras?.navigationEdgeCount ?? 0;
  const stateCount = extras?.stateCount ?? 0;
  const permissionRuleCount = extras?.permissionRuleCount ?? 0;
  const dependencyFailureObserved = extras?.dependencyFailureObserved === true;

  const byId = new Map<string, AnalystAnswer>();

  for (const q of ANALYST_QUESTIONS) {
    switch (q.id) {
      case 'exists': {
        if (screens.length > 0) {
          byId.set(
            q.id,
            answer(q.id, q.prompt, 'ANSWERED', screens.length, `${screens.length} screen(s) in the discovery inventory`)
          );
        } else {
          byId.set(
            q.id,
            answer(q.id, q.prompt, 'NOT_TESTED', 0, 'no screens in the discovery inventory')
          );
        }
        break;
      }
      case 'interact': {
        if (interactive.length > 0) {
          byId.set(
            q.id,
            answer(
              q.id,
              q.prompt,
              'ANSWERED',
              interactive.length,
              `${interactive.length} non-decorative element(s) discovered`
            )
          );
        } else {
          byId.set(q.id, answer(q.id, q.prompt, 'NOT_TESTED', 0, 'no interactive elements'));
        }
        break;
      }
      case 'enter': {
        if (enterable.length > 0) {
          byId.set(
            q.id,
            answer(q.id, q.prompt, 'ANSWERED', enterable.length, `${enterable.length} enterable field(s) discovered`)
          );
        } else {
          byId.set(q.id, answer(q.id, q.prompt, 'NOT_TESTED', 0, 'no enterable fields'));
        }
        break;
      }
      case 'go-wrong': {
        if (requiredFields.length > 0) {
          byId.set(
            q.id,
            answer(q.id, q.prompt, 'ANSWERED', requiredFields.length, 'required fields were discovered')
          );
        } else if (withValidation.length > 0) {
          byId.set(
            q.id,
            answer(
              q.id,
              q.prompt,
              'ANSWERED',
              withValidation.length,
              `${withValidation.length} element(s) with recorded validation constraints`
            )
          );
        } else if (!contractMentionsValidationField(elements)) {
          byId.set(
            q.id,
            answer(q.id, q.prompt, 'NOT_TESTED', 0, 'constraints were not in the inventory')
          );
        } else {
          byId.set(
            q.id,
            answer(q.id, q.prompt, 'NOT_TESTED', 0, 'constraints were not in the inventory')
          );
        }
        break;
      }
      case 'valid-inputs': {
        if (enterable.length > 0) {
          byId.set(
            q.id,
            answer(
              q.id,
              q.prompt,
              'ANSWERED',
              enterable.length,
              `${enterable.length} enterable field(s); valid values are not invented`
            )
          );
        } else {
          byId.set(q.id, answer(q.id, q.prompt, 'NOT_TESTED', 0, 'no enterable fields'));
        }
        break;
      }
      case 'invalid-inputs': {
        if (enterable.length > 0) {
          byId.set(
            q.id,
            answer(
              q.id,
              q.prompt,
              'ANSWERED',
              enterable.length,
              'invalid cases are generated from field type and recorded constraints'
            )
          );
        } else {
          byId.set(q.id, answer(q.id, q.prompt, 'NOT_TESTED', 0, 'no enterable fields'));
        }
        break;
      }
      case 'boundaries': {
        if (withBoundaries.length > 0) {
          byId.set(
            q.id,
            answer(
              q.id,
              q.prompt,
              'ANSWERED',
              withBoundaries.length,
              `${withBoundaries.length} element(s) with recorded boundary constraints`
            )
          );
        } else {
          byId.set(
            q.id,
            answer(
              q.id,
              q.prompt,
              'NOT_TESTED',
              0,
              'boundary constraints were not in the generation inventory'
            )
          );
        }
        break;
      }
      case 'states': {
        const evidence = stateCount > 0 ? stateCount : screensWithState.length;
        if (stateCount > 0 || screensWithState.length > 0) {
          byId.set(
            q.id,
            answer(q.id, q.prompt, 'ANSWERED', evidence, `${evidence} screen state(s) supplied`)
          );
        } else {
          byId.set(q.id, answer(q.id, q.prompt, 'NOT_TESTED', 0, 'screen states were not supplied'));
        }
        break;
      }
      case 'workflows': {
        const evidence = (workflowCount > 0 ? workflowCount : 0) + (navigationEdgeCount > 0 ? navigationEdgeCount : 0);
        if (navigationEdgeCount > 0 || workflowCount > 0) {
          byId.set(
            q.id,
            answer(
              q.id,
              q.prompt,
              'ANSWERED',
              evidence,
              `${workflowCount} workflow(s), ${navigationEdgeCount} navigation edge(s) supplied`
            )
          );
        } else {
          byId.set(
            q.id,
            answer(q.id, q.prompt, 'NOT_TESTED', 0, 'no navigation edges were supplied')
          );
        }
        break;
      }
      case 'permissions': {
        if (permissionRuleCount > 0) {
          byId.set(
            q.id,
            answer(
              q.id,
              q.prompt,
              'ANSWERED',
              permissionRuleCount,
              `${permissionRuleCount} permission rule(s) configured`
            )
          );
        } else {
          byId.set(
            q.id,
            answer(q.id, q.prompt, 'REQUIRES_CONFIGURATION', 0, 'permission rules were not configured')
          );
        }
        break;
      }
      case 'security': {
        if (securityRelevant.length > 0) {
          byId.set(
            q.id,
            answer(
              q.id,
              q.prompt,
              'ANSWERED',
              securityRelevant.length,
              `${securityRelevant.length} security-relevant control(s) in the inventory`
            )
          );
        } else {
          byId.set(
            q.id,
            answer(q.id, q.prompt, 'NOT_TESTED', 0, 'no security-relevant control in the inventory')
          );
        }
        break;
      }
      case 'accessibility': {
        if (labeled.length > 0) {
          byId.set(
            q.id,
            answer(
              q.id,
              q.prompt,
              'ANSWERED',
              labeled.length,
              `${labeled.length} labeled element(s); ${A11Y_AUTOMATED_LIMIT}`
            )
          );
        } else {
          byId.set(q.id, answer(q.id, q.prompt, 'NOT_TESTED', 0, 'no labels in the inventory'));
        }
        break;
      }
      case 'dependency-failure': {
        if (dependencyFailureObserved) {
          byId.set(
            q.id,
            answer(q.id, q.prompt, 'ANSWERED', 1, 'dependency failure was observed in supplied extras')
          );
        } else {
          byId.set(
            q.id,
            answer(q.id, q.prompt, 'NOT_TESTED', 0, 'dependency failure was not observed')
          );
        }
        break;
      }
      case 'unexpected-behavior': {
        if (enterable.length > 0) {
          byId.set(
            q.id,
            answer(
              q.id,
              q.prompt,
              'ANSWERED',
              enterable.length,
              'unexpected input cases follow negative and edge plans for discovered fields'
            )
          );
        } else {
          byId.set(q.id, answer(q.id, q.prompt, 'NOT_TESTED', 0, 'no enterable fields'));
        }
        break;
      }
    }
  }

  // Stable order: every ANALYST_QUESTIONS entry exactly once.
  return ANALYST_QUESTIONS.map((q) => {
    const row = byId.get(q.id);
    if (!row) {
      return answer(q.id, q.prompt, 'NOT_TESTED', 0, 'unanswered');
    }
    return row;
  });
}
