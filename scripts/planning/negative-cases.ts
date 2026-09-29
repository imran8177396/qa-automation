/**
 * Negative / invalid fill subcases for the existing planner.
 * Consumed only by buildScenarioInventory → planNegative — not a second planner.
 * Fixtures follow documented element constraints only (required, type, min/max,
 * minLength/maxLength, pattern, step, options, HTML input type). Never submit.
 * Never invent business rules, exploits, or real credentials.
 */

import { authorize } from '../core/safety-policy';
import type { UiElementRecord } from '../discovery/ui-scan';
import type {
  CheckKind,
  CheckStatus,
  ControlKind,
  ElementPurpose,
  PlannedAction,
  PlannedCheck,
} from './types';

export const NEGATIVE_FIXTURES = {
  emailMissingAt: 'userexample.com',
  emailMissingDomain: 'user@',
  emailInvalidDomain: 'user@invalid',
  emailDoubleAt: 'user@@example.com',
  emailSpaces: 'user @example.com',
  emailMalformed: 'user@example.com extra',
  passwordInvalid: 'wrong-password-fixture',
  numberNegative: '-1',
  numberZero: '0',
  numberDecimal: '1.5',
  numberString: 'not-a-number',
  numberScientific: '1e99',
  dateInvalid: '2024-13-40',
  dateWrongFormat: '31/31/2024',
  selectInvalidOption: 'not-an-option',
  unsupportedSafe: 'bad value!',
} as const;

export type NegativeSubcaseId =
  | 'negative-empty'
  | 'negative-null'
  | 'negative-invalid'
  | 'negative-wrong-format'
  | 'negative-wrong-type'
  | 'negative-invalid-option'
  | 'negative-unsupported'
  | 'negative-too-short'
  | 'negative-too-long'
  | 'negative-invalid-credentials'
  | 'negative-duplicate'
  | 'negative-expired'
  | 'negative-malformed'
  | 'negative-unexpected'
  | 'negative-unauthorized'
  | 'negative-forbidden'
  | 'negative-missing-at'
  | 'negative-missing-domain'
  | 'negative-invalid-domain'
  | 'negative-double-at'
  | 'negative-spaces'
  | 'negative-negative'
  | 'negative-zero'
  | 'negative-decimal'
  | 'negative-string'
  | 'negative-very-large'
  | 'negative-scientific'
  | 'negative-invalid-date'
  | 'negative-past'
  | 'negative-future'
  | 'negative-boundary'
  | 'negative-timezone';

export interface NegativeSubcasePlan {
  subcaseId: NegativeSubcaseId;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  reason?: string;
  expect?: PlannedCheck['expect'];
}

export interface NegativeCaseResult {
  /** Executable or recorded negative subcase rows (never PASS). */
  plans: NegativeSubcasePlan[];
  /** Compact exclusion notes for the existing NOT_APPLICABLE summary row. */
  exclusions: string[];
}

