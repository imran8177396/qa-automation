/**
 * Form-level identification and fill plans for the existing planner.
 * Consumed only by buildScenarioInventory → planForm — not a second planner.
 * One FORM-NNN plan set per detected form on a screen. Never submit, reset, or PASS.
 * Never invent validation rules, success pages, or API errors.
 */

import {
  elementCategoryFromKind,
  FILLABLE_ELEMENT_KINDS,
  purposeFromElementKind,
  type ElementKind,
} from '../discovery/element-kind';
import {
  canonicalScreenUrl,
  type DiscoveredScreen,
  type ValidationRule,
} from '../discovery/screens';
import type { UiElementRecord } from '../discovery/ui-scan';
import {
  FORM_RESET_NOT_PERFORMED_REASON,
  FORM_SUBMIT_NOT_AUTHORIZED_REASON,
} from './button-cases';
import { buildEdgeSubcases } from './edge-cases';
import { buildNegativeSubcases } from './negative-cases';
import { buildPositiveSubcases } from './positive-cases';
import type {
  CheckKind,
  CheckStatus,
  ControlKind,
  ElementPurpose,
  InventoryCategory,
  PlannedAction,
  PlannedCheck,
} from './types';

const FILLABLE_CATEGORIES = new Set([
  'input',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'file-upload',
  'date-picker',
  'search',
]);

export type FormSubcaseId =
  | 'form-fields'
  | 'form-required'
  | 'form-optional'
  | 'form-validation'
  | 'form-submit'
  | 'form-reset'
  | 'form-success'
  | 'form-error'
  | 'form-all-valid'
  | 'form-all-invalid'
  | 'form-missing-required'
  | 'form-multiple-invalid'
  | 'form-empty'
  | 'form-boundary'
  | 'form-duplicate-submission'
  | 'form-rapid-submission'
  | 'form-server-error'
  | 'form-network-failure'
  | 'form-session-expiration'
  | `form-missing-required-${string}`;

export interface FormSubcasePlan {
  subcaseId: FormSubcaseId;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  category?: InventoryCategory;
  reason?: string;
  expect?: PlannedCheck['expect'];
  /** Field elementId for missing-required rows; otherwise the form id. */
  targetElementId?: string;
}

export interface FormCaseResult {
  formId: string;
  plans: FormSubcasePlan[];
}

export interface FormPlanningOptions {
  /** True only when auth session evidence was passed into planning. Never inferred. */
  hasAuthSession?: boolean;
}

/** Element may carry published validation[] / three-state required from screen inventory. */
export type FormPlanElement = UiElementRecord & {
  validation?: ValidationRule[];
};

interface DetectedForm {
  formId: string;
  /** Scan form container elementId when grouping used a real form node. */
  containerElementId?: string;
  fields: FormPlanElement[];
  submit?: FormPlanElement;
  reset?: FormPlanElement;
}

function pushUnique(seen: Set<string>, plans: FormSubcasePlan[], plan: FormSubcasePlan): void {
  if (seen.has(plan.subcaseId)) return;
  seen.add(plan.subcaseId);
  plans.push(plan);
}

function resolveKind(el: FormPlanElement): ElementKind {
  return (el.elementKind ?? el.type ?? 'unknown') as ElementKind;
}

