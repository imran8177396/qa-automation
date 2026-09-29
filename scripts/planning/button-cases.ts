/**
 * Button behavior analysis and button test plans for the existing planner.
 * Consumed only by buildScenarioInventory → planButton — not a second planner.
 * Evidence-only: never invent destinations, APIs, modals, or clicks.
 * Never emits PLANNED for delete, submit, or download execution. Never PASS.
 */

import { authorize, classify, type SafetyConfigResolved } from '../core/safety-policy';
import {
  DEFAULT_ENVIRONMENT,
  productionActionAllowed,
  type QaEnvironmentName,
} from '../core/platform/environment';
import type { ElementKind } from '../discovery/element-kind';
import type { DiscoveredScreen } from '../discovery/screens';
import { canonicalScreenUrl } from '../discovery/screens';
import type { UiElementRecord } from '../discovery/ui-scan';
import type {
  CheckKind,
  CheckStatus,
  ControlKind,
  ElementPurpose,
  InventoryCategory,
  PlannedAction,
  PlannedCheck,
} from './types';

const SKIP_HREF = /^(mailto:|tel:|javascript:|#)/i;
const DESTRUCTIVE_QUERY = /[?&](action|do|cmd)=(delete|remove|cancel|deactivate)/i;
const CONFIRM_DIALOG_NAME = /confirm|delete/i;
const STATE_CHANGE_KINDS = new Set<ElementKind>([
  'submit-button',
  'delete-button',
  'save-button',
  'reset-button',
  'upload-button',
]);

const BUTTON_KINDS = new Set<ElementKind>([
  'button',
  'submit-button',
  'reset-button',
  'delete-button',
  'edit-button',
  'save-button',
  'cancel-button',
  'download-button',
  'upload-button',
  'copy-button',
  'share-button',
  'refresh-button',
  'load-more-button',
]);

export type ButtonBehaviorToken =
  | 'navigate'
  | 'modal'
  | 'submit'
  | 'api'
  | 'state-change'
  | 'download'
  | 'delete'
  | 'async';

export type BehaviorObservation = 'observed' | 'unknown';

export interface ButtonBehaviorEvidence {
  token: ButtonBehaviorToken;
  status: BehaviorObservation;
}

export interface InferredButtonBehavior {
  tokens: ButtonBehaviorEvidence[];
  /** True when none of navigate/modal/submit/api/download/delete are observed. */
  undetermined: boolean;
}

export type ButtonSubcaseId =
  | 'button-delete-valid'
  | 'button-delete-missing'
  | 'button-delete-unauthorized'
  | 'button-delete-forbidden'
  | 'button-delete-double-click'
  | 'button-delete-rapid'
  | 'button-delete-already-deleted'
  | 'button-delete-network'
  | 'button-delete-confirm'
  | 'button-delete-cancel'
  | 'button-delete-remains'
  | 'button-submit'
  | 'button-submit-api'
  | 'button-navigate'
  | 'button-download'
  | 'button-behavior-undetermined';

export interface ButtonSubcasePlan {
  subcaseId: ButtonSubcaseId;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  category: InventoryCategory;
  reason?: string;
  expect?: PlannedCheck['expect'];
}

export interface ButtonCaseResult {
  plans: ButtonSubcasePlan[];
  behavior: InferredButtonBehavior;
  exclusions: string[];
}

export interface ButtonPlanningOptions {
  /** Defaults to development. Never reads qa.last-target.json. */
  environment?: QaEnvironmentName;
  /** Defaults to false. Never set true from config in this module. */
  authorizeDestructive?: boolean;
}

const DETERMINING_TOKENS: ButtonBehaviorToken[] = [
  'navigate',
  'modal',
  'submit',
  'api',
  'download',
  'delete',
];

function pushUnique(seen: Set<string>, plans: ButtonSubcasePlan[], plan: ButtonSubcasePlan): void {
  if (seen.has(plan.subcaseId)) return;
  seen.add(plan.subcaseId);
  plans.push(plan);
}

function resolveKind(element: UiElementRecord, kind?: ElementKind): ElementKind {
  return kind ?? element.elementKind ?? 'unknown';
}

function hasDownloadAttribute(element: UiElementRecord): boolean {
  const attrs = element.attributes ?? {};
  return Object.prototype.hasOwnProperty.call(attrs, 'download') || attrs.download != null;
}

function hasSafeHref(element: UiElementRecord, pageUrl: string, safety: SafetyConfigResolved): boolean {
  const href = (element.href ?? '').trim();
  if (!href || SKIP_HREF.test(href)) return false;
  if (DESTRUCTIVE_QUERY.test(href)) return false;
  const risk = classify(
    {
      text: element.accessibleName ?? undefined,
      href,
      formMethod: element.formMethod ?? (element.isSubmit ? 'POST' : undefined),
      pageUrl,
      selector: element.locator ?? undefined,
    },
    safety
  );
  if (risk === 'destructive') return false;
  return authorize({ kind: 'click-link', correlatesWithStateChange: false });
}

function isStateChangingButton(
  element: UiElementRecord,
  kind: ElementKind,
  pageUrl: string,
  safety: SafetyConfigResolved
): boolean {
  if (STATE_CHANGE_KINDS.has(kind) || element.isSubmit) return true;
  const href = element.href ?? undefined;
  if (href && DESTRUCTIVE_QUERY.test(href)) return true;
  const risk = classify(
    {
      text: element.accessibleName ?? undefined,
      href,
      formMethod: element.formMethod ?? (element.isSubmit ? 'POST' : undefined),
      pageUrl,
      selector: element.locator ?? undefined,
    },
    safety
  );
  return risk === 'destructive';
}

function hasOpenDialogOnSameUrl(pageUrl: string, screens: DiscoveredScreen[]): boolean {
  const key = canonicalScreenUrl(pageUrl);
  return screens.some(
    (screen) =>
      canonicalScreenUrl(screen.url) === key &&
      (screen.state === 'dialog' || screen.state === 'modal' || screen.state === 'drawer')
  );
}

function isDialogLikeElement(el: UiElementRecord): boolean {
  const kind = el.elementKind;
  if (kind === 'dialog' || kind === 'modal' || kind === 'drawer') return true;
  if (el.elementType === 'modal' || el.elementType === 'drawer') return true;
  const role = (el.attributes?.role ?? '').toLowerCase();
  if (role === 'dialog' || role === 'alertdialog') return true;
  if (el.attributes?.['aria-modal'] === 'true') return true;
  return false;
}

function findConfirmDialog(pageElements: UiElementRecord[], pageUrl: string): UiElementRecord | undefined {
  return pageElements.find((el) => {
    if (el.page !== pageUrl) return false;
    if (!isDialogLikeElement(el)) return false;
    const name = `${el.accessibleName ?? ''} ${el.label ?? ''}`.trim();
    return CONFIRM_DIALOG_NAME.test(name);
  });
}

function findCancelButton(pageElements: UiElementRecord[], pageUrl: string): UiElementRecord | undefined {
  return pageElements.find((el) => {
    if (el.page !== pageUrl) return false;
    if (el.elementKind === 'cancel-button') return true;
    const name = (el.accessibleName ?? '').trim();
    return (
      (el.elementType === 'button' || el.elementKind === 'button') && /^cancel\b/i.test(name)
    );
  });
}

function observedRequestUrl(element: UiElementRecord): string | undefined {
  const url = (element.requestUrl ?? '').trim();
  return url.length > 0 ? url : undefined;
}

/**
 * Infer button behavior tokens from discovery evidence only.
 * Tokens are observed or unknown — never invented.
 */
export function inferButtonBehavior(input: {
  element: UiElementRecord;
  kind?: ElementKind;
  pageUrl: string;
  safety: SafetyConfigResolved;
  pageElements?: UiElementRecord[];
  screens?: DiscoveredScreen[];
}): InferredButtonBehavior {
  const { element, pageUrl, safety } = input;
  const kind = resolveKind(element, input.kind);
  const pageElements = input.pageElements ?? [];
  const screens = input.screens ?? [];

  const hasPopupDialog = (element.attributes?.['aria-haspopup'] ?? '').toLowerCase() === 'dialog';
  const modalObserved = hasPopupDialog || hasOpenDialogOnSameUrl(pageUrl, screens);
  const submitObserved =
    Boolean(element.isSubmit) ||
    kind === 'submit-button' ||
    (element.inputType ?? element.attributes?.type ?? '').toLowerCase() === 'submit';
  const apiObserved = Boolean(observedRequestUrl(element));
  const downloadObserved = kind === 'download-button' || hasDownloadAttribute(element);
  const deleteObserved = kind === 'delete-button';
  const navigateObserved = hasSafeHref(element, pageUrl, safety);
  const stateObserved = isStateChangingButton(element, kind, pageUrl, safety);
  const asyncBusy = (element.attributes?.['aria-busy'] ?? '').toLowerCase() === 'true';

  const tokens: ButtonBehaviorEvidence[] = [
    { token: 'navigate', status: navigateObserved ? 'observed' : 'unknown' },
    { token: 'modal', status: modalObserved ? 'observed' : 'unknown' },
    { token: 'submit', status: submitObserved ? 'observed' : 'unknown' },
    { token: 'api', status: apiObserved ? 'observed' : 'unknown' },
    { token: 'state-change', status: stateObserved ? 'observed' : 'unknown' },
    { token: 'download', status: downloadObserved ? 'observed' : 'unknown' },
    { token: 'delete', status: deleteObserved ? 'observed' : 'unknown' },
    { token: 'async', status: asyncBusy ? 'observed' : 'unknown' },
  ];

  const undetermined = !tokens.some(
    (t) => DETERMINING_TOKENS.includes(t.token) && t.status === 'observed'
  );

  return { tokens, undetermined };
}

/** True when this element should receive button-* inventory rows. */
export function isButtonKindForPlanning(
  purpose: ElementPurpose,
  kind: ElementKind | undefined
): boolean {
  if (kind === 'decorative') return false;
  if (kind && BUTTON_KINDS.has(kind)) return true;
  if (purpose === 'button') return true;
  if (kind && typeof kind === 'string' && kind.endsWith('-button')) return true;
  return false;
}

function productionBlocksDestructive(
  environment: QaEnvironmentName,
  authorizeDestructive: boolean
): boolean {
  if (environment === 'production') return true;
  const destructive = productionActionAllowed('destructive', environment, { authorizeDestructive });
  const mutation = productionActionAllowed('data-mutation', environment, { authorizeDestructive });
  return !destructive.allowed || !mutation.allowed;
}

const PRODUCTION_BLOCK_REASON =
  'BLOCKED: destructive or state-changing button test is not authorized against production';

/** Shared safety string — form / submit-button plans never authorize submission. */
export const FORM_SUBMIT_NOT_AUTHORIZED_REASON =
  'BLOCKED: form submission is not authorized for generated checks (safety policy — no submit)';

/** Shared safety string — reset is never executed by generated checks. */
export const FORM_RESET_NOT_PERFORMED_REASON = 'BLOCKED: reset is not performed';

/**
 * Status for delete/submit/download execution rows.
 * Planner never emits PLANNED for these — only BLOCKED vs NOT_TESTED.
 */
function executionGate(
  environment: QaEnvironmentName,
  authorizeDestructive: boolean,
  blockedReason: string,
  notTestedReason: string
): { status: CheckStatus; reason: string } {
  if (productionBlocksDestructive(environment, authorizeDestructive)) {
    return { status: 'BLOCKED', reason: PRODUCTION_BLOCK_REASON };
  }
  if (!authorizeDestructive) {
    return { status: 'BLOCKED', reason: blockedReason.startsWith('BLOCKED:') ? blockedReason : `BLOCKED: ${blockedReason}` };
  }
  return {
    status: 'NOT_TESTED',
    reason: notTestedReason.startsWith('NOT_TESTED:') ? notTestedReason : `NOT_TESTED: ${notTestedReason}`,
  };
}

function planDeleteRows(input: {
  label: string;
  control: ControlKind;
  pageUrl: string;
  pageElements: UiElementRecord[];
  environment: QaEnvironmentName;
  authorizeDestructive: boolean;
}): ButtonSubcasePlan[] {
  const { label, control, pageUrl, pageElements, environment, authorizeDestructive } = input;
  const plans: ButtonSubcasePlan[] = [];
  const seen = new Set<string>();

  const validGate = executionGate(
    environment,
    authorizeDestructive,
    'delete valid record is not executed; destructive action is not authorized',
    'deletion is not executed by the planner'
  );
  pushUnique(seen, plans, {
    subcaseId: 'button-delete-valid',
    kind: 'click-behavior',
    title: `${label} — button-delete-valid`,
    status: validGate.status,
    action: 'none',
    category: 'positive',
    reason: validGate.reason,
  });

  const notTested = (subcaseId: ButtonSubcaseId, category: InventoryCategory, reason: string): void => {
    pushUnique(seen, plans, {
      subcaseId,
      kind: 'click-behavior',
      title: `${label} — ${subcaseId}`,
      status: 'NOT_TESTED',
      action: 'none',
      category,
      reason: reason.startsWith('NOT_TESTED:') ? reason : `NOT_TESTED: ${reason}`,
    });
  };

  notTested('button-delete-missing', 'negative', 'nonexistent record was not in discovery evidence');
  notTested('button-delete-unauthorized', 'negative', 'no authorization matrix was discovered');
  notTested('button-delete-forbidden', 'negative', 'no authorization matrix was discovered');
  notTested('button-delete-double-click', 'boundary', 'double click was not observed in discovery');
  notTested('button-delete-rapid', 'boundary', 'rapid clicks were not observed in discovery');
  notTested('button-delete-already-deleted', 'boundary', 'already-deleted state was not in discovery evidence');
  notTested('button-delete-network', 'boundary', 'network failure during deletion is not simulated');

  const confirmDialog = findConfirmDialog(pageElements, pageUrl);
  if (confirmDialog) {
    pushUnique(seen, plans, {
      subcaseId: 'button-delete-confirm',
      kind: 'visibility',
      title: `${label} — button-delete-confirm`,
      status: 'PLANNED',
      action: 'observe',
      category: 'validation',
      reason: 'confirmation dialog was present in the scan',
      expect: {
        locator: confirmDialog.locator ?? undefined,
        accessibleName: confirmDialog.accessibleName,
        visible: true,
        control,
        note: 'confirmation dialog was present in the scan',
      },
    });
  } else {
    notTested(
      'button-delete-confirm',
      'validation',
      'confirmation modal was not open in the crawled DOM'
    );
  }

  const cancel = findCancelButton(pageElements, pageUrl);
  if (cancel) {
    pushUnique(seen, plans, {
      subcaseId: 'button-delete-cancel',
      kind: 'visibility',
      title: `${label} — button-delete-cancel`,
      status: 'PLANNED',
      action: 'observe',
      category: 'validation',
      reason: 'cancel is observed; deletion is not performed',
      expect: {
        locator: cancel.locator ?? undefined,
        accessibleName: cancel.accessibleName,
        visible: true,
        control: 'button',
        note: 'cancel is observed; deletion is not performed',
      },
    });
  } else {
    notTested('button-delete-cancel', 'validation', 'cancel control was not discovered');
  }

  notTested(
    'button-delete-remains',
    'validation',
    'record presence after cancel was not observed because deletion is not executed'
  );

  return plans;
}

function planSubmitRows(input: {
  label: string;
  element: UiElementRecord;
  environment: QaEnvironmentName;
  authorizeDestructive: boolean;
}): ButtonSubcasePlan[] {
  const { label, element, environment, authorizeDestructive } = input;
  const plans: ButtonSubcasePlan[] = [];
  const seen = new Set<string>();

  const submitStatus = productionBlocksDestructive(environment, authorizeDestructive)
    ? { status: 'BLOCKED' as const, reason: PRODUCTION_BLOCK_REASON }
    : {
        status: 'BLOCKED' as const,
        reason: FORM_SUBMIT_NOT_AUTHORIZED_REASON,
      };

  pushUnique(seen, plans, {
    subcaseId: 'button-submit',
    kind: 'form-submit',
    title: `${label} — button-submit`,
    status: submitStatus.status,
    action: 'none',
    category: 'positive',
    reason: submitStatus.reason,
  });

  const apiUrl = observedRequestUrl(element);
  pushUnique(seen, plans, {
    subcaseId: 'button-submit-api',
    kind: 'click-behavior',
    title: `${label} — button-submit-api`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'positive',
    reason: apiUrl
      ? 'NOT_TESTED: API URL was recorded but the request is not sent'
      : 'NOT_TESTED: no API request was observed',
    expect: apiUrl ? { href: apiUrl, note: 'URL recorded; request is not sent' } : undefined,
  });

  return plans;
}

function planNavigateRow(input: {
  element: UiElementRecord;
  label: string;
  control: ControlKind;
  locator: string;
  pageUrl: string;
  safety: SafetyConfigResolved;
}): ButtonSubcasePlan {
  const { element, label, control, locator, pageUrl, safety } = input;
  const href = (element.href ?? '').trim();
  const safe = hasSafeHref(element, pageUrl, safety);

  if (!href || SKIP_HREF.test(href)) {
    return {
      subcaseId: 'button-navigate',
      kind: 'link-href',
      title: `${label} — button-navigate`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'positive',
      reason: 'NOT_TESTED: no safe navigation destination discovered',
    };
  }

  if (!safe) {
    return {
      subcaseId: 'button-navigate',
      kind: 'link-href',
      title: `${label} — button-navigate`,
      status: 'BLOCKED',
      action: 'none',
      category: 'positive',
      reason: 'BLOCKED: href is state-changing or destructive — navigation click is not authorized',
    };
  }

  return {
    subcaseId: 'button-navigate',
    kind: 'link-href',
    title: `${label} — button-navigate`,
    status: 'PLANNED',
    action: 'observe',
    category: 'positive',
    reason: 'observe destination href only; no browser navigation is performed by the planner',
    expect: { locator, href, control },
  };
}

function planDownloadRow(input: {
  label: string;
  environment: QaEnvironmentName;
  authorizeDestructive: boolean;
}): ButtonSubcasePlan {
  const { label, environment, authorizeDestructive } = input;
  if (productionBlocksDestructive(environment, authorizeDestructive)) {
    return {
      subcaseId: 'button-download',
      kind: 'click-behavior',
      title: `${label} — button-download`,
      status: 'BLOCKED',
      action: 'none',
      category: 'positive',
      reason: PRODUCTION_BLOCK_REASON,
    };
  }
  if (!authorizeDestructive) {
    return {
      subcaseId: 'button-download',
      kind: 'click-behavior',
      title: `${label} — button-download`,
      status: 'BLOCKED',
      action: 'none',
      category: 'positive',
      reason: 'BLOCKED: download is not performed without authorization',
    };
  }
  return {
    subcaseId: 'button-download',
    kind: 'click-behavior',
    title: `${label} — button-download`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'positive',
    reason: 'NOT_TESTED: file download is not performed during planning',
  };
}

/**
 * Build button-* subcases from discovery evidence only.
 * Never clicks, submits, deletes, or downloads. Never marks unobserved actions PASS.
 */
export function buildButtonSubcases(input: {
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  label: string;
  locator: string;
  kind?: ElementKind;
  pageUrl: string;
  safety: SafetyConfigResolved;
  pageElements?: UiElementRecord[];
  screens?: DiscoveredScreen[];
  options?: ButtonPlanningOptions;
}): ButtonCaseResult {
  const kind = resolveKind(input.element, input.kind);
  const pageElements = input.pageElements ?? [];
  const screens = input.screens ?? [];
  const environment = input.options?.environment ?? DEFAULT_ENVIRONMENT;
  const authorizeDestructive = input.options?.authorizeDestructive === true;

  if (kind === 'decorative' || !isButtonKindForPlanning(input.purpose, kind)) {
    return {
      plans: [],
      behavior: { tokens: [], undetermined: true },
      exclusions: [],
    };
  }

  const behavior = inferButtonBehavior({
    element: input.element,
    kind,
    pageUrl: input.pageUrl,
    safety: input.safety,
    pageElements,
    screens,
  });

  const plans: ButtonSubcasePlan[] = [];
  const seen = new Set<string>();
  const token = (name: ButtonBehaviorToken): boolean =>
    behavior.tokens.some((t) => t.token === name && t.status === 'observed');

  if (token('delete') || kind === 'delete-button') {
    for (const plan of planDeleteRows({
      label: input.label,
      control: input.control,
      pageUrl: input.pageUrl,
      pageElements,
      environment,
      authorizeDestructive,
    })) {
      pushUnique(seen, plans, plan);
    }
  }

  if (token('submit')) {
    for (const plan of planSubmitRows({
      label: input.label,
      element: input.element,
      environment,
      authorizeDestructive,
    })) {
      pushUnique(seen, plans, plan);
    }
  }

  if (token('navigate')) {
    pushUnique(
      seen,
      plans,
      planNavigateRow({
        element: input.element,
        label: input.label,
        control: input.control,
        locator: input.locator,
        pageUrl: input.pageUrl,
        safety: input.safety,
      })
    );
  } else if ((input.element.href ?? '').trim() && !SKIP_HREF.test(input.element.href ?? '')) {
    // Href present but not navigate-allowed (destructive / state-changing).
    pushUnique(
      seen,
      plans,
      planNavigateRow({
        element: input.element,
        label: input.label,
        control: input.control,
        locator: input.locator,
        pageUrl: input.pageUrl,
        safety: input.safety,
      })
    );
  }

  if (token('download')) {
    pushUnique(
      seen,
      plans,
      planDownloadRow({
        label: input.label,
        environment,
        authorizeDestructive,
      })
    );
  }

  if (behavior.undetermined) {
    pushUnique(seen, plans, {
      subcaseId: 'button-behavior-undetermined',
      kind: 'click-behavior',
      title: `${input.label} — button-behavior-undetermined`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'positive',
      reason: 'NOT_TESTED: button behavior was not determined from discovery evidence',
    });
  }

  // Safety invariant: never PLANNED with click/submit for delete/submit/download execution ids.
  for (const plan of plans) {
    if (
      plan.subcaseId === 'button-delete-valid' ||
      plan.subcaseId === 'button-submit' ||
      plan.subcaseId === 'button-download'
    ) {
      if (plan.status === 'PLANNED') {
        plan.status = 'BLOCKED';
        plan.action = 'none';
        plan.reason =
          plan.reason ??
          'BLOCKED: destructive or state-changing button test is not authorized';
      }
      if (plan.action === 'click-button' || plan.action === ('submit' as PlannedAction)) {
        plan.action = 'none';
      }
    }
  }

  return { plans, behavior, exclusions: [] };
}