function parseLength(raw: string | null | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseNumber(raw: string | null | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
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

function stepOf(element: UiElementRecord): string | undefined {
  const s = element.attributes?.step;
  return s != null && s !== '' ? s : undefined;
}

function patternAllows(pattern: string, fixture: string): boolean {
  try {
    const re = new RegExp(`^(?:${pattern})$`);
    return re.test(fixture);
  } catch {
    return false;
  }
}

function discoveredOptionValues(element: UiElementRecord): string[] {
  if (Array.isArray(element.optionValues) && element.optionValues.length > 0) {
    return element.optionValues.filter((v) => typeof v === 'string' && v.length > 0);
  }
  return [];
}

function radioGroupOptionValues(
  element: UiElementRecord,
  pageElements: UiElementRecord[]
): string[] {
  const fromAttr = discoveredOptionValues(element);
  if (fromAttr.length > 0) return fromAttr;
  const name = element.attributes?.name ?? '';
  if (!name) {
    const v = element.attributes?.value;
    return v ? [v] : [];
  }
  const values: string[] = [];
  for (const el of pageElements) {
    const isRadio =
      el.elementType === 'radio' || (el.inputType ?? '').toLowerCase() === 'radio';
    if (!isRadio) continue;
    if ((el.attributes?.name ?? '') !== name) continue;
    const v = el.attributes?.value;
    if (v != null && v !== '') values.push(v);
  }
  return values;
}

function hasUniqueOrExpiryRule(element: UiElementRecord): boolean {
  const blob = `${element.evidence ?? ''} ${JSON.stringify(element.attributes ?? {})}`.toLowerCase();
  return /\b(unique|expiry|expires|expired)\b/.test(blob);
}

function pushUnique(
  seen: Set<string>,
  plans: NegativeSubcasePlan[],
  plan: NegativeSubcasePlan
): void {
  if (seen.has(plan.subcaseId)) return;
  seen.add(plan.subcaseId);
  plans.push(plan);
}

function excludeUnique(exclusions: string[], note: string): void {
  if (!exclusions.includes(note)) exclusions.push(note);
}

function fillPlan(
  input: {
    subcaseId: NegativeSubcaseId;
    title: string;
    fillValue: string;
    fillAuthorized: boolean;
    locator: string;
    control: ControlKind;
    element: UiElementRecord;
    kind?: CheckKind;
    reason?: string;
    constraintInvalid?: boolean;
    note?: string;
  }
): NegativeSubcasePlan {
  const {
    subcaseId,
    title,
    fillValue,
    fillAuthorized,
    locator,
    control,
    element,
    kind = 'invalid-input',
    reason,
    constraintInvalid,
    note,
  } = input;
  if (!fillAuthorized) {
    return {
      subcaseId,
      kind,
      title,
      status: 'BLOCKED',
      action: 'none',
      reason: 'BLOCKED: fill is not authorized by safety policy',
    };
  }
  return {
    subcaseId,
    kind: fillValue === '' ? 'empty-input' : kind,
    title,
    status: 'PLANNED',
    action: 'fill-no-submit',
    reason,
    expect: {
      locator,
      fillValue,
      required: Boolean(element.required),
      constraintInvalid,
      control,
      inputType: element.inputType ?? undefined,
      min: element.min ?? undefined,
      max: element.max ?? undefined,
      maxLength: element.maxLength ?? undefined,
      note,
    },
  };
}

function excludeEmptyNullUnsupportedCommon(
  element: UiElementRecord,
  exclusions: string[],
  opts: { planEmpty: boolean; textLike: boolean }
): void {
  if (!opts.planEmpty) {
    if (!element.required) {
      excludeUnique(exclusions, 'negative-empty (empty is valid when not required)');
    }
  }
  excludeUnique(
    exclusions,
    'negative-null (DOM fill has no null type; cleared value covered by empty when required)'
  );
  if (!hasUniqueOrExpiryRule(element)) {
    excludeUnique(exclusions, 'negative-duplicate (no documented uniqueness or expiry rule)');
    excludeUnique(exclusions, 'negative-expired (no documented uniqueness or expiry rule)');
  }
  if (opts.textLike) {
    excludeUnique(
      exclusions,
      'negative-unauthorized (no documented uniqueness, expiry, or authorization rule on this field)'
    );
    excludeUnique(
      exclusions,
      'negative-forbidden (no documented uniqueness, expiry, or authorization rule on this field)'
    );
  }
}

function planTooShortTooLong(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  seen: Set<string>,
  plans: NegativeSubcasePlan[],
  exclusions: string[]
): void {
  const minLen = parseLength(element.minLength ?? element.attributes?.minlength);
  if (minLen != null && minLen > 0) {
    // length = minLength-1; when minLength is 1, fixture "a" is empty-equivalent — still OK
    const shortFixture = minLen === 1 ? 'a' : 'a'.repeat(Math.max(0, minLen - 1));
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-too-short',
        title: `${label} — negative-too-short`,
        fillValue: shortFixture,
        fillAuthorized,
        locator,
        control,
        element,
        kind: 'invalid-input',
        constraintInvalid: true,
      })
    );
  } else {
    excludeUnique(exclusions, 'negative-too-short (no minLength documented)');
  }

  const maxLen = parseLength(element.maxLength ?? element.attributes?.maxlength);
  if (maxLen != null && maxLen > 0 && maxLen <= 40) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-too-long',
        title: `${label} — negative-too-long`,
        fillValue: 'a'.repeat(maxLen + 1),
        fillAuthorized,
        locator,
        control,
        element,
        kind: 'long-input',
        constraintInvalid: true,
      })
    );
  } else if (maxLen != null && maxLen > 40) {
    excludeUnique(
      exclusions,
      'negative-too-long (max length is too large to embed; not fabricated as a short string)'
    );
  } else {
    excludeUnique(exclusions, 'negative-too-long (no maximum documented)');
  }
}