function isFillableField(el: FormPlanElement): boolean {
  const kind = resolveKind(el);
  if (kind === 'decorative' || kind === 'submit-button' || kind === 'reset-button') return false;
  if (FILLABLE_ELEMENT_KINDS.has(kind)) return true;
  if (kind === 'file-upload' || kind === 'date-picker') return true;
  const category = elementCategoryFromKind(kind, { tag: el.tag, href: el.href });
  if (FILLABLE_CATEGORIES.has(category)) return true;
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

function isSubmitControl(el: FormPlanElement): boolean {
  const kind = resolveKind(el);
  if (kind === 'submit-button' || el.isSubmit) return true;
  const inputType = (el.inputType ?? el.attributes?.type ?? '').toLowerCase();
  return inputType === 'submit';
}

function isResetControl(el: FormPlanElement): boolean {
  const kind = resolveKind(el);
  if (kind === 'reset-button') return true;
  const inputType = (el.inputType ?? el.attributes?.type ?? '').toLowerCase();
  return inputType === 'reset';
}

function isFormContainer(el: FormPlanElement): boolean {
  return el.elementType === 'form' || resolveKind(el) === 'form';
}

/**
 * required === true only; required === false only; omit/undefined → unknown.
 * Does not invent required from unrelated attributes beyond aria-required / required attr.
 */
export function requiredState(el: FormPlanElement): boolean | undefined {
  const attrs = el.attributes ?? {};
  if (attrs['aria-required'] === 'true') return true;
  if (attrs['aria-required'] === 'false') return false;
  if (Object.prototype.hasOwnProperty.call(attrs, 'required')) {
    return attrs['required'] !== 'false';
  }
  if (Object.prototype.hasOwnProperty.call(el, 'required') && typeof el.required === 'boolean') {
    return el.required;
  }
  return undefined;
}

/** Copy existing validation[] only — never synthesize rules. */
export function existingValidation(el: FormPlanElement): ValidationRule[] {
  if (!Array.isArray(el.validation)) return [];
  return el.validation.filter(
    (rule) =>
      rule &&
      typeof rule === 'object' &&
      typeof (rule as ValidationRule).kind === 'string'
  );
}

function containerDomId(el: FormPlanElement): string | undefined {
  const id = (el.attributes?.id ?? '').trim();
  return id.length > 0 ? id : undefined;
}

function fieldFormAttr(el: FormPlanElement): string | undefined {
  const form = (el.attributes?.form ?? '').trim();
  return form.length > 0 ? form : undefined;
}

function controlOf(el: FormPlanElement): ControlKind {
  const purpose = purposeOf(el);
  switch (purpose) {
    case 'select':
      return 'select';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'button':
      return 'button';
    case 'navigation-link':
      return 'link';
    default:
      return 'text';
  }
}

function purposeOf(el: FormPlanElement): ElementPurpose {
  const kind = resolveKind(el);
  if (kind !== 'unknown' || el.elementKind) {
    return purposeFromElementKind(kind);
  }
  const inputType = (el.inputType ?? '').toLowerCase();
  if (el.elementType === 'form') return 'form';
  if (el.elementType === 'link' || el.elementType === 'navigation') return 'navigation-link';
  if (el.elementType === 'button') return 'button';
  if (el.elementType === 'select') return 'select';
  if (el.elementType === 'checkbox' || el.elementType === 'toggle') return 'checkbox';
  if (el.elementType === 'radio') return 'radio';
  if (inputType === 'password') return 'password-input';
  if (inputType === 'hidden') return 'hidden-input';
  if (
    el.elementType === 'input' ||
    el.elementType === 'textarea' ||
    el.elementType === 'search' ||
    el.elementType === 'file-upload'
  ) {
    return 'text-input';
  }
  return 'unknown';
}

/**
 * Detect forms on one screen from attached elements only.
 * Form containers → group by form element id / attributes.form.
 * Otherwise one implicit FORM-001 when at least one fillable field exists.
 */
export function detectFormsOnScreen(elements: FormPlanElement[]): DetectedForm[] {
  const fields = elements.filter(isFillableField);
  if (fields.length === 0) return [];

  const containers = elements.filter(isFormContainer);
  const submits = elements.filter(isSubmitControl);
  const resets = elements.filter(isResetControl);

  if (containers.length === 0) {
    return [
      {
        formId: 'FORM-001',
        fields,
        submit: submits[0],
        reset: resets[0],
      },
    ];
  }

  const byContainer = new Map<string, DetectedForm>();
  containers.forEach((container, index) => {
    const formId = `FORM-${String(index + 1).padStart(3, '0')}`;
    byContainer.set(container.elementId, {
      formId,
      containerElementId: container.elementId,
      fields: [],
      submit: undefined,
      reset: undefined,
    });
  });

  const domIdToContainer = new Map<string, FormPlanElement>();
  for (const container of containers) {
    const domId = containerDomId(container);
    if (domId) domIdToContainer.set(domId, container);
  }

  const assignedFieldIds = new Set<string>();
  for (const field of fields) {
    const formAttr = fieldFormAttr(field);
    if (!formAttr) continue;
    const container = domIdToContainer.get(formAttr);
    if (!container) continue;
    const bucket = byContainer.get(container.elementId);
    if (!bucket) continue;
    bucket.fields.push(field);
    assignedFieldIds.add(field.elementId);
  }

  const anyGrouped = assignedFieldIds.size > 0;
  if (!anyGrouped) {
    // Form nodes exist but no field→form association — one form with all fillables (FORM-001).
    const first = containers[0]!;
    return [
      {
        formId: 'FORM-001',
        containerElementId: first.elementId,
        fields,
        submit: submits[0],
        reset: resets[0],
      },
    ];
  }

  for (const field of fields) {
    if (assignedFieldIds.has(field.elementId)) continue;
    // Unassociated fields join the first form that already has fields, else first container.
    const target =
      [...byContainer.values()].find((f) => f.fields.length > 0) ??
      byContainer.get(containers[0]!.elementId)!;
    target.fields.push(field);
  }

  for (const submit of submits) {
    const formAttr = fieldFormAttr(submit);
    const container = formAttr ? domIdToContainer.get(formAttr) : undefined;
    const bucket = container
      ? byContainer.get(container.elementId)
      : [...byContainer.values()].find((f) => f.fields.length > 0);
    if (bucket && !bucket.submit) bucket.submit = submit;
  }
  for (const reset of resets) {
    const formAttr = fieldFormAttr(reset);
    const container = formAttr ? domIdToContainer.get(formAttr) : undefined;
    const bucket = container
      ? byContainer.get(container.elementId)
      : [...byContainer.values()].find((f) => f.fields.length > 0);
    if (bucket && !bucket.reset) bucket.reset = reset;
  }

  return [...byContainer.values()].filter((f) => f.fields.length > 0);
}

interface FieldFixtureRef {
  elementId: string;
  subcaseId: string;
  fillValue: string;
}

function positiveFixturesForField(
  field: FormPlanElement,
  pageElements: FormPlanElement[]
): FieldFixtureRef | undefined {
  const purpose = purposeOf(field);
  const control = controlOf(field);
  const label = field.accessibleName || field.locator || field.elementId;
  const locator = field.locator ?? '';
  const result = buildPositiveSubcases({
    element: field,
    purpose,
    control,
    label,
    locator,
    stateChanging: false,
    kind: resolveKind(field),
    pageElements,
  });
  const plan = result.plans.find(
    (p) => p.subcaseId === 'positive-valid' && p.status === 'PLANNED' && p.expect?.fillValue != null
  );
  if (!plan?.expect?.fillValue) return undefined;
  return {
    elementId: field.elementId,
    subcaseId: plan.subcaseId,
    fillValue: plan.expect.fillValue,
  };
}

function negativeFixturesForField(
  field: FormPlanElement,
  pageElements: FormPlanElement[]
): FieldFixtureRef | undefined {
  const purpose = purposeOf(field);
  const control = controlOf(field);
  const label = field.accessibleName || field.locator || field.elementId;
  const locator = field.locator ?? '';
  const result = buildNegativeSubcases({
    element: field,
    purpose,
    control,
    label,
    locator,
    pageElements,
  });
  // Prefer email-format / not-a-number style fixtures when present.
  const preferred = [
    'negative-missing-at',
    'negative-missing-domain',
    'negative-invalid-domain',
    'negative-double-at',
    'negative-spaces',
    'negative-malformed',
    'negative-string',
    'negative-wrong-format',
    'negative-invalid',
  ];
  for (const id of preferred) {
    const plan = result.plans.find(
      (p) => p.subcaseId === id && p.status === 'PLANNED' && p.expect?.fillValue != null
    );
    if (plan?.expect?.fillValue != null) {
      return {
        elementId: field.elementId,
        subcaseId: plan.subcaseId,
        fillValue: plan.expect.fillValue,
      };
    }
  }
  const any = result.plans.find(
    (p) =>
      p.status === 'PLANNED' &&
      p.action === 'fill-no-submit' &&
      p.expect?.fillValue != null &&
      p.expect.fillValue !== ''
  );
  if (!any?.expect?.fillValue) return undefined;
  return {
    elementId: field.elementId,
    subcaseId: any.subcaseId,
    fillValue: any.expect.fillValue,
  };
}

function edgeSubcaseIdsForField(
  field: FormPlanElement
): string[] {
  const purpose = purposeOf(field);
  const control = controlOf(field);
  const label = field.accessibleName || field.locator || field.elementId;
  const locator = field.locator ?? '';
  const result = buildEdgeSubcases({
    element: field,
    purpose,
    control,
    label,
    locator,
  });
  return result.plans
    .filter((p) => p.status === 'PLANNED')
    .map((p) => `${field.elementId}:${p.subcaseId}`);
}

function siblingHasState(
  screen: DiscoveredScreen,
  screens: DiscoveredScreen[],
  states: string[]
): boolean {
  const key = canonicalScreenUrl(screen.url);
  return screens.some(
    (s) => canonicalScreenUrl(s.url) === key && states.includes(String(s.state))
  );
}

/**
 * Build form-* inventory rows for one detected form.
 * Fill plans only — never submit/reset/click. Never PASS.
 */
export function buildFormSubcases(input: {
  form: DetectedForm;
  screen: DiscoveredScreen;
  screens: DiscoveredScreen[];
  pageElements: FormPlanElement[];
  options?: FormPlanningOptions;
}): FormCaseResult {
  const { form, screen, screens, pageElements, options } = input;
  const plans: FormSubcasePlan[] = [];
  const seen = new Set<string>();
  const label = `${screen.id} ${form.formId}`;
  const fieldIds = form.fields.map((f) => f.elementId);

  const requiredIds: string[] = [];
  const optionalIds: string[] = [];
  const unknownIds: string[] = [];
  for (const field of form.fields) {
    const state = requiredState(field);
    if (state === true) requiredIds.push(field.elementId);
    else if (state === false) optionalIds.push(field.elementId);
    else unknownIds.push(field.elementId);
  }

  const validationRules = form.fields.flatMap((f) =>
    existingValidation(f).map((rule) => `${f.elementId}:${rule.kind}${rule.value != null ? `=${rule.value}` : ''}`)
  );

  pushUnique(seen, plans, {
    subcaseId: 'form-fields',
    kind: 'form-presence',
    title: `${label} — form-fields`,
    status: 'PLANNED',
    action: 'observe',
    category: 'validation',
    reason: 'inventory observation: fillable fields on this form',
    expect: { note: `fields: ${fieldIds.join(', ')}` },
    targetElementId: form.formId,
  });

  if (requiredIds.length > 0) {
    pushUnique(seen, plans, {
      subcaseId: 'form-required',
      kind: 'required-state',
      title: `${label} — form-required`,
      status: 'PLANNED',
      action: 'observe',
      category: 'validation',
      reason: 'inventory observation: required fields',
      expect: { note: `required: ${requiredIds.join(', ')}` },
      targetElementId: form.formId,
    });
  } else {
    const unknownNote =
      unknownIds.length > 0 ? `; unknown required flags: ${unknownIds.join(', ')}` : '';
    pushUnique(seen, plans, {
      subcaseId: 'form-required',
      kind: 'required-state',
      title: `${label} — form-required`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'validation',
      reason: `NOT_TESTED: no field was explicitly required${unknownNote}`,
      targetElementId: form.formId,
    });
  }

  if (optionalIds.length > 0) {
    pushUnique(seen, plans, {
      subcaseId: 'form-optional',
      kind: 'required-state',
      title: `${label} — form-optional`,
      status: 'PLANNED',
      action: 'observe',
      category: 'validation',
      reason: 'inventory observation: optional fields (required===false)',
      expect: { note: `optional: ${optionalIds.join(', ')}` },
      targetElementId: form.formId,
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'form-optional',
      kind: 'required-state',
      title: `${label} — form-optional`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'validation',
      reason: 'NOT_APPLICABLE: no field was explicitly optional',
      targetElementId: form.formId,
    });
  }

  if (validationRules.length > 0) {
    pushUnique(seen, plans, {
      subcaseId: 'form-validation',
      kind: 'validation-state',
      title: `${label} — form-validation`,
      status: 'PLANNED',
      action: 'observe',
      category: 'validation',
      reason: 'inventory observation: validation constraints from discovery',
      expect: { note: `validation: ${validationRules.join('; ')}` },
      targetElementId: form.formId,
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'form-validation',
      kind: 'validation-state',
      title: `${label} — form-validation`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'validation',
      reason: 'NOT_APPLICABLE: no validation constraint discovered',
      targetElementId: form.formId,
    });
  }

  if (form.submit) {
    pushUnique(seen, plans, {
      subcaseId: 'form-submit',
      kind: 'form-submit',
      title: `${label} — form-submit`,
      status: 'BLOCKED',
      action: 'none',
      category: 'positive',
      reason: FORM_SUBMIT_NOT_AUTHORIZED_REASON,
      expect: { locator: form.submit.locator ?? undefined, control: 'button' },
      targetElementId: form.formId,
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'form-submit',
      kind: 'form-submit',
      title: `${label} — form-submit`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'positive',
      reason: 'NOT_TESTED: submit control was not discovered',
      targetElementId: form.formId,
    });
  }

  if (form.reset) {
    pushUnique(seen, plans, {
      subcaseId: 'form-reset',
      kind: 'click-behavior',
      title: `${label} — form-reset`,
      status: 'BLOCKED',
      action: 'none',
      category: 'positive',
      reason: FORM_RESET_NOT_PERFORMED_REASON,
      expect: { locator: form.reset.locator ?? undefined, control: 'button' },
      targetElementId: form.formId,
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'form-reset',
      kind: 'click-behavior',
      title: `${label} — form-reset`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'positive',
      reason: 'NOT_APPLICABLE: reset control was not discovered',
      targetElementId: form.formId,
    });
  }

  if (siblingHasState(screen, screens, ['success']) || screen.state === 'success') {
    pushUnique(seen, plans, {
      subcaseId: 'form-success',
      kind: 'visibility',
      title: `${label} — form-success`,
      status: 'PLANNED',
      action: 'observe',
      category: 'validation',
      reason: 'success screen state observed for this URL — observe only',
      targetElementId: form.formId,
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'form-success',
      kind: 'visibility',
      title: `${label} — form-success`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'validation',
      reason: 'NOT_TESTED: success behavior was not in discovery evidence',
      targetElementId: form.formId,
    });
  }

  if (
    siblingHasState(screen, screens, ['error', 'validation-error']) ||
    screen.state === 'error' ||
    screen.state === 'validation-error'
  ) {
    pushUnique(seen, plans, {
      subcaseId: 'form-error',
      kind: 'error-recovery',
      title: `${label} — form-error`,
      status: 'PLANNED',
      action: 'observe',
      category: 'validation',
      reason: 'error or validation-error screen state observed for this URL — observe only',
      targetElementId: form.formId,
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'form-error',
      kind: 'error-recovery',
      title: `${label} — form-error`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'validation',
      reason: 'NOT_TESTED: error behavior was not in discovery evidence',
      targetElementId: form.formId,
    });
  }

  // --- generated cases (fill only; submit never included) ---
  const positives = form.fields
    .map((f) => positiveFixturesForField(f, pageElements))
    .filter((r): r is FieldFixtureRef => r != null);
  const missingPositive = form.fields
    .filter((f) => !positives.some((p) => p.elementId === f.elementId))
    .map((f) => f.elementId);

  if (positives.length === 0) {
    pushUnique(seen, plans, {
      subcaseId: 'form-all-valid',
      kind: 'valid-input',
      title: `${label} — form-all-valid`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'positive',
      reason: 'NOT_TESTED: no valid fixtures for this form',
      targetElementId: form.formId,
    });
  } else {
    const noteParts = positives.map((p) => `${p.elementId}→${p.subcaseId}(${p.fillValue})`);
    const missingNote =
      missingPositive.length > 0
        ? `; no positive-valid for: ${missingPositive.join(', ')}`
        : '';
    pushUnique(seen, plans, {
      subcaseId: 'form-all-valid',
      kind: 'valid-input',
      title: `${label} — form-all-valid`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'positive',
      reason: `fill plan using existing positive-valid fixtures; submit not included${missingNote}`,
      expect: {
        note: `fill: ${noteParts.join('; ')}; submit not included`,
        control: 'text',
      },
      targetElementId: form.formId,
    });
  }

  const negatives = form.fields
    .map((f) => negativeFixturesForField(f, pageElements))
    .filter((r): r is FieldFixtureRef => r != null);
  const missingNegative = form.fields
    .filter((f) => !negatives.some((n) => n.elementId === f.elementId))
    .map((f) => f.elementId);

  if (negatives.length === 0) {
    pushUnique(seen, plans, {
      subcaseId: 'form-all-invalid',
      kind: 'invalid-input',
      title: `${label} — form-all-invalid`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'negative',
      reason: 'NOT_TESTED: no invalid fixtures for this form',
      targetElementId: form.formId,
    });
  } else {
    const noteParts = negatives.map((n) => `${n.elementId}→${n.subcaseId}(${n.fillValue})`);
    const skipNote =
      missingNegative.length > 0
        ? `; skipped (no negative fixture): ${missingNegative.join(', ')}`
        : '';
    pushUnique(seen, plans, {
      subcaseId: 'form-all-invalid',
      kind: 'invalid-input',
      title: `${label} — form-all-invalid`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'negative',
      reason: `fill plan using existing negative fixtures; submit not included${skipNote}`,
      expect: {
        note: `fill: ${noteParts.join('; ')}; submit not included`,
        control: 'text',
        constraintInvalid: true,
      },
      targetElementId: form.formId,
    });
  }

  if (requiredIds.length === 0) {
    pushUnique(seen, plans, {
      subcaseId: 'form-missing-required',
      kind: 'required-validation',
      title: `${label} — form-missing-required`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'negative',
      reason: 'NOT_APPLICABLE: no required field discovered',
      targetElementId: form.formId,
    });
  } else {
    for (const reqId of requiredIds) {
      const others = positives.filter((p) => p.elementId !== reqId);
      const otherNote = others.map((p) => `${p.elementId}→${p.subcaseId}`).join('; ');
      pushUnique(seen, plans, {
        subcaseId: `form-missing-required-${reqId}`,
        kind: 'required-validation',
        title: `${label} — form-missing-required-${reqId}`,
        status: 'PLANNED',
        action: 'fill-no-submit',
        category: 'negative',
        reason: `omit required field ${reqId}; other required fields use valid fixtures; submit not included`,
        expect: {
          note: `omit: ${reqId}; fill others: ${otherNote || '(none)'}; submit not included`,
          required: true,
          control: 'text',
        },
        targetElementId: reqId,
      });
    }
  }

  if (negatives.length >= 2) {
    const noteParts = negatives.map((n) => `${n.elementId}→${n.subcaseId}(${n.fillValue})`);
    pushUnique(seen, plans, {
      subcaseId: 'form-multiple-invalid',
      kind: 'invalid-input',
      title: `${label} — form-multiple-invalid`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'negative',
      reason: 'fill plan with multiple existing negative fixtures; submit not included',
      expect: {
        note: `fill: ${noteParts.join('; ')}; submit not included`,
        constraintInvalid: true,
        control: 'text',
      },
      targetElementId: form.formId,
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'form-multiple-invalid',
      kind: 'invalid-input',
      title: `${label} — form-multiple-invalid`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'negative',
      reason: 'NOT_APPLICABLE: fewer than two fields have invalid fixtures',
      targetElementId: form.formId,
    });
  }

  const knownRequired = requiredIds.length > 0;
  const knownOptionalOnly =
    requiredIds.length === 0 && optionalIds.length > 0 && unknownIds.length === 0;
  const allUnknown =
    requiredIds.length === 0 && optionalIds.length === 0 && unknownIds.length === form.fields.length;

  if (knownRequired) {
    pushUnique(seen, plans, {
      subcaseId: 'form-empty',
      kind: 'empty-input',
      title: `${label} — form-empty`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'negative',
      reason: 'all fillable fields empty; at least one field is required; submit not included',
      expect: {
        note: `empty fields: ${fieldIds.join(', ')}; submit not included`,
        fillValue: '',
        control: 'text',
      },
      targetElementId: form.formId,
    });
  } else if (knownOptionalOnly) {
    pushUnique(seen, plans, {
      subcaseId: 'form-empty',
      kind: 'empty-input',
      title: `${label} — form-empty`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'negative',
      reason: 'NOT_APPLICABLE: empty form is valid when no field is required',
      targetElementId: form.formId,
    });
  } else if (allUnknown || unknownIds.length === form.fields.length) {
    pushUnique(seen, plans, {
      subcaseId: 'form-empty',
      kind: 'empty-input',
      title: `${label} — form-empty`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'negative',
      reason: 'NOT_TESTED: required flags were not discovered',
      targetElementId: form.formId,
    });
  } else {
    // Mix of optional + unknown, no required true
    pushUnique(seen, plans, {
      subcaseId: 'form-empty',
      kind: 'empty-input',
      title: `${label} — form-empty`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'negative',
      reason: 'NOT_TESTED: required flags were not discovered',
      targetElementId: form.formId,
    });
  }

  const edgeRefs = form.fields.flatMap((f) => edgeSubcaseIdsForField(f));
  if (edgeRefs.length > 0) {
    pushUnique(seen, plans, {
      subcaseId: 'form-boundary',
      kind: 'form-boundary',
      title: `${label} — form-boundary`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      category: 'boundary',
      reason: 'references existing edge subcases on form fields; submit not included',
      expect: {
        note: `edge refs: ${edgeRefs.join('; ')}; submit not included`,
        boundary: true,
        control: 'text',
      },
      targetElementId: form.formId,
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'form-boundary',
      kind: 'form-boundary',
      title: `${label} — form-boundary`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'boundary',
      reason: 'NOT_APPLICABLE: no boundary constraint discovered on form fields',
      targetElementId: form.formId,
    });
  }

  pushUnique(seen, plans, {
    subcaseId: 'form-duplicate-submission',
    kind: 'form-submit',
    title: `${label} — form-duplicate-submission`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'boundary',
    reason:
      'NOT_TESTED: duplicate submission is not executed; no idempotency rule was discovered',
    targetElementId: form.formId,
  });

  pushUnique(seen, plans, {
    subcaseId: 'form-rapid-submission',
    kind: 'form-submit',
    title: `${label} — form-rapid-submission`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'boundary',
    reason: 'NOT_TESTED: rapid submission was not observed and is not executed',
    targetElementId: form.formId,
  });

  pushUnique(seen, plans, {
    subcaseId: 'form-server-error',
    kind: 'error-recovery',
    title: `${label} — form-server-error`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'negative',
    reason: 'NOT_TESTED: server error is not simulated',
    targetElementId: form.formId,
  });

  pushUnique(seen, plans, {
    subcaseId: 'form-network-failure',
    kind: 'error-recovery',
    title: `${label} — form-network-failure`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'negative',
    reason: 'NOT_TESTED: network failure is not simulated',
    targetElementId: form.formId,
  });

  if (options?.hasAuthSession === true) {
    pushUnique(seen, plans, {
      subcaseId: 'form-session-expiration',
      kind: 'security-observation',
      title: `${label} — form-session-expiration`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'security',
      reason: 'NOT_TESTED: session expiration is not simulated',
      targetElementId: form.formId,
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'form-session-expiration',
      kind: 'security-observation',
      title: `${label} — form-session-expiration`,
      status: 'REQUIRES_CONFIGURATION',
      action: 'none',
      category: 'security',
      reason: 'REQUIRES_CONFIGURATION: auth session evidence was not passed in',
      targetElementId: form.formId,
    });
  }

  // Safety invariant: never executable submit/click/reset
  for (const plan of plans) {
    if (plan.action === ('submit' as PlannedAction) || plan.action === 'click-button') {
      plan.action = 'none';
      if (plan.status === 'PLANNED') {
        plan.status = 'BLOCKED';
        plan.reason = FORM_SUBMIT_NOT_AUTHORIZED_REASON;
      }
    }
    if (plan.subcaseId === 'form-submit' && plan.status === 'PLANNED') {
      plan.status = 'BLOCKED';
      plan.action = 'none';
      plan.reason = FORM_SUBMIT_NOT_AUTHORIZED_REASON;
    }
    if (plan.subcaseId === 'form-reset' && plan.status === 'PLANNED') {
      plan.status = 'BLOCKED';
      plan.action = 'none';
      plan.reason = FORM_RESET_NOT_PERFORMED_REASON;
    }
  }

  return { formId: form.formId, plans };
}

/**
 * Build all form plan sets for one screen. Returns [] when no fillable fields.
 */
export function buildFormPlansForScreen(input: {
  screen: DiscoveredScreen;
  elements: FormPlanElement[];
  screens: DiscoveredScreen[];
  options?: FormPlanningOptions;
}): FormCaseResult[] {
  const forms = detectFormsOnScreen(input.elements);
  return forms.map((form) =>
    buildFormSubcases({
      form,
      screen: input.screen,
      screens: input.screens,
      pageElements: input.elements,
      options: input.options,
    })
  );
}
