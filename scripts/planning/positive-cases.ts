/**
 * Positive / valid expected-use subcases for the existing planner.
 * Consumed only by buildScenarioInventory → planPositive — not a second planner.
 * Fixtures are generic; never invent min/max, options, destinations, or API URLs.
 */

import { authorize } from '../core/safety-policy';
import {
  isBlockedActionKind,
  type ElementKind,
} from '../discovery/element-kind';
import type { UiElementRecord } from '../discovery/ui-scan';
import type {
  CheckKind,
  CheckStatus,
  ControlKind,
  ElementPurpose,
  PlannedAction,
  PlannedCheck,
} from './types';

export const POSITIVE_FIXTURES = {
  textValid: 'valid-text',
  textSpecial: 'a+b_c',
  textUnicode: 'café',
  emailValid: 'user@example.com',
  emailSubdomain: 'user@mail.example.com',
  emailPlus: 'user+tag@example.com',
  passwordValid: 'password-fixture',
} as const;

export type PositiveSubcaseId =
  | 'positive-valid'
  | 'positive-min'
  | 'positive-max'
  | 'positive-special'
  | 'positive-unicode'
  | 'positive-subdomain'
  | 'positive-plus'
  | 'positive-open'
  | 'positive-select'
  | 'positive-change'
  | 'positive-verify'
  | 'positive-check'
  | 'positive-uncheck'
  | 'positive-click'
  | 'positive-action'
  | 'positive-state'
  | 'positive-navigation'
  | 'positive-api'
  | 'positive-destination'
  | 'positive-page-state'
  | `positive-option-${number}`;

export interface PositiveSubcasePlan {
  subcaseId: PositiveSubcaseId;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  reason?: string;
  expect?: PlannedCheck['expect'];
}

export interface PositiveCaseResult {
  /** Executable or recorded positive subcase rows (never PASS). */
  plans: PositiveSubcasePlan[];
  /** Compact exclusion notes for the existing NOT_APPLICABLE summary row. */
  exclusions: string[];
}

