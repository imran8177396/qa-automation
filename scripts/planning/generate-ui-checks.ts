import { authorize, classify, type SafetyConfigResolved } from '../core/safety-policy';
import { applicableScenarios, inferFieldHint, kindForElement } from '../coverage/scenarios';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { boundaryValues, sampleValues } from './sample-values';
import type { CheckKind, CheckStatus, ControlKind, PlannedCheck } from './types';

const SKIP_HREF = /^(mailto:|tel:|javascript:|#)/i;

const FORM_SUBMISSION_VARIANTS = [
  'valid submission',
  'empty submission',
  'missing-field submission',
  'invalid submission',
  'boundary submission',
  'server-error submission',
  'success submission',
  'duplicate submission',
  'reset',
  'cancel',
] as const;

const SUBMIT_BUTTON_VARIANTS = [
  'click',
  'navigation',
  'modal',
  'loading',
  'success',
  'error',
  'duplicate-click',
] as const;

function nextId(seq: { n: number }): string {
  seq.n += 1;
  return `CHK-${String(seq.n).padStart(4, '0')}`;
}

function describe(element: UiElementRecord): string {
  return element.accessibleName || element.locator || element.elementId;
}

function locatorFrequency(elements: UiElementRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const el of elements) {
    if (el.locator) map.set(el.locator, (map.get(el.locator) ?? 0) + 1);
  }
  return map;
}

function isAmbiguous(locator: string, frequency: Map<string, number>): boolean {
  return locator.startsWith('text=') && (frequency.get(locator) ?? 0) > 1;
}

function gateLocator(
  element: UiElementRecord,
  frequency: Map<string, number>
): { ok: true; locator: string } | { ok: false; status: CheckStatus; reason: string } {
  if (!element.visible) {
    return {
      ok: false,
      status: 'NOT_TESTED',
      reason:
        'NOT_TESTED: not visible in the default desktop viewport at discovery time — likely responsive/conditional UI',
    };
  }
  if (!element.locator) {
    return {
      ok: false,
      status: 'REQUIRES_CONFIGURATION',
      reason:
        'REQUIRES_CONFIGURATION: no stable locator candidate (id/name/aria-label/placeholder/testid/text)',
    };
  }
  if (isAmbiguous(element.locator, frequency)) {
    return {
      ok: false,
      status: 'REQUIRES_CONFIGURATION',
      reason:
        'REQUIRES_CONFIGURATION: only a text-based locator was available and it matches more than one element on this page',
    };
  }
  return { ok: true, locator: element.locator };
}

/**
 * Plans UI checks from discovery inventories. Only applicable scenarios are planned.
 * Submit / state-changing actions are recorded as NOT_TESTED — never PLANNED.
 */