function planPatternNegatives(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  seen: Set<string>,
  plans: NegativeSubcasePlan[],
  exclusions: string[]
): void {
  const pattern = patternOf(element);
  if (!pattern) {
    excludeUnique(exclusions, 'negative-unsupported (no pattern documented)');
    excludeUnique(exclusions, 'negative-malformed (no pattern documented)');
    excludeUnique(exclusions, 'negative-unexpected (no pattern documented)');
    return;
  }
  if (pattern.length > 80) {
    excludeUnique(exclusions, 'negative-malformed (pattern too long to evaluate safely)');
    excludeUnique(exclusions, 'negative-unsupported (pattern too long to evaluate safely)');
    excludeUnique(exclusions, 'negative-unexpected (pattern too long to evaluate safely)');
    return;
  }
  const fixture = NEGATIVE_FIXTURES.unsupportedSafe;
  if (patternAllows(pattern, fixture)) {
    excludeUnique(exclusions, 'negative-unsupported (fixture matches documented pattern)');
    excludeUnique(exclusions, 'negative-malformed (fixture matches documented pattern)');
    excludeUnique(exclusions, 'negative-unexpected (fixture matches documented pattern)');
    return;
  }
  pushUnique(
    seen,
    plans,
    fillPlan({
      subcaseId: 'negative-unsupported',
      title: `${label} — negative-unsupported`,
      fillValue: fixture,
      fillAuthorized,
      locator,
      control,
      element,
      kind: 'special-characters',
      constraintInvalid: true,
      reason: 'safe fixture that fails documented pattern; form is not submitted',
    })
  );
  pushUnique(
    seen,
    plans,
    fillPlan({
      subcaseId: 'negative-malformed',
      title: `${label} — negative-malformed`,
      fillValue: fixture,
      fillAuthorized,
      locator,
      control,
      element,
      constraintInvalid: true,
      reason: 'safe fixture that fails documented pattern; form is not submitted',
    })
  );
  // unexpected shares the same safe pattern-fail fixture; one planned row is enough —
  // record unexpected as exclusion sibling naming to avoid identical duplicate rows.
  excludeUnique(
    exclusions,
    'negative-unexpected (covered by negative-malformed pattern-fail fixture)'
  );
}

function planEmailNegatives(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean
): NegativeCaseResult {
  const plans: NegativeSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();

  if (element.required) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-empty',
        title: `${label} — negative-empty`,
        fillValue: '',
        fillAuthorized,
        locator,
        control,
        element,
        kind: 'empty-input',
      })
    );
  } else {
    excludeUnique(exclusions, 'negative-empty (empty is valid when not required)');
  }

  excludeEmptyNullUnsupportedCommon(element, exclusions, { planEmpty: element.required, textLike: true });

  const emailCases: Array<{ id: NegativeSubcaseId; value: string; title: string }> = [
    { id: 'negative-missing-at', value: NEGATIVE_FIXTURES.emailMissingAt, title: 'missing @' },
    { id: 'negative-missing-domain', value: NEGATIVE_FIXTURES.emailMissingDomain, title: 'missing domain' },
    { id: 'negative-invalid-domain', value: NEGATIVE_FIXTURES.emailInvalidDomain, title: 'invalid domain' },
    { id: 'negative-double-at', value: NEGATIVE_FIXTURES.emailDoubleAt, title: 'double @' },
    { id: 'negative-spaces', value: NEGATIVE_FIXTURES.emailSpaces, title: 'spaces' },
    { id: 'negative-malformed', value: NEGATIVE_FIXTURES.emailMalformed, title: 'malformed address' },
  ];

  for (const row of emailCases) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: row.id,
        title: `${label} — ${row.id} (${row.title})`,
        fillValue: row.value,
        fillAuthorized,
        locator,
        control,
        element,
        kind: 'invalid-input',
        constraintInvalid: true,
        reason: 'email format fixture from input type=email; form is not submitted',
      })
    );
  }

  planTooShortTooLong(element, label, locator, control, fillAuthorized, seen, plans, exclusions);

  // Type-inherent email format covers wrong-format / invalid; do not invent extras.
  excludeUnique(exclusions, 'negative-unsupported (no pattern documented)');
  excludeUnique(exclusions, 'negative-wrong-type (email format fixtures cover type-inherent failures)');

  return { plans, exclusions };
}

