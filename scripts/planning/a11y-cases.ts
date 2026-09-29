/**
 * Screen-level accessibility observation plans for the existing planner.
 * Consumed only by buildScenarioInventory → planA11yForScreen — not a second planner
 * and not a second a11y engine (axe stays the runtime engine elsewhere).
 *
 * Evidence-only: never invent roles, contrast ratios, WCAG claims, or demo hosts.
 * Never PASS. Strongest positive status is PLANNED (observe). Never click / submit.
 * Every reason or note includes A11Y_AUTOMATED_LIMIT (or "not full WCAG compliance").
 */

import { A11Y_AUTOMATED_LIMIT } from '../core/safety-policy';
import {
  FILLABLE_ELEMENT_KINDS,
  type ElementKind,
} from '../discovery/element-kind';
import type { DiscoveredScreen } from '../discovery/screens';
import type { UiElementRecord } from '../discovery/ui-scan';
import type {
  CheckKind,
  CheckStatus,
  InventoryCategory,
  PlannedAction,
  PlannedCheck,
} from './types';

/** Shorter WCAG-limit phrase when the full axe sentence is already present nearby. */
export const A11Y_WCAG_LIMIT_SHORT = 'not full WCAG compliance';

export type A11ySubcaseId =
  | 'a11y-none'
  | 'a11y-keyboard'
  | 'a11y-focus'
  | 'a11y-labels'
  | 'a11y-accessible-name'
  | 'a11y-accessible-name-missing'
  | 'a11y-aria'
  | 'a11y-tab-order'
  | 'a11y-contrast'
  | 'a11y-screen-reader'
  | 'a11y-disabled'
  | 'a11y-error-announcement'
  | 'a11y-form-labels'
  | `a11y-accessible-name-missing-${string}`;

export interface A11ySubcasePlan {
  subcaseId: A11ySubcaseId;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  category: InventoryCategory;
  reason?: string;
  expect?: PlannedCheck['expect'];
  targetElementId?: string;
}

export interface A11yCaseResult {
  plans: A11ySubcasePlan[];
}

export interface A11yPlanningOptions {
  /**
   * Element ids that already have an accessibility accessible-name scenario row
   * for the same fact. Screen plans skip duplicate per-element name rows for these.
   */
  existingAccessibleNameElementIds?: ReadonlySet<string>;
}

