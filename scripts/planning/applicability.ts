/**
 * Per-element test-category applicability for the planning layer.
 * Reasons from element kind / evidence only — never from a demo host or invented DOM.
 * Not a second planner: buildScenarioInventory consumes these decisions.
 */

import {
  classifyElementKind,
  isBlockedActionKind,
  isDataDisplayKind,
  purposeFromElementKind,
  type ElementKind,
} from '../discovery/element-kind';
import type { UiElementRecord } from '../discovery/ui-scan';
import type { ElementPurpose, ScenarioKind } from './types';

/** Fixed inventory category names (boundary aliases scenarioKind "edge"). */
export const APPLICABLE_CATEGORIES = [
  'positive',
  'negative',
  'boundary',
  'validation',
  'security',
  'accessibility',
  'usability',
] as const;

export type ApplicableCategory = (typeof APPLICABLE_CATEGORIES)[number];

export type CategoryDecision = 'apply' | 'exclude';

export interface CategoryApplicability {
  category: ApplicableCategory;
  decision: CategoryDecision;
  reason: string;
}

/** Fillable kinds that receive positive/negative + constraint-gated boundary/validation. */
const FILLABLE_INPUT_KINDS = new Set<ElementKind>([
  'text-input',
  'email-input',
  'password-input',
  'number-input',
  'search-field',
  'textarea',
  'otp-field',
  'masked-input',
  'autocomplete',
  'date-input',
  'time-input',
  'datetime-input',
]);

const LINK_KINDS = new Set<ElementKind>([
  'link',
  'menu-item',
  'breadcrumb',
  'tab',
  'pagination',
  'nav-button',
  'logo-link',
  'back-button',
  'forward-button',
]);

const STATE_CHANGING_BUTTON_KINDS = new Set<ElementKind>([
  'submit-button',
  'delete-button',
  'save-button',
  'reset-button',
  'upload-button',
]);

export function resolveKindForApplicability(element: UiElementRecord): ElementKind {
  if (element.elementKind) return element.elementKind;
  return classifyElementKind({
    tag: element.tag,
    inputType: element.inputType,
    role: element.attributes?.role ?? null,
    elementType: element.elementType,
    accessibleName: element.accessibleName,
    href: element.href,
    isSubmit: element.isSubmit,
    evidence: element.evidence,
    attributes: element.attributes,
    chartCandidate: element.chartCandidate,
    insideOverlay: element.insideOverlay,
  });
}

export function hasBoundaryConstraint(element: UiElementRecord): boolean {
  return Boolean(
    (element.min != null && element.min !== '') ||
      (element.max != null && element.max !== '') ||
      (element.minLength != null && element.minLength !== '') ||
      (element.maxLength != null && element.maxLength !== '')
  );
}

export function hasValidationConstraint(element: UiElementRecord): boolean {
  if (element.required) return true;
  const inputType = (element.inputType ?? '').toLowerCase();
  if (inputType && inputType !== 'text' && inputType !== 'search' && inputType !== 'hidden') {
    return true;
  }
  const attrs = element.attributes ?? {};
  if (attrs.pattern || attrs.min || attrs.max || attrs.minlength || attrs.maxlength) return true;
  return Boolean(element.min || element.max || element.minLength || element.maxLength);
}

function hasAccessibleName(element: UiElementRecord): boolean {
  const name = (element.accessibleName ?? element.label ?? '').trim();
  return name.length > 0;
}

function hasRoleEvidence(element: UiElementRecord): boolean {
  return /\brole=/i.test(element.evidence ?? '') || Boolean(element.attributes?.role);
}

function hasAccessibilityEvidence(element: UiElementRecord): boolean {
  return hasAccessibleName(element) || hasRoleEvidence(element);
}

function decision(
  category: ApplicableCategory,
  d: CategoryDecision,
  reason: string
): CategoryApplicability {
  return { category, decision: d, reason };
}

function apply(category: ApplicableCategory, reason: string): CategoryApplicability {
  return decision(category, 'apply', reason);
}

function exclude(category: ApplicableCategory, reason: string): CategoryApplicability {
  return decision(category, 'exclude', reason);
}

function accessibilityUsability(element: UiElementRecord): CategoryApplicability[] {
  const a11y = hasAccessibilityEvidence(element)
    ? apply('accessibility', 'observe accessible name/role from discovery evidence')
    : exclude('accessibility', 'accessibility facts not in discovery evidence');
  const usable = hasAccessibleName(element)
    ? apply('usability', 'observe label/name visibility from discovery evidence')
    : exclude('usability', 'no label or accessible name to assess usability');
  return [a11y, usable];
}

function formCategoryExcludes(subject: string): CategoryApplicability[] {
  return [
    exclude('negative', `negative scenarios do not apply to a ${subject}`),
    exclude('boundary', `boundary scenarios do not apply to a ${subject}`),
    exclude('validation', `validation scenarios do not apply to a ${subject}`),
    exclude('security', `security scenarios do not apply to a ${subject}`),
  ];
}

/**
 * Map inventory category → stored scenarioKind (keep "edge" for boundary; tests assert it).
 */