function planPasswordNegatives(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean
): NegativeCaseResult {
  const plans: NegativeSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();

  if (element.required) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-empty',
        title: `${label} — negative-empty`,
        fillValue: '',
        fillAuthorized,
        locator,
        control,
        element,
        kind: 'empty-input',
      })
    );
  } else {
    excludeUnique(exclusions, 'negative-empty (empty is valid when not required)');
  }

  excludeUnique(
    exclusions,
    'negative-null (DOM fill has no null type; cleared value covered by empty when required)'
  );

  pushUnique(
    seen,
    plans,
    fillPlan({
      subcaseId: 'negative-invalid-credentials',
      title: `${label} — negative-invalid-credentials`,
      fillValue: NEGATIVE_FIXTURES.passwordInvalid,
      fillAuthorized,
      locator,
      control,
      element,
      kind: 'invalid-input',
      reason: 'invalid credential fixture; form is not submitted',
    })
  );

  planTooShortTooLong(element, label, locator, control, fillAuthorized, seen, plans, exclusions);

  excludeUnique(
    exclusions,
    'negative-duplicate (no documented uniqueness, expiry, or authorization rule on this field)'
  );
  excludeUnique(
    exclusions,
    'negative-expired (no documented uniqueness, expiry, or authorization rule on this field)'
  );
  excludeUnique(
    exclusions,
    'negative-unauthorized (no documented uniqueness, expiry, or authorization rule on this field)'
  );
  excludeUnique(
    exclusions,
    'negative-forbidden (no documented uniqueness, expiry, or authorization rule on this field)'
  );
  excludeUnique(exclusions, 'negative-unsupported (no pattern documented)');
  excludeUnique(exclusions, 'negative-malformed (no pattern documented)');

  return { plans, exclusions };
}

function planNumberNegatives(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean
): NegativeCaseResult {
  const plans: NegativeSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();

  if (element.required) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-empty',
        title: `${label} — negative-empty`,
        fillValue: '',
        fillAuthorized,
        locator,
        control,
        element,
        kind: 'empty-input',
      })
    );
  } else {
    excludeUnique(exclusions, 'negative-empty (empty is valid when not required)');
  }

  excludeEmptyNullUnsupportedCommon(element, exclusions, { planEmpty: element.required, textLike: true });

  const min = parseNumber(element.min ?? element.attributes?.min);
  const max = parseNumber(element.max ?? element.attributes?.max);

  // Plan -1 unless min is negative and -1 is inside the documented [min,max] range.
  const negInsideDocumentedRange =
    min != null && min < 0 && -1 >= min && (max == null || -1 <= max);
  if (negInsideDocumentedRange) {
    excludeUnique(exclusions, 'negative-negative (value is inside documented min/max)');
  } else {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-negative',
        title: `${label} — negative-negative`,
        fillValue: NEGATIVE_FIXTURES.numberNegative,
        fillAuthorized,
        locator,
        control,
        element,
        constraintInvalid: true,
      })
    );
  }

  if ((min != null && min > 0) || (max != null && max < 0)) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-zero',
        title: `${label} — negative-zero`,
        fillValue: NEGATIVE_FIXTURES.numberZero,
        fillAuthorized,
        locator,
        control,
        element,
        constraintInvalid: true,
      })
    );
  } else {
    excludeUnique(exclusions, 'negative-zero (zero is not documented as invalid)');
  }

  const step = stepOf(element);
  const stepNum = step != null && step !== 'any' ? Number(step) : undefined;
  const stepIsInteger =
    step == null || (stepNum != null && Number.isFinite(stepNum) && Number.isInteger(stepNum));
  if (step === 'any' || (stepNum != null && !Number.isInteger(stepNum))) {
    excludeUnique(exclusions, 'negative-decimal (decimals are allowed by step)');
  } else if (stepIsInteger) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-decimal',
        title: `${label} — negative-decimal`,
        fillValue: NEGATIVE_FIXTURES.numberDecimal,
        fillAuthorized,
        locator,
        control,
        element,
        constraintInvalid: true,
      })
    );
  } else {
    excludeUnique(exclusions, 'negative-decimal (decimals are allowed by step)');
  }

  pushUnique(
    seen,
    plans,
    fillPlan({
      subcaseId: 'negative-string',
      title: `${label} — negative-string`,
      fillValue: NEGATIVE_FIXTURES.numberString,
      fillAuthorized,
      locator,
      control,
      element,
      kind: 'invalid-input',
      constraintInvalid: true,
      reason: 'wrong data type fixture for type=number; form is not submitted',
    })
  );

  if (max != null && max <= 1e6) {
    const next = max + 1;
    if (Number.isSafeInteger(next)) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'negative-very-large',
          title: `${label} — negative-very-large`,
          fillValue: String(next),
          fillAuthorized,
          locator,
          control,
          element,
          constraintInvalid: true,
        })
      );
    } else {
      excludeUnique(exclusions, 'negative-very-large (no maximum documented)');
    }
  } else {
    excludeUnique(exclusions, 'negative-very-large (no maximum documented)');
  }

  if (max != null && 1e99 > max) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-scientific',
        title: `${label} — negative-scientific`,
        fillValue: NEGATIVE_FIXTURES.numberScientific,
        fillAuthorized,
        locator,
        control,
        element,
        constraintInvalid: true,
      })
    );
  } else {
    excludeUnique(exclusions, 'negative-scientific (no maximum documented)');
  }

  excludeUnique(exclusions, 'negative-unsupported (no pattern documented)');
  excludeUnique(exclusions, 'negative-malformed (type=number format covered by typed fixtures)');

  return { plans, exclusions };
}