const ARIA_ATTR = /^aria-/i;
const TABINDEX_IN_EVIDENCE = /\btabindex\s*=/i;
const ROLE_IN_EVIDENCE = /\brole\s*=/i;
const ARIA_IN_EVIDENCE = /\baria-[\w-]+\s*=/i;
const ARIA_LIVE_IN_EVIDENCE = /\baria-live\s*=/i;
const ROLE_ALERT_IN_EVIDENCE = /\brole\s*=\s*["']?alert\b/i;

function resolveKind(el: UiElementRecord): ElementKind {
  return (el.elementKind ?? el.type ?? 'unknown') as ElementKind;
}

function isDecorative(el: UiElementRecord): boolean {
  return resolveKind(el) === 'decorative';
}

/** Non-decorative interactive controls — decorative never counts. */
export function isInteractiveForA11y(el: UiElementRecord): boolean {
  if (isDecorative(el)) return false;
  if (el.interactive) return true;
  const kind = resolveKind(el);
  if (FILLABLE_ELEMENT_KINDS.has(kind)) return true;
  const type = el.elementType;
  return (
    type === 'button' ||
    type === 'link' ||
    type === 'input' ||
    type === 'textarea' ||
    type === 'select' ||
    type === 'checkbox' ||
    type === 'radio' ||
    type === 'toggle' ||
    type === 'navigation'
  );
}

function elementLabel(el: UiElementRecord): string {
  return (el.accessibleName ?? el.label ?? '').trim();
}

function hasLabelOrName(el: UiElementRecord): boolean {
  return elementLabel(el).length > 0;
}

function describeElement(el: UiElementRecord): string {
  const name = elementLabel(el);
  if (name) return `${el.elementId} (${name})`;
  return el.elementId;
}

/** Append automated-axe WCAG limit to every a11y reason / note. */
export function withA11yLimit(detail: string): string {
  const trimmed = detail.trim().replace(/\.\s*$/, '');
  if (/not full WCAG compliance/i.test(trimmed) || /Automated axe checks are not full WCAG/i.test(trimmed)) {
    return `${trimmed}.`;
  }
  return `${trimmed}. ${A11Y_AUTOMATED_LIMIT}`;
}

function statusReason(status: CheckStatus, detail: string): string {
  return `${status}: ${withA11yLimit(detail)}`;
}

function observeNote(detail: string): string {
  return withA11yLimit(detail);
}

function attrsOf(el: UiElementRecord): Record<string, string> {
  return el.attributes ?? {};
}

function hasRecordedTabindex(el: UiElementRecord): boolean {
  const attrs = attrsOf(el);
  if (Object.prototype.hasOwnProperty.call(attrs, 'tabindex')) return true;
  if (Object.prototype.hasOwnProperty.call(attrs, 'tabIndex')) return true;
  return TABINDEX_IN_EVIDENCE.test(el.evidence ?? '');
}

/** Focusable only when the scan stored an explicit flag — never invent from interactive alone. */
function hasFocusableFlag(el: UiElementRecord): boolean {
  const attrs = attrsOf(el);
  const flag = attrs['data-focusable'] ?? attrs['focusable'];
  if (flag === 'true' || flag === '') return true;
  const meta = (el as UiElementRecord & { focusable?: boolean }).focusable;
  return meta === true;
}

function hasFocusEvidence(el: UiElementRecord): boolean {
  return hasRecordedTabindex(el) || hasFocusableFlag(el);
}

function hasAriaEvidence(el: UiElementRecord): boolean {
  const attrs = attrsOf(el);
  if (attrs.role) return true;
  if (Object.keys(attrs).some((key) => ARIA_ATTR.test(key))) return true;
  const evidence = el.evidence ?? '';
  return ROLE_IN_EVIDENCE.test(evidence) || ARIA_IN_EVIDENCE.test(evidence);
}

function hasErrorAnnouncementEvidence(el: UiElementRecord): boolean {
  const attrs = attrsOf(el);
  if ((attrs.role ?? '').toLowerCase() === 'alert') return true;
  if (Object.prototype.hasOwnProperty.call(attrs, 'aria-live')) return true;
  const evidence = el.evidence ?? '';
  return ROLE_ALERT_IN_EVIDENCE.test(evidence) || ARIA_LIVE_IN_EVIDENCE.test(evidence);
}

function isDisabledControl(el: UiElementRecord): boolean {
  const attrs = attrsOf(el);
  if (attrs['aria-disabled'] === 'true') return true;
  if (Object.prototype.hasOwnProperty.call(attrs, 'disabled')) return true;
  if (el.enabled === false) return true;
  return false;
}

function isFillableField(el: UiElementRecord): boolean {
  if (isDecorative(el)) return false;
  const kind = resolveKind(el);
  if (kind === 'submit-button' || kind === 'reset-button') return false;
  if (FILLABLE_ELEMENT_KINDS.has(kind)) return true;
  const type = el.elementType;
  return (
    type === 'input' ||
    type === 'textarea' ||
    type === 'select' ||
    type === 'checkbox' ||
    type === 'radio' ||
    type === 'toggle' ||
    type === 'file-upload' ||
    type === 'search'
  );
}

function pushUnique(seen: Set<string>, plans: A11ySubcasePlan[], plan: A11ySubcasePlan): void {
  if (seen.has(plan.subcaseId)) return;
  seen.add(plan.subcaseId);
  plans.push(plan);
}

/**
 * Build one a11y plan set for a screen from discovery evidence only.
 * No interactive non-decorative elements → single a11y-none NOT_APPLICABLE (never PASS).
 */
export function buildA11yPlansForScreen(input: {
  screen: DiscoveredScreen;
  elements: UiElementRecord[];
  options?: A11yPlanningOptions;
}): A11yCaseResult {
  const { screen, elements, options } = input;
  const plans: A11ySubcasePlan[] = [];
  const seen = new Set<string>();
  const existingNames = options?.existingAccessibleNameElementIds ?? new Set<string>();

  const interactive = elements.filter(isInteractiveForA11y);

  if (interactive.length === 0) {
    pushUnique(seen, plans, {
      subcaseId: 'a11y-none',
      kind: 'accessible-name',
      title: `${screen.url} — accessibility (no interactive elements)`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'accessibility',
      reason: statusReason(
        'NOT_APPLICABLE',
        'no interactive elements on this screen'
      ),
    });
    return { plans };
  }

  const screenLabel = screen.url;

  // a11y-keyboard — never executed in this planner task
  pushUnique(seen, plans, {
    subcaseId: 'a11y-keyboard',
    kind: 'keyboard-focus',
    title: `${screenLabel} — accessibility keyboard navigation`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'accessibility',
    reason: statusReason('NOT_TESTED', 'keyboard navigation was not executed'),
  });

  // a11y-focus — PLANNED observe only with tabindex / focusable flag evidence
  const focusEvidence = interactive.filter(hasFocusEvidence);
  if (focusEvidence.length > 0) {
    const listed = focusEvidence.map(describeElement).join(', ');
    pushUnique(seen, plans, {
      subcaseId: 'a11y-focus',
      kind: 'keyboard-focus',
      title: `${screenLabel} — accessibility focus evidence`,
      status: 'PLANNED',
      action: 'observe',
      category: 'accessibility',
      expect: {
        note: observeNote(
          `observe recorded tabindex/focusable evidence for: ${listed}; focus order was not claimed`
        ),
      },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'a11y-focus',
      kind: 'keyboard-focus',
      title: `${screenLabel} — accessibility focus`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'accessibility',
      reason: statusReason('NOT_TESTED', 'focus was not executed'),
    });
  }

  // a11y-labels
  const labeled = interactive.filter(hasLabelOrName);
  if (labeled.length > 0) {
    const listed = labeled.map(describeElement).join(', ');
    pushUnique(seen, plans, {
      subcaseId: 'a11y-labels',
      kind: 'accessible-name',
      title: `${screenLabel} — accessibility labels`,
      status: 'PLANNED',
      action: 'observe',
      category: 'accessibility',
      expect: {
        note: observeNote(`observe labels/accessible names in scan for: ${listed}`),
      },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'a11y-labels',
      kind: 'accessible-name',
      title: `${screenLabel} — accessibility labels`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'accessibility',
      reason: statusReason('NOT_TESTED', 'no labels in scan evidence'),
    });
  }

  // a11y-accessible-name — skip per-element duplicate when inventory already recorded the name fact
  const namedInteractive = interactive.filter(hasLabelOrName);
  const namedWithoutDuplicate = namedInteractive.filter(
    (el) => !existingNames.has(el.elementId)
  );
  const missingName = interactive.filter((el) => !hasLabelOrName(el));

  if (namedInteractive.length > 0) {
    // Screen-level aggregate: still PLANNED when names exist; list only elements
    // that do not already have an accessibility accessible-name row for the same fact.
    const listSource =
      namedWithoutDuplicate.length > 0 ? namedWithoutDuplicate : namedInteractive;
    const listed = listSource.map(describeElement).join(', ');
    const duplicateNote =
      namedWithoutDuplicate.length === 0
        ? ' (accessible-name fact already recorded per element; screen row observes the same scan evidence without a second PASS)'
        : namedWithoutDuplicate.length < namedInteractive.length
          ? ' (skipped elements that already have an accessibility accessible-name scenario row)'
          : '';
    pushUnique(seen, plans, {
      subcaseId: 'a11y-accessible-name',
      kind: 'accessible-name',
      title: `${screenLabel} — accessibility accessible names`,
      status: 'PLANNED',
      action: 'observe',
      category: 'accessibility',
      expect: {
        note: observeNote(
          `observe accessible names in scan for: ${listed}${duplicateNote}`
        ),
        accessibleName: listSource[0] ? elementLabel(listSource[0]) : undefined,
      },
    });
  }

  if (missingName.length > 0) {
    const listed = missingName.map(describeElement).join(', ');
    pushUnique(seen, plans, {
      subcaseId: 'a11y-accessible-name-missing',
      kind: 'accessible-name',
      title: `${screenLabel} — accessibility missing accessible names`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'accessibility',
      reason: statusReason(
        'NOT_TESTED',
        `some interactive elements have no accessible name: ${listed}`
      ),
    });
    for (const el of missingName) {
      if (existingNames.has(el.elementId)) continue;
      const perId: A11ySubcaseId = `a11y-accessible-name-missing-${el.elementId}`;
      if (seen.has(perId)) continue;
      seen.add(perId);
      plans.push({
        subcaseId: perId,
        kind: 'accessible-name',
        title: `${screenLabel} — accessibility missing name (${el.elementId})`,
        status: 'NOT_TESTED',
        action: 'none',
        category: 'accessibility',
        targetElementId: el.elementId,
        reason: statusReason(
          'NOT_TESTED',
          `some interactive elements have no accessible name (${el.elementId})`
        ),
      });
    }
  }

  // a11y-aria
  const ariaElements = interactive.filter(hasAriaEvidence);
  if (ariaElements.length > 0) {
    const listed = ariaElements.map(describeElement).join(', ');
    pushUnique(seen, plans, {
      subcaseId: 'a11y-aria',
      kind: 'accessible-name',
      title: `${screenLabel} — accessibility ARIA attributes`,
      status: 'PLANNED',
      action: 'observe',
      category: 'accessibility',
      expect: {
        note: observeNote(`observe role/aria-* attributes in scan for: ${listed}`),
      },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'a11y-aria',
      kind: 'accessible-name',
      title: `${screenLabel} — accessibility ARIA attributes`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'accessibility',
      reason: statusReason('NOT_TESTED', 'ARIA attributes were not in the scan'),
    });
  }

  // a11y-tab-order — never executed
  pushUnique(seen, plans, {
    subcaseId: 'a11y-tab-order',
    kind: 'keyboard-focus',
    title: `${screenLabel} — accessibility tab order`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'accessibility',
    reason: statusReason('NOT_TESTED', 'tab order was not executed'),
  });

  // a11y-contrast — never measured; never invent a ratio
  pushUnique(seen, plans, {
    subcaseId: 'a11y-contrast',
    kind: 'visibility',
    title: `${screenLabel} — accessibility contrast`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'accessibility',
    reason: statusReason('NOT_TESTED', 'contrast was not measured'),
  });

  // a11y-screen-reader — never executed
  pushUnique(seen, plans, {
    subcaseId: 'a11y-screen-reader',
    kind: 'accessible-name',
    title: `${screenLabel} — accessibility screen-reader semantics`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'accessibility',
    reason: statusReason('NOT_TESTED', 'screen reader semantics were not executed'),
  });

  // a11y-disabled — observe only; never click
  const disabled = interactive.filter(isDisabledControl);
  if (disabled.length > 0) {
    const listed = disabled.map(describeElement).join(', ');
    pushUnique(seen, plans, {
      subcaseId: 'a11y-disabled',
      kind: 'enabled-state',
      title: `${screenLabel} — accessibility disabled state`,
      status: 'PLANNED',
      action: 'observe',
      category: 'accessibility',
      targetElementId: disabled[0]?.elementId,
      expect: {
        enabled: false,
        note: observeNote(
          `observe disabled controls in scan (no click): ${listed}`
        ),
      },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'a11y-disabled',
      kind: 'enabled-state',
      title: `${screenLabel} — accessibility disabled state`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'accessibility',
      reason: statusReason('NOT_APPLICABLE', 'no disabled control in the scan'),
    });
  }

  // a11y-error-announcement
  const alerts = elements.filter(hasErrorAnnouncementEvidence);
  if (alerts.length > 0) {
    const listed = alerts.map(describeElement).join(', ');
    pushUnique(seen, plans, {
      subcaseId: 'a11y-error-announcement',
      kind: 'accessible-name',
      title: `${screenLabel} — accessibility error announcement`,
      status: 'PLANNED',
      action: 'observe',
      category: 'accessibility',
      targetElementId: alerts[0]?.elementId,
      expect: {
        note: observeNote(
          `observe role=alert / aria-live in scan for: ${listed}`
        ),
      },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'a11y-error-announcement',
      kind: 'accessible-name',
      title: `${screenLabel} — accessibility error announcement`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'accessibility',
      reason: statusReason('NOT_TESTED', 'error announcement was not in the scan'),
    });
  }

  // a11y-form-labels
  const fields = elements.filter(isFillableField);
  if (fields.length === 0) {
    pushUnique(seen, plans, {
      subcaseId: 'a11y-form-labels',
      kind: 'form-presence',
      title: `${screenLabel} — accessibility form labels`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'accessibility',
      reason: statusReason('NOT_APPLICABLE', 'no form fields'),
    });
  } else {
    const withNames = fields.filter(hasLabelOrName);
    const withoutNames = fields.filter((el) => !hasLabelOrName(el));
    const listedPresent = withNames.map(describeElement).join(', ');
    if (withoutNames.length > 0) {
      const listedMissing = withoutNames.map(describeElement).join(', ');
      pushUnique(seen, plans, {
        subcaseId: 'a11y-form-labels',
        kind: 'form-presence',
        title: `${screenLabel} — accessibility form labels`,
        status: 'NOT_TESTED',
        action: 'none',
        category: 'accessibility',
        reason: statusReason(
          'NOT_TESTED',
          `form field(s) with no accessible name: ${listedMissing}` +
            (listedPresent ? `; labelled fields observed: ${listedPresent}` : '')
        ),
      });
    } else {
      pushUnique(seen, plans, {
        subcaseId: 'a11y-form-labels',
        kind: 'form-presence',
        title: `${screenLabel} — accessibility form labels`,
        status: 'PLANNED',
        action: 'observe',
        category: 'accessibility',
        expect: {
          note: observeNote(
            `observe form field label presence in scan for: ${listedPresent}`
          ),
        },
      });
    }
  }

  return { plans };
}