export function scenarioKindForCategory(category: ApplicableCategory): ScenarioKind {
  switch (category) {
    case 'boundary':
      return 'edge';
    case 'positive':
    case 'negative':
    case 'validation':
    case 'security':
    case 'accessibility':
    case 'usability':
      return category;
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}

/**
 * Compact exclusion reason for one NOT_APPLICABLE summary row.
 * Names each excluded category and why — never omits the reason.
 */
export function formatExcludedCategories(excluded: CategoryApplicability[]): string {
  const parts = excluded
    .filter((row) => row.decision === 'exclude')
    .map((row) => `${row.category} (${row.reason})`);
  return `excluded: ${parts.join('; ')}`;
}

/**
 * For each discovered element, decide which of the seven test categories apply.
 * Decorative → all exclude (caller emits one NOT_APPLICABLE row).
 * Every non-decorative element gets an apply|exclude decision for each category.
 */
export function applicableCategories(element: UiElementRecord): CategoryApplicability[] {
  const kind = resolveKindForApplicability(element);
  const purpose: ElementPurpose =
    kind !== 'unknown' || element.elementKind
      ? purposeFromElementKind(kind)
      : 'unknown';

  if (kind === 'decorative') {
    return APPLICABLE_CATEGORIES.map((category) =>
      exclude(category, 'decorative element is not a functional control')
    );
  }

  if (isDataDisplayKind(kind)) {
    return [
      apply('positive', 'data-display elements are observable only'),
      ...formCategoryExcludes('data-display element'),
      ...accessibilityUsability(element),
    ];
  }

  if (LINK_KINDS.has(kind) || purpose === 'navigation-link') {
    return [
      apply('positive', 'link observe (workflow only when a navigation edge exists)'),
      ...formCategoryExcludes('link'),
      ...accessibilityUsability(element),
    ];
  }

  if (
    STATE_CHANGING_BUTTON_KINDS.has(kind) ||
    isBlockedActionKind(kind) ||
    (purpose === 'button' && Boolean(element.isSubmit))
  ) {
    return [
      apply('positive', 'observe only — activate/submit stays BLOCKED by safety policy'),
      exclude('negative', 'negative scenarios do not apply to a state-changing button'),
      exclude('boundary', 'boundary scenarios do not apply to a state-changing button'),
      exclude('validation', 'validation scenarios do not apply to a state-changing button'),
      exclude('security', 'security is not planned as an attack for this control'),
      ...accessibilityUsability(element),
    ];
  }

  if (
    purpose === 'button' ||
    kind === 'button' ||
    (typeof kind === 'string' && kind.endsWith('-button') && !STATE_CHANGING_BUTTON_KINDS.has(kind))
  ) {
    return [
      apply('positive', 'plain button observe'),
      ...formCategoryExcludes('button'),
      ...accessibilityUsability(element),
    ];
  }

  if (purpose === 'form' || kind === 'form') {
    return [
      apply('positive', 'form presence observe'),
      ...formCategoryExcludes('form'),
      ...accessibilityUsability(element),
    ];
  }

  if (purpose === 'hidden-input') {
    return [
      apply('positive', 'hidden field recorded from scan'),
      exclude('negative', 'negative fill does not apply to hidden inputs'),
      exclude('boundary', 'edge analysis not applicable to this control type'),
      exclude('validation', 'no validation constraint discovered'),
      apply('security', 'sensitive/hidden field observation only'),
      ...accessibilityUsability(element),
    ];
  }

  if (
    purpose === 'select' ||
    purpose === 'checkbox' ||
    purpose === 'radio' ||
    kind === 'select' ||
    kind === 'checkbox' ||
    kind === 'radio' ||
    kind === 'toggle'
  ) {
    const rows: CategoryApplicability[] = [
      apply('positive', 'observe fillable control'),
      apply('negative', 'negative empty/invalid fill (no submit)'),
      exclude('boundary', 'edge analysis not applicable to this control type'),
      hasValidationConstraint(element)
        ? apply('validation', 'validation constraint discovered')
        : exclude('validation', 'no validation constraint discovered'),
      exclude('security', 'security scenarios do not apply to this control'),
    ];
    rows.push(...accessibilityUsability(element));
    return rows;
  }

  if (
    FILLABLE_INPUT_KINDS.has(kind) ||
    purpose === 'text-input' ||
    purpose === 'password-input'
  ) {
    const rows: CategoryApplicability[] = [
      apply('positive', 'observe fillable control'),
      apply('negative', 'negative empty/invalid fill (no submit)'),
      apply('boundary', 'edge/boundary analysis for fillable input'),
      hasValidationConstraint(element)
        ? apply('validation', 'validation constraint discovered')
        : exclude('validation', 'no validation constraint discovered'),
    ];

    if (kind === 'email-input' || (element.inputType ?? '').toLowerCase() === 'email') {
      rows.push(apply('security', 'security observation only; no exploit payload'));
    } else if (kind === 'password-input' || purpose === 'password-input') {
      rows.push(apply('security', 'type=password observation only'));
    } else {
      rows.push(exclude('security', 'security scenarios do not apply to this control'));
    }

    rows.push(...accessibilityUsability(element));
    return rows;
  }

  // Unknown / other interactive leftovers — still decide all seven (exclude with reason).
  return [
    exclude('positive', 'element purpose not determined from discovery evidence'),
    exclude('negative', 'element purpose not determined from discovery evidence'),
    exclude('boundary', 'element purpose not determined from discovery evidence'),
    exclude('validation', 'element purpose not determined from discovery evidence'),
    exclude('security', 'element purpose not determined from discovery evidence'),
    exclude('accessibility', 'element purpose not determined from discovery evidence'),
    exclude('usability', 'element purpose not determined from discovery evidence'),
  ];
}