export function generateUiChecks(
  pageMap: PageMap,
  ui: UiInventory,
  safety: SafetyConfigResolved
): PlannedCheck[] {
  const checks: PlannedCheck[] = [];
  const seq = { n: 0 };

  const push = (
    kind: CheckKind,
    title: string,
    targetUrl: string,
    status: CheckStatus,
    extra: Partial<PlannedCheck> = {}
  ) => {
    checks.push({
      id: nextId(seq),
      kind,
      title: `${title}`,
      targetUrl,
      status,
      ...extra,
    });
  };

  for (const page of pageMap.pages) {
    if (page.error) {
      push('page-sanity', `${page.url} should load`, page.url, 'BLOCKED', {
        reason: `BLOCKED: navigation error during discovery — ${page.error}`,
      });
      continue;
    }
    if (page.access === 'gated') {
      push('page-sanity', `${page.url} is behind authentication`, page.url, 'REQUIRES_CONFIGURATION', {
        reason: page.gatedReason ?? 'REQUIRES_CONFIGURATION: login wall observed — content was not inventoried',
      });
      continue;
    }
    if (page.status != null && page.status >= 400) {
      push('broken-link', `${page.url} should not return ${page.status}`, page.url, 'PLANNED');
      continue;
    }
    const hasH1 = (page.h1s ?? []).some((heading) => heading.trim().length > 0);
    const hasHeading =
      hasH1 || (page.headings ?? []).some((heading) => heading.text.trim().length > 0);
    push(
      'page-sanity',
      hasHeading ? `${page.url} should load and render a heading` : `${page.url} should load`,
      page.url,
      'PLANNED',
      {
        expect: { requireH1: hasH1, requireHeading: hasHeading && !hasH1 },
      }
    );
  }

  const byPage = new Map<string, UiElementRecord[]>();
  for (const element of ui.elements) {
    const bucket = byPage.get(element.page) ?? [];
    bucket.push(element);
    byPage.set(element.page, bucket);
  }

  for (const [pageUrl, elements] of byPage) {
    const frequency = locatorFrequency(elements);

    for (const element of elements) {
      const kind = kindForElement(element.elementType);
      if (!kind) {
        push(
          'visibility',
          `${pageUrl} ${describe(element)} — no mapped scenario kind`,
          pageUrl,
          'NOT_TESTED',
          {
            targetElementId: element.elementId,
            reason: `NOT_TESTED: element type '${element.elementType}' has no mapped inventory kind — recorded, not omitted`,
          }
        );
        continue;
      }

      const hint = inferFieldHint({
        elementType: element.elementType,
        locator: element.locator,
        name: element.accessibleName,
        evidence: element.evidence,
      });
      const scenarios = applicableScenarios({
        kind,
        elementType: element.elementType,
        required: element.required,
        isSubmit: element.isSubmit,
        interactive: element.interactive,
        visible: element.visible,
        href: element.href,
        locator: element.locator,
        evidence: element.evidence,
        inputHint: hint,
        readOnly: element.readOnly,
        min: element.min,
        max: element.max,
        minLength: element.minLength,
        maxLength: element.maxLength,
      });

      const risk = classify(
        {
          text: element.accessibleName ?? undefined,
          href: element.href ?? undefined,
          formMethod: element.formMethod ?? (element.isSubmit ? 'POST' : undefined),
          pageUrl,
          selector: element.locator ?? undefined,
        },
        safety
      );
      const stateChanging =
        risk === 'destructive' ||
        Boolean(element.href && /[?&](action|do|cmd)=(delete|remove|cancel|deactivate)/i.test(element.href));

      const gated = gateLocator(element, frequency);

      for (const scenario of scenarios) {
        const label = `${pageUrl} ${element.locator ?? describe(element)} — ${scenario.id}`;

        if (scenario.disposition === 'blocked-safety') {
          push(scenario.id as CheckKind, label, pageUrl, 'BLOCKED', {
            targetElementId: element.elementId,
            reason: `BLOCKED: ${scenario.reason}`,
          });
          continue;
        }
        if (scenario.disposition === 'not-implemented') {
          push(scenario.id as CheckKind, label, pageUrl, 'NOT_TESTED', {
            targetElementId: element.elementId,
            reason: `NOT_TESTED: ${scenario.reason}`,
          });
          continue;
        }
        if (scenario.disposition === 'requires-configuration') {
          push(scenario.id as CheckKind, label, pageUrl, 'REQUIRES_CONFIGURATION', {
            targetElementId: element.elementId,
            reason: `REQUIRES_CONFIGURATION: ${scenario.reason}`,
          });
          continue;
        }

        if (!gated.ok) {
          push(scenario.id as CheckKind, label, pageUrl, gated.status, {
            targetElementId: element.elementId,
            reason: gated.reason,
          });
          continue;
        }

        planExecutable({
          checks,
          seq,
          scenarioId: scenario.id as CheckKind,
          label,
          pageUrl,
          element,
          locator: gated.locator,
          hint,
          stateChanging,
        });
      }

      if (kind === 'form') {
        appendBlockedVariants({
          push,
          pageUrl,
          element,
          variants: FORM_SUBMISSION_VARIANTS,
          kind: 'form-submit',
          reason:
            'BLOCKED: form submission is not authorized for generated checks (safety policy — no submit)',
        });
      }
      if (kind === 'button' && element.isSubmit) {
        appendBlockedVariants({
          push,
          pageUrl,
          element,
          variants: SUBMIT_BUTTON_VARIANTS,
          kind: 'click-behavior',
          reason:
            'BLOCKED: Login/submit click, navigation, modal, loading, success, error, and duplicate-click require a state-changing submit',
        });
      }
    }
  }

  return checks;
}