function shiftIsoDate(iso: string, deltaDays: number): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return undefined;
  const dt = new Date(Date.UTC(y, mo - 1, d + deltaDays));
  if (Number.isNaN(dt.getTime())) return undefined;
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function planDateNegatives(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  inputType: string
): NegativeCaseResult {
  const plans: NegativeSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();

  if (element.required) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-empty',
        title: `${label} — negative-empty`,
        fillValue: '',
        fillAuthorized,
        locator,
        control,
        element,
        kind: 'empty-input',
      })
    );
  } else {
    excludeUnique(exclusions, 'negative-empty (empty is valid when not required)');
  }

  excludeEmptyNullUnsupportedCommon(element, exclusions, { planEmpty: element.required, textLike: true });

  if (inputType === 'date') {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-invalid-date',
        title: `${label} — negative-invalid-date`,
        fillValue: NEGATIVE_FIXTURES.dateInvalid,
        fillAuthorized,
        locator,
        control,
        element,
        constraintInvalid: true,
        reason: 'invalid calendar date fixture for type=date; form is not submitted',
      })
    );
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-wrong-format',
        title: `${label} — negative-wrong-format`,
        fillValue: NEGATIVE_FIXTURES.dateWrongFormat,
        fillAuthorized,
        locator,
        control,
        element,
        constraintInvalid: true,
        reason: 'wrong format fixture for type=date; form is not submitted',
      })
    );
  } else {
    excludeUnique(exclusions, 'negative-invalid-date (type-inherent date fixtures apply to type=date)');
    excludeUnique(exclusions, 'negative-wrong-format (type-inherent date fixtures apply to type=date)');
  }

  const min = element.min ?? element.attributes?.min ?? '';
  const max = element.max ?? element.attributes?.max ?? '';
  let plannedPastOrFuture = false;

  if (min) {
    const past = shiftIsoDate(min, -1);
    if (past) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'negative-past',
          title: `${label} — negative-past`,
          fillValue: past,
          fillAuthorized,
          locator,
          control,
          element,
          constraintInvalid: true,
          reason: 'one day before documented min; form is not submitted',
        })
      );
      plannedPastOrFuture = true;
    } else {
      excludeUnique(exclusions, 'negative-past (no minimum date documented)');
    }
  } else {
    excludeUnique(exclusions, 'negative-past (no minimum date documented)');
  }

  if (max) {
    const future = shiftIsoDate(max, 1);
    if (future) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'negative-future',
          title: `${label} — negative-future`,
          fillValue: future,
          fillAuthorized,
          locator,
          control,
          element,
          constraintInvalid: true,
          reason: 'one day after documented max; form is not submitted',
        })
      );
      plannedPastOrFuture = true;
    } else {
      excludeUnique(exclusions, 'negative-future (no maximum date documented)');
    }
  } else {
    excludeUnique(exclusions, 'negative-future (no maximum date documented)');
  }

  if (!plannedPastOrFuture) {
    excludeUnique(exclusions, 'negative-boundary (no min or max date documented)');
  }
  // boundary is the same as past/future outside range — do not emit a third duplicate row.

  const hasTimezoneAttr = Boolean(
    element.attributes?.timezone || element.attributes?.tz || element.attributes?.['data-timezone']
  );
  if (inputType === 'datetime-local' && hasTimezoneAttr) {
    excludeUnique(exclusions, 'negative-timezone (no executable timezone fixture without submit)');
  } else {
    excludeUnique(exclusions, 'negative-timezone (no timezone rule documented)');
  }

  return { plans, exclusions };
}