function parseLength(raw: string | null | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function isLengthConstraint(raw: string | null | undefined): boolean {
  const n = parseLength(raw);
  return n != null;
}

function inputTypeOf(element: UiElementRecord): string {
  return (element.inputType ?? element.attributes?.type ?? '').toLowerCase();
}

function isFreeTextType(element: UiElementRecord): boolean {
  const t = inputTypeOf(element);
  return t === '' || t === 'text' || t === 'search';
}

function patternOf(element: UiElementRecord): string | undefined {
  const p = element.attributes?.pattern;
  return p != null && p !== '' ? p : undefined;
}

function patternAllows(pattern: string, fixture: string): boolean {
  try {
    const re = new RegExp(`^(?:${pattern})$`);
    return re.test(fixture);
  } catch {
    return false;
  }
}

function observedRequestUrl(element: UiElementRecord): string | undefined {
  if (element.requestUrl && /^https?:\/\//i.test(element.requestUrl)) {
    return element.requestUrl;
  }
  const blob = `${element.evidence ?? ''} ${JSON.stringify(element.attributes ?? {})}`;
  const match = blob.match(/https?:\/\/[^\s"'<>]+/i);
  return match?.[0];
}

function discoveredOptionValues(element: UiElementRecord): string[] {
  if (Array.isArray(element.optionValues) && element.optionValues.length > 0) {
    return element.optionValues.filter((v) => typeof v === 'string' && v.length > 0);
  }
  return [];
}

function radioGroupOptions(
  element: UiElementRecord,
  pageElements: UiElementRecord[]
): UiElementRecord[] {
  const name = element.attributes?.name ?? '';
  if (!name) {
    return [element];
  }
  return pageElements.filter((el) => {
    if (el.elementType !== 'radio' && (el.inputType ?? '').toLowerCase() !== 'radio') {
      return el.elementId === element.elementId;
    }
    return (el.attributes?.name ?? '') === name;
  });
}

function radioOptionLabel(el: UiElementRecord): string {
  return (
    el.attributes?.value ||
    el.accessibleName ||
    el.label ||
    el.elementId
  );
}

function pushUnique(
  seen: Set<string>,
  plans: PositiveSubcasePlan[],
  plan: PositiveSubcasePlan
): void {
  if (seen.has(plan.subcaseId)) return;
  seen.add(plan.subcaseId);
  plans.push(plan);
}

function excludeUnique(exclusions: string[], note: string): void {
  if (!exclusions.includes(note)) exclusions.push(note);
}

function textMaxFixture(maxLength: number): { value: string; capNote?: string } {
  const preferred = Math.min(maxLength, 32);
  if (maxLength > 64) {
    const capped = Math.min(preferred, 64);
    return {
      value: 'a'.repeat(capped),
      capNote: 'fixture capped at 64',
    };
  }
  return { value: 'a'.repeat(preferred) };
}

function passwordLengthFixture(length: number): string {
  const capped = Math.min(Math.max(0, length), 64);
  return 'a'.repeat(capped);
}

function planTextLikePositive(
  element: UiElementRecord,
  label: string,
  control: ControlKind,
  locator: string,
  fillAuthorized: boolean
): PositiveCaseResult {
  const plans: PositiveSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();
  const inputType = inputTypeOf(element);
  const isEmail = inputType === 'email' || element.elementKind === 'email-input';
  const isPassword = inputType === 'password' || element.elementKind === 'password-input';
  const isNumber = inputType === 'number' || element.elementKind === 'number-input';

  const fillBase = (subcaseId: PositiveSubcaseId, title: string, fillValue: string, extraReason?: string): PositiveSubcasePlan => {
    if (!fillAuthorized) {
      return {
        subcaseId,
        kind: 'valid-input',
        title,
        status: 'BLOCKED',
        action: 'none',
        reason: 'BLOCKED: fill is not authorized by safety policy',
      };
    }
    return {
      subcaseId,
      kind: 'valid-input',
      title,
      status: 'PLANNED',
      action: 'fill-no-submit',
      reason: extraReason,
      expect: {
        locator,
        fillValue,
        control,
        inputType: element.inputType ?? undefined,
        min: element.min ?? undefined,
        max: element.max ?? undefined,
        maxLength: element.maxLength ?? undefined,
      },
    };
  };

  if (isEmail) {
    pushUnique(
      seen,
      plans,
      fillBase('positive-valid', `${label} — positive-valid`, POSITIVE_FIXTURES.emailValid)
    );
    pushUnique(
      seen,
      plans,
      fillBase(
        'positive-subdomain',
        `${label} — positive-subdomain (format fixture)`,
        POSITIVE_FIXTURES.emailSubdomain,
        'format fixture; not a claim that the app domain list accepts it'
      )
    );
    pushUnique(
      seen,
      plans,
      fillBase(
        'positive-plus',
        `${label} — positive-plus (format fixture)`,
        POSITIVE_FIXTURES.emailPlus,
        'plus-addressing format fixture; server support was not discovered'
      )
    );
    return { plans, exclusions };
  }

  if (isPassword) {
    pushUnique(
      seen,
      plans,
      fillBase('positive-valid', `${label} — positive-valid`, POSITIVE_FIXTURES.passwordValid)
    );

    const minLen = parseLength(element.minLength ?? element.attributes?.minlength);
    if (minLen != null) {
      pushUnique(
        seen,
        plans,
        fillBase('positive-min', `${label} — positive-min`, passwordLengthFixture(minLen))
      );
    } else {
      excludeUnique(exclusions, 'positive-min (no minimum constraint discovered)');
    }

    const maxLen = parseLength(element.maxLength ?? element.attributes?.maxlength);
    if (maxLen != null) {
      const value = passwordLengthFixture(maxLen);
      const reason = maxLen > 64 ? 'fixture capped at 64' : undefined;
      pushUnique(seen, plans, fillBase('positive-max', `${label} — positive-max`, value, reason));
    } else {
      excludeUnique(exclusions, 'positive-max (no maximum constraint discovered)');
    }
    return { plans, exclusions };
  }

  // Generic text / number / search / textarea
  const validValue = isNumber
    ? element.min != null && element.min !== '' && !Number.isNaN(Number(element.min))
      ? String(element.min)
      : '1'
    : POSITIVE_FIXTURES.textValid;
  pushUnique(seen, plans, fillBase('positive-valid', `${label} — positive-valid`, validValue));

  // positive-min
  const minLen = parseLength(element.minLength ?? element.attributes?.minlength);
  const minAttr = element.min ?? element.attributes?.min ?? null;
  if (isNumber && minAttr != null && minAttr !== '' && !Number.isNaN(Number(minAttr))) {
    pushUnique(
      seen,
      plans,
      fillBase('positive-min', `${label} — positive-min`, String(minAttr))
    );
  } else if (minLen != null && isLengthConstraint(element.minLength ?? element.attributes?.minlength)) {
    pushUnique(
      seen,
      plans,
      fillBase('positive-min', `${label} — positive-min`, 'a'.repeat(minLen))
    );
  } else {
    excludeUnique(exclusions, 'positive-min (no minimum constraint discovered)');
  }

  // positive-max
  const maxLen = parseLength(element.maxLength ?? element.attributes?.maxlength);
  const maxAttr = element.max ?? element.attributes?.max ?? null;
  if (isNumber && maxAttr != null && maxAttr !== '' && !Number.isNaN(Number(maxAttr))) {
    pushUnique(
      seen,
      plans,
      fillBase('positive-max', `${label} — positive-max`, String(maxAttr))
    );
  } else if (maxLen != null) {
    const { value, capNote } = textMaxFixture(maxLen);
    pushUnique(
      seen,
      plans,
      fillBase('positive-max', `${label} — positive-max`, value, capNote)
    );
  } else {
    excludeUnique(exclusions, 'positive-max (no maximum constraint discovered)');
  }

  // special + unicode — free text/search (and textarea) only
  const freeText =
    isFreeTextType(element) ||
    element.elementType === 'textarea' ||
    element.elementType === 'search';
  if (freeText) {
    const pattern = patternOf(element);
    if (pattern) {
      if (patternAllows(pattern, POSITIVE_FIXTURES.textSpecial)) {
        pushUnique(
          seen,
          plans,
          fillBase('positive-special', `${label} — positive-special`, POSITIVE_FIXTURES.textSpecial)
        );
      } else {
        excludeUnique(exclusions, 'positive-special (pattern does not allow the fixture)');
      }
      excludeUnique(exclusions, 'positive-unicode (pattern present or type is not free text)');
    } else {
      pushUnique(
        seen,
        plans,
        fillBase('positive-special', `${label} — positive-special`, POSITIVE_FIXTURES.textSpecial)
      );
      pushUnique(
        seen,
        plans,
        fillBase('positive-unicode', `${label} — positive-unicode`, POSITIVE_FIXTURES.textUnicode)
      );
    }
  }

  return { plans, exclusions };
}

function planSelectPositive(
  element: UiElementRecord,
  label: string,
  control: ControlKind,
  locator: string,
  fillAuthorized: boolean
): PositiveCaseResult {
  const plans: PositiveSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();
  const options = discoveredOptionValues(element);

  if (options.length === 0) {
    excludeUnique(exclusions, 'positive-select (no options discovered)');
    return { plans, exclusions };
  }

  const first = options[0]!;
  const second = options[1];

  if (!fillAuthorized) {
    for (const sub of ['positive-open', 'positive-select', 'positive-verify'] as const) {
      pushUnique(seen, plans, {
        subcaseId: sub,
        kind: sub === 'positive-open' ? 'select-options' : sub === 'positive-verify' ? 'select-options' : 'select-change',
        title: `${label} — ${sub}`,
        status: 'BLOCKED',
        action: 'none',
        reason: 'BLOCKED: fill is not authorized by safety policy',
      });
    }
    return { plans, exclusions };
  }

  pushUnique(seen, plans, {
    subcaseId: 'positive-open',
    kind: 'select-options',
    title: `${label} — positive-open`,
    status: 'PLANNED',
    action: 'observe',
    expect: { locator, control },
  });
  pushUnique(seen, plans, {
    subcaseId: 'positive-select',
    kind: 'select-change',
    title: `${label} — positive-select`,
    status: 'PLANNED',
    action: 'fill-no-submit',
    expect: { locator, fillValue: first, control },
  });
  pushUnique(seen, plans, {
    subcaseId: 'positive-verify',
    kind: 'select-options',
    title: `${label} — positive-verify`,
    status: 'PLANNED',
    action: 'observe',
    expect: { locator, fillValue: first, control },
  });

  if (second != null) {
    pushUnique(seen, plans, {
      subcaseId: 'positive-change',
      kind: 'select-change',
      title: `${label} — positive-change`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      expect: { locator, fillValue: second, control },
    });
  }

  return { plans, exclusions };
}

function planCheckboxPositive(
  label: string,
  control: ControlKind,
  locator: string,
  fillAuthorized: boolean
): PositiveCaseResult {
  const plans: PositiveSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();

  const mk = (subcaseId: PositiveSubcaseId, checked: boolean | undefined, titleExtra: string): void => {
    if (!fillAuthorized) {
      pushUnique(seen, plans, {
        subcaseId,
        kind: 'toggle-state',
        title: `${label} — ${subcaseId}`,
        status: 'BLOCKED',
        action: 'none',
        reason: 'BLOCKED: fill is not authorized by safety policy',
      });
      return;
    }
    pushUnique(seen, plans, {
      subcaseId,
      kind: 'toggle-state',
      title: `${label} — ${subcaseId}${titleExtra}`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      expect: {
        locator,
        control,
        ...(checked !== undefined ? { checked } : {}),
      },
    });
  };

  mk('positive-check', true, '');
  mk('positive-uncheck', false, '');
  mk('positive-verify', undefined, ' (verify state)');
  return { plans, exclusions };
}

function planRadioPositive(
  element: UiElementRecord,
  label: string,
  control: ControlKind,
  locator: string,
  fillAuthorized: boolean,
  pageElements: UiElementRecord[]
): PositiveCaseResult {
  const plans: PositiveSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();
  const group = radioGroupOptions(element, pageElements);
  const options = group.slice(0, 5);
  const extraNote = group.length > 5 ? 'additional options not expanded' : undefined;

  if (options.length === 0) {
    excludeUnique(exclusions, 'positive-select (no options discovered)');
    return { plans, exclusions };
  }

  if (!fillAuthorized) {
    pushUnique(seen, plans, {
      subcaseId: 'positive-select',
      kind: 'toggle-state',
      title: `${label} — positive-select`,
      status: 'BLOCKED',
      action: 'none',
      reason: 'BLOCKED: fill is not authorized by safety policy',
    });
    return { plans, exclusions };
  }

  options.forEach((opt, index) => {
    const subcaseId = `positive-option-${index + 1}` as PositiveSubcaseId;
    pushUnique(seen, plans, {
      subcaseId,
      kind: 'toggle-state',
      title: `${label} — ${subcaseId}`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      reason: extraNote,
      expect: {
        locator: opt.locator ?? locator,
        fillValue: radioOptionLabel(opt),
        control,
        checked: true,
      },
    });
  });

  if (options.length >= 2) {
    pushUnique(seen, plans, {
      subcaseId: 'positive-change',
      kind: 'toggle-state',
      title: `${label} — positive-change`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      expect: {
        locator: options[1]!.locator ?? locator,
        fillValue: radioOptionLabel(options[1]!),
        control,
        checked: true,
      },
    });
  }

  pushUnique(seen, plans, {
    subcaseId: 'positive-verify',
    kind: 'toggle-state',
    title: `${label} — positive-verify (verify only one selected)`,
    status: 'PLANNED',
    action: 'observe',
    expect: {
      locator,
      control,
      accessibleName: 'verify only one selected',
    },
  });

  return { plans, exclusions };
}

function planButtonPositive(
  element: UiElementRecord,
  label: string,
  control: ControlKind,
  locator: string,
  stateChanging: boolean,
  kind: ElementKind | undefined
): PositiveCaseResult {
  const plans: PositiveSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();
  const blocked =
    stateChanging ||
    Boolean(element.isSubmit) ||
    isBlockedActionKind(kind) ||
    kind === 'submit-button' ||
    kind === 'delete-button' ||
    kind === 'save-button' ||
    kind === 'reset-button' ||
    kind === 'upload-button';

  if (blocked) {
    pushUnique(seen, plans, {
      subcaseId: 'positive-click',
      kind: 'click-button',
      title: `${label} — positive-click`,
      status: 'BLOCKED',
      action: 'none',
      reason: 'BLOCKED: positive-click blocked: state-changing control',
    });
    pushUnique(seen, plans, {
      subcaseId: 'positive-action',
      kind: 'click-behavior',
      title: `${label} — positive-action`,
      status: 'BLOCKED',
      action: 'none',
      reason: 'BLOCKED: positive-click blocked: state-changing control',
    });
    pushUnique(seen, plans, {
      subcaseId: 'positive-state',
      kind: 'click-behavior',
      title: `${label} — positive-state`,
      status: 'BLOCKED',
      action: 'none',
      reason: 'BLOCKED: positive-click blocked: state-changing control',
    });
  } else {
    const href = element.href ?? '';
    if (!href) {
      pushUnique(seen, plans, {
        subcaseId: 'positive-click',
        kind: 'click-button',
        title: `${label} — positive-click`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: 'NOT_TESTED: no destination discovered',
      });
    } else if (!authorize({ kind: 'click-button', correlatesWithStateChange: false })) {
      pushUnique(seen, plans, {
        subcaseId: 'positive-click',
        kind: 'click-button',
        title: `${label} — positive-click`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: 'NOT_TESTED: click not authorized by safety policy',
      });
    } else {
      pushUnique(seen, plans, {
        subcaseId: 'positive-click',
        kind: 'click-button',
        title: `${label} — positive-click`,
        status: 'PLANNED',
        action: 'observe',
        expect: { locator, href, control },
      });
    }
  }

  const dest = element.href;
  if (dest && !blocked && authorize({ kind: 'click-link', correlatesWithStateChange: false })) {
    pushUnique(seen, plans, {
      subcaseId: 'positive-navigation',
      kind: 'navigation',
      title: `${label} — positive-navigation`,
      status: 'PLANNED',
      action: 'observe',
      expect: { locator, href: dest, control },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'positive-navigation',
      kind: 'navigation',
      title: `${label} — positive-navigation`,
      status: 'NOT_TESTED',
      action: 'none',
      reason: 'NOT_TESTED: no navigation destination discovered',
    });
  }

  const apiUrl = observedRequestUrl(element);
  if (apiUrl) {
    pushUnique(seen, plans, {
      subcaseId: 'positive-api',
      kind: 'click-behavior',
      title: `${label} — positive-api`,
      status: 'PLANNED',
      action: 'observe',
      expect: { locator, href: apiUrl, control },
      reason: `observed request URL from element evidence: ${apiUrl}`,
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'positive-api',
      kind: 'click-behavior',
      title: `${label} — positive-api`,
      status: 'NOT_TESTED',
      action: 'none',
      reason: 'NOT_TESTED: no API request was observed for this control',
    });
  }

  return { plans, exclusions };
}

function planLinkPositive(
  element: UiElementRecord,
  label: string,
  control: ControlKind,
  locator: string,
  stateChanging: boolean
): PositiveCaseResult {
  const plans: PositiveSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();
  const href = element.href ?? '';

  if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) {
    pushUnique(seen, plans, {
      subcaseId: 'positive-destination',
      kind: 'link-href',
      title: `${label} — positive-destination`,
      status: 'NOT_TESTED',
      action: 'none',
      reason: 'NOT_TESTED: no navigation destination discovered',
    });
    pushUnique(seen, plans, {
      subcaseId: 'positive-click',
      kind: 'click-link',
      title: `${label} — positive-click`,
      status: 'NOT_TESTED',
      action: 'none',
      reason: 'NOT_TESTED: click that would leave the safety model',
    });
    return { plans, exclusions };
  }

  if (stateChanging || !authorize({ kind: 'click-link', correlatesWithStateChange: stateChanging })) {
    pushUnique(seen, plans, {
      subcaseId: 'positive-click',
      kind: 'click-link',
      title: `${label} — positive-click`,
      status: 'BLOCKED',
      action: 'none',
      reason: 'BLOCKED: click that would leave the safety model',
    });
    pushUnique(seen, plans, {
      subcaseId: 'positive-destination',
      kind: 'link-href',
      title: `${label} — positive-destination`,
      status: 'PLANNED',
      action: 'observe',
      expect: { locator, href, control },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'positive-click',
      kind: 'click-link',
      title: `${label} — positive-click`,
      status: 'PLANNED',
      action: 'observe',
      expect: { locator, href, control },
    });
    pushUnique(seen, plans, {
      subcaseId: 'positive-destination',
      kind: 'link-href',
      title: `${label} — positive-destination`,
      status: 'PLANNED',
      action: 'observe',
      expect: { locator, href, control },
    });
  }

  pushUnique(seen, plans, {
    subcaseId: 'positive-page-state',
    kind: 'navigation',
    title: `${label} — positive-page-state`,
    status: 'PLANNED',
    action: 'observe',
    reason: 'destination URL was discovered',
    expect: { locator, href, control },
  });

  return { plans, exclusions };
}

/**
 * Build additional positive subcases from discovery evidence only.
 * Does not invent options, constraints, destinations, or API URLs.
 */
export function buildPositiveSubcases(input: {
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  label: string;
  locator: string;
  stateChanging: boolean;
  kind?: ElementKind;
  pageElements?: UiElementRecord[];
}): PositiveCaseResult {
  const { element, purpose, control, label, locator, stateChanging, kind } = input;
  const pageElements = input.pageElements ?? [];
  const fillAuthorized = authorize({ kind: 'fill-field' });

  if (purpose === 'select' || element.elementType === 'select') {
    return planSelectPositive(element, label, control, locator, fillAuthorized);
  }
  if (purpose === 'checkbox' || element.elementType === 'checkbox' || element.elementType === 'toggle') {
    return planCheckboxPositive(label, control, locator, fillAuthorized);
  }
  if (purpose === 'radio' || element.elementType === 'radio') {
    return planRadioPositive(element, label, control, locator, fillAuthorized, pageElements);
  }
  if (purpose === 'button') {
    return planButtonPositive(element, label, control, locator, stateChanging, kind);
  }
  if (purpose === 'navigation-link') {
    return planLinkPositive(element, label, control, locator, stateChanging);
  }
  if (
    purpose === 'text-input' ||
    purpose === 'password-input' ||
    element.elementType === 'input' ||
    element.elementType === 'textarea' ||
    element.elementType === 'search'
  ) {
    return planTextLikePositive(element, label, control, locator, fillAuthorized);
  }

  return { plans: [], exclusions: [] };
}

/**
 * Append positive subcase exclusion notes onto the compact excluded-categories reason.
 */
export function mergePositiveExclusions(baseReason: string | undefined, exclusions: string[]): string {
  const notes = exclusions.filter(Boolean);
  if (notes.length === 0) return baseReason ?? 'excluded:';
  if (!baseReason || baseReason.trim() === '') {
    return `excluded: ${notes.join('; ')}`;
  }
  if (baseReason.startsWith('excluded:')) {
    return `${baseReason}; ${notes.join('; ')}`;
  }
  return `excluded: ${baseReason}; ${notes.join('; ')}`;
}