function appendBlockedVariants(input: {
  push: (
    kind: CheckKind,
    title: string,
    targetUrl: string,
    status: CheckStatus,
    extra?: Partial<PlannedCheck>
  ) => void;
  pageUrl: string;
  element: UiElementRecord;
  variants: readonly string[];
  kind: CheckKind;
  reason: string;
}): void {
  const { push, pageUrl, element, variants, kind, reason } = input;
  const target = element.locator ?? describe(element);
  for (const variant of variants) {
    push(kind, `${pageUrl} ${target} — ${variant} (safety)`, pageUrl, 'BLOCKED', {
      targetElementId: element.elementId,
      reason: `${reason} — ${variant}`,
    });
  }
}

function planExecutable(input: {
  checks: PlannedCheck[];
  seq: { n: number };
  scenarioId: CheckKind;
  label: string;
  pageUrl: string;
  element: UiElementRecord;
  locator: string;
  hint: ReturnType<typeof inferFieldHint>;
  stateChanging: boolean;
}): void {
  const { checks, seq, scenarioId, label, pageUrl, element, locator, hint, stateChanging } = input;
  const values = sampleValues(hint);
  const control = controlOf(element.elementType);
  const base = {
    targetElementId: element.elementId,
    expect: {
      locator,
      visible: true,
      enabled: element.enabled,
      required: element.required,
      href: element.href ?? undefined,
      accessibleName: element.accessibleName,
      control,
      readOnly: element.readOnly,
    },
  };

  const add = (kind: CheckKind, title: string, status: CheckStatus, extra: Partial<PlannedCheck> = {}) => {
    checks.push({
      id: nextId(seq),
      kind,
      title,
      targetUrl: pageUrl,
      status,
      ...base,
      ...extra,
      expect: { ...base.expect, ...extra.expect },
    });
  };

  switch (scenarioId) {
    case 'visibility':
    case 'form-presence':
      add(scenarioId, label, 'PLANNED');
      return;
    case 'enabled-state':
      add(scenarioId, label, 'PLANNED');
      return;
    case 'editability':
      add(scenarioId, label, 'PLANNED');
      return;
    case 'accessible-name':
      if (!element.accessibleName) {
        add(scenarioId, label, 'REQUIRES_CONFIGURATION', {
          reason: 'REQUIRES_CONFIGURATION: no accessible name was observed',
        });
        return;
      }
      add(scenarioId, label, 'PLANNED');
      return;
    case 'required-state':
      add(scenarioId, `${label} required/optional`, 'PLANNED', {
        expect: { ...base.expect, required: Boolean(element.required) },
      });
      return;
    case 'valid-input':
      if (control === 'checkbox' || control === 'radio') {
        add('toggle-state', `${label} (toggle, no submit)`, 'PLANNED');
        return;
      }
      if (control === 'select') {
        add('select-options', `${pageUrl} ${locator} — select-options`, 'PLANNED');
        add('select-change', `${pageUrl} ${locator} — select-change (no submit)`, 'PLANNED');
        return;
      }
      add(scenarioId, `${label} valid input (no submit)`, 'PLANNED', {
        expect: { ...base.expect, fillValue: values.valid },
      });
      return;
    case 'invalid-input':
      if (!values.invalid) {
        add(scenarioId, `${label} invalid input`, 'NOT_TESTED', {
          reason: 'NOT_TESTED: no invalid sample value is defined for this field hint',
        });
        return;
      }
      add(scenarioId, `${label} invalid input (no submit)`, 'PLANNED', {
        expect: {
          ...base.expect,
          fillValue: values.invalid,
          constraintInvalid: hint === 'email' || hint === 'number' || hint === 'tel' || hint === 'url',
        },
      });
      return;
    case 'empty-input':
      add(scenarioId, `${label} empty input (no submit)`, 'PLANNED', {
        expect: { ...base.expect, fillValue: '', required: Boolean(element.required) },
      });
      return;
    case 'required-validation':
      add(scenarioId, `${label} empty/required (no submit)`, 'PLANNED', {
        expect: { ...base.expect, fillValue: '', required: true, boundary: true },
      });
      return;
    case 'whitespace-input':
      add(scenarioId, `${label} whitespace input (no submit)`, 'PLANNED', {
        expect: { ...base.expect, fillValue: values.whitespace },
      });
      return;
    case 'long-input':
      add(scenarioId, `${label} long input (no submit)`, 'PLANNED', {
        expect: { ...base.expect, fillValue: values.long },
      });
      return;
    case 'unicode-input':
      add(scenarioId, `${label} unicode input (no submit)`, 'PLANNED', {
        expect: { ...base.expect, fillValue: values.unicode },
      });
      return;
    case 'special-characters':
      add(scenarioId, `${label} special characters (no submit)`, 'PLANNED', {
        expect: { ...base.expect, fillValue: values.special },
      });
      return;
    case 'validation-state':
      if (!values.invalid) {
        add(scenarioId, `${label} constraint validity`, 'NOT_TESTED', {
          reason: 'NOT_TESTED: no invalid sample value is defined for this field hint',
        });
        return;
      }
      add(scenarioId, `${label} constraint validity (no submit)`, 'PLANNED', {
        expect: { ...base.expect, fillValue: values.invalid },
      });
      return;
    case 'error-recovery':
      if (!values.invalid) {
        add(scenarioId, `${label} error recovery`, 'NOT_TESTED', {
          reason: 'NOT_TESTED: no invalid sample value is defined for this field hint',
        });
        return;
      }
      add(scenarioId, `${label} error recovery (no submit)`, 'PLANNED', {
        expect: { ...base.expect, fillValue: values.invalid, recoveryValue: values.valid },
      });
      return;
    case 'boundary-values': {
      const edges = boundaryValues(element.min, element.max);
      if (edges.length === 0) {
        add(scenarioId, `${label} boundary values`, 'NOT_TESTED', {
          reason: 'NOT_TESTED: no min/max boundary values were observed on this control',
        });
        return;
      }
      add(scenarioId, `${label} boundary values (no submit)`, 'PLANNED', {
        expect: { ...base.expect, fillValue: edges[0], min: element.min ?? undefined, max: element.max ?? undefined },
      });
      return;
    }
    case 'broken-link':
    case 'navigation':
    case 'click-behavior':
      planLinkOrButton({ add, scenarioId, label, element, locator, stateChanging });
      return;
    default:
      add(scenarioId, label, 'NOT_TESTED', {
        reason: `NOT_TESTED: no safe executable procedure for ${scenarioId}`,
      });
  }
}