function planTextLikeNegatives(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean
): NegativeCaseResult {
  const plans: NegativeSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();
  const inputType = inputTypeOf(element);
  const isEmail = inputType === 'email' || element.elementKind === 'email-input';
  const isPassword = inputType === 'password' || element.elementKind === 'password-input';
  const isNumber = inputType === 'number' || element.elementKind === 'number-input';
  const isDate =
    inputType === 'date' ||
    inputType === 'datetime-local' ||
    inputType === 'datetime' ||
    inputType === 'time' ||
    element.elementKind === 'date-input' ||
    element.elementKind === 'datetime-input' ||
    element.elementKind === 'time-input';

  if (isEmail) return planEmailNegatives(element, label, locator, control, fillAuthorized);
  if (isPassword) return planPasswordNegatives(element, label, locator, control, fillAuthorized);
  if (isNumber) return planNumberNegatives(element, label, locator, control, fillAuthorized);
  if (isDate) return planDateNegatives(element, label, locator, control, fillAuthorized, inputType || 'date');

  // Generic text / search / textarea
  if (element.required || isFreeTextType(element)) {
    if (element.required) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'negative-empty',
          title: `${label} — negative-empty`,
          fillValue: '',
          fillAuthorized,
          locator,
          control,
          element,
          kind: 'empty-input',
        })
      );
    } else {
      // optional generic text — empty is a valid optional value
      excludeUnique(exclusions, 'negative-empty (empty is valid when not required)');
    }
  } else if (!element.required) {
    excludeUnique(exclusions, 'negative-empty (empty is valid when not required)');
  }

  excludeUnique(
    exclusions,
    'negative-null (DOM fill has no null type; cleared value covered by empty when required)'
  );

  planPatternNegatives(element, label, locator, control, fillAuthorized, seen, plans, exclusions);
  planTooShortTooLong(element, label, locator, control, fillAuthorized, seen, plans, exclusions);

  if (!hasUniqueOrExpiryRule(element)) {
    excludeUnique(exclusions, 'negative-duplicate (no documented uniqueness or expiry rule)');
    excludeUnique(exclusions, 'negative-expired (no documented uniqueness or expiry rule)');
  }
  excludeUnique(
    exclusions,
    'negative-unauthorized (no documented uniqueness, expiry, or authorization rule on this field)'
  );
  excludeUnique(
    exclusions,
    'negative-forbidden (no documented uniqueness, expiry, or authorization rule on this field)'
  );
  excludeUnique(exclusions, 'negative-wrong-type (no documented type rule beyond fillable text)');
  excludeUnique(exclusions, 'negative-invalid (no documented invalid-value rule beyond constraints)');

  return { plans, exclusions };
}

function planSelectNegatives(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean
): NegativeCaseResult {
  const plans: NegativeSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();
  const options = discoveredOptionValues(element);

  excludeUnique(exclusions, 'negative-empty (not a text value)');
  excludeUnique(exclusions, 'negative-null (not a text value)');
  excludeUnique(exclusions, 'negative-unsupported (not a text value)');
  excludeUnique(exclusions, 'negative-malformed (not a text value)');
  excludeUnique(exclusions, 'negative-too-short (not a text value)');
  excludeUnique(exclusions, 'negative-too-long (not a text value)');

  if (options.length > 0) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'negative-invalid-option',
        title: `${label} — negative-invalid-option`,
        fillValue: NEGATIVE_FIXTURES.selectInvalidOption,
        fillAuthorized,
        locator,
        control,
        element,
        kind: 'select-options',
        constraintInvalid: true,
        reason: 'value not in options; option is not added to the DOM; form is not submitted',
        note: 'value not in options',
      })
    );
  } else {
    excludeUnique(exclusions, 'negative-invalid-option (no options discovered)');
  }

  if (!hasUniqueOrExpiryRule(element)) {
    excludeUnique(exclusions, 'negative-duplicate (no documented uniqueness or expiry rule)');
    excludeUnique(exclusions, 'negative-expired (no documented uniqueness or expiry rule)');
  }

  return { plans, exclusions };
}

function planCheckboxRadioNegatives(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  pageElements: UiElementRecord[],
  isRadio: boolean
): NegativeCaseResult {
  const plans: NegativeSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();

  excludeUnique(exclusions, 'negative-empty (not a text value)');
  excludeUnique(exclusions, 'negative-null (not a text value)');
  excludeUnique(exclusions, 'negative-wrong-format (not a text value)');
  excludeUnique(exclusions, 'negative-unsupported (not a text value)');
  excludeUnique(exclusions, 'negative-malformed (not a text value)');

  if (isRadio) {
    const options = radioGroupOptionValues(element, pageElements);
    if (options.length > 0) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'negative-invalid-option',
          title: `${label} — negative-invalid-option`,
          fillValue: NEGATIVE_FIXTURES.selectInvalidOption,
          fillAuthorized,
          locator,
          control,
          element,
          kind: 'invalid-input',
          constraintInvalid: true,
          reason: 'value not in options; option is not added to the DOM; form is not submitted',
          note: 'value not in options',
        })
      );
    } else {
      excludeUnique(exclusions, 'negative-invalid-option (no options discovered)');
    }
  } else {
    excludeUnique(exclusions, 'negative-invalid-option (not applicable to checkbox)');
  }

  if (!hasUniqueOrExpiryRule(element)) {
    excludeUnique(exclusions, 'negative-duplicate (no documented uniqueness or expiry rule)');
    excludeUnique(exclusions, 'negative-expired (no documented uniqueness or expiry rule)');
  }

  return { plans, exclusions };
}

function planActionNegatives(label: string): NegativeCaseResult {
  // Unauthorized / forbidden are recorded, never executed as clicks.
  return {
    plans: [
      {
        subcaseId: 'negative-unauthorized',
        kind: 'click-behavior',
        title: `${label} — negative-unauthorized`,
        status: 'NOT_TESTED',
        action: 'none',
        reason:
          'NOT_TESTED: unauthorized/forbidden action is not executed; no authorization matrix was discovered',
      },
      {
        subcaseId: 'negative-forbidden',
        kind: 'click-behavior',
        title: `${label} — negative-forbidden`,
        status: 'NOT_TESTED',
        action: 'none',
        reason:
          'NOT_TESTED: unauthorized/forbidden action is not executed; no authorization matrix was discovered',
      },
    ],
    exclusions: [],
  };
}

/**
 * Build negative subcases from discovery evidence / documented constraints only.
 * Fill-only (never submit). Never PASS. Never invent business rules or exploits.
 */
export function buildNegativeSubcases(input: {
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  label: string;
  locator: string;
  pageElements?: UiElementRecord[];
}): NegativeCaseResult {
  const { element, purpose, control, label, locator } = input;
  const pageElements = input.pageElements ?? [];
  const fillAuthorized = authorize({ kind: 'fill-field' });

  if (purpose === 'button' || purpose === 'navigation-link' || purpose === 'form') {
    return planActionNegatives(label);
  }

  if (purpose === 'select' || element.elementType === 'select') {
    return planSelectNegatives(element, label, locator, control, fillAuthorized);
  }
  if (purpose === 'checkbox' || element.elementType === 'checkbox' || element.elementType === 'toggle') {
    return planCheckboxRadioNegatives(element, label, locator, control, fillAuthorized, pageElements, false);
  }
  if (purpose === 'radio' || element.elementType === 'radio') {
    return planCheckboxRadioNegatives(element, label, locator, control, fillAuthorized, pageElements, true);
  }
  if (
    purpose === 'text-input' ||
    purpose === 'password-input' ||
    element.elementType === 'input' ||
    element.elementType === 'textarea' ||
    element.elementType === 'search'
  ) {
    return planTextLikeNegatives(element, label, locator, control, fillAuthorized);
  }

  return {
    plans: [],
    exclusions: [`negative-${purpose} (no documented rule discovered)`],
  };
}

/**
 * Append negative subcase exclusion notes onto the compact excluded-categories reason.
 */
export function mergeNegativeExclusions(baseReason: string | undefined, exclusions: string[]): string {
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