function planLinkOrButton(input: {
  add: (kind: CheckKind, title: string, status: CheckStatus, extra?: Partial<PlannedCheck>) => void;
  scenarioId: CheckKind;
  label: string;
  element: UiElementRecord;
  locator: string;
  stateChanging: boolean;
}): void {
  const { add, scenarioId, label, element, locator, stateChanging } = input;
  const href = element.href ?? '';

  if (element.elementType === 'link' || element.elementType === 'navigation') {
    if (scenarioId === 'broken-link' || scenarioId === 'navigation') {
      if (!href || SKIP_HREF.test(href)) {
        add(scenarioId, label, 'NOT_TESTED', {
          reason: 'NOT_TESTED: href is empty, in-page, or a non-http protocol',
        });
        return;
      }
      if (stateChanging || !authorize({ kind: 'click-link', correlatesWithStateChange: stateChanging })) {
        add(scenarioId, label, 'NOT_TESTED', {
          reason: 'NOT_TESTED: link is classified as state-changing — GET/click not authorized',
        });
        return;
      }
      if (scenarioId === 'broken-link') {
        add('broken-link', `${label} destination status`, 'PLANNED', {
          expect: { locator, href },
        });
        return;
      }
      add('link-href', `${label} href`, 'PLANNED', { expect: { locator, href } });
      add('click-link', `${label} click destination`, 'PLANNED', { expect: { locator, href } });
      return;
    }
  }

  if (element.elementType === 'button') {
    if (element.isSubmit || !authorize({ kind: 'click-button', isSubmitControl: element.isSubmit, correlatesWithStateChange: stateChanging })) {
      add(scenarioId, label, 'NOT_TESTED', {
        reason: 'NOT_TESTED: button click is not authorized (submit or state-changing)',
      });
      return;
    }
    add('click-button', `${label} click (non-submit)`, 'PLANNED', { expect: { locator } });
    return;
  }

  add(scenarioId, label, 'NOT_TESTED', {
    reason: `NOT_TESTED: ${scenarioId} is not authorized for this control`,
  });
}

function controlOf(elementType: string): ControlKind {
  if (elementType === 'select') return 'select';
  if (elementType === 'checkbox' || elementType === 'toggle') return 'checkbox';
  if (elementType === 'radio') return 'radio';
  if (elementType === 'link') return 'link';
  if (elementType === 'button') return 'button';
  if (
    elementType === 'input' ||
    elementType === 'textarea' ||
    elementType === 'search'
  ) {
    return 'text';
  }
  return 'component';
}
