/**
 * Edge / boundary fill subcases for the existing planner.
 * Consumed only by buildScenarioInventory → planEdge — not a second planner.
 * Fixtures follow discovered constraints only (min/max, minLength/maxLength, type).
 * Never invent min/max. Never submit. Never emit exploit payloads.
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

export const EDGE_FIXTURES = {
  whitespace: '   ',
  leadingSpace: ' value',
  trailingSpace: 'value ',
  special: 'a+b_c',
  unicode: 'café',
  emoji: 'a😀b',
  newline: 'a\nb',
  multiline: 'line1\nline2\nline3',
  zero: '0',
  negative: '-1',
  emailLeading: ' user@example.com',
  emailTrailing: 'user@example.com ',
  passwordSpecial: 'a+b_c',
} as const;

export type EdgeSubcaseId =
  | 'edge-min'
  | 'edge-min-minus-5'
  | 'edge-min-plus-5'
  | 'edge-max'
  | 'edge-max-minus-5'
  | 'edge-max-plus-5'
  | 'edge-empty'
  | 'edge-null'
  | 'edge-zero'
  | 'edge-negative'
  | 'edge-very-large'
  | 'edge-very-small'
  | 'edge-whitespace'
  | 'edge-leading-space'
  | 'edge-trailing-space'
  | 'edge-special'
  | 'edge-unicode'
  | 'edge-emoji'
  | 'edge-newline'
  | 'edge-multiline'
  | 'edge-duplicate'
  | 'edge-rapid'
  | 'edge-paste';

export interface EdgeSubcasePlan {
  subcaseId: EdgeSubcaseId;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  reason?: string;
  expect?: PlannedCheck['expect'];
}

export interface EdgeCaseResult {
  /** Executable or recorded edge subcase rows (never PASS). */
  plans: EdgeSubcasePlan[];
  /** Compact exclusion notes for the existing NOT_APPLICABLE summary row. */
  exclusions: string[];
}

const SAFE_INT_ABS = 1_000_000;
const MAX_EMBED_LENGTH = 40;

function parseLength(raw: string | null | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseFiniteNumber(raw: string | null | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function inputTypeOf(element: UiElementRecord): string {
  return (element.inputType ?? element.attributes?.type ?? '').toLowerCase();
}

function isNumberType(element: UiElementRecord): boolean {
  const t = inputTypeOf(element);
  return t === 'number' || element.elementKind === 'number-input';
}

function isEmailType(element: UiElementRecord): boolean {
  const t = inputTypeOf(element);
  return t === 'email' || element.elementKind === 'email-input';
}

function isPasswordType(element: UiElementRecord): boolean {
  const t = inputTypeOf(element);
  return t === 'password' || element.elementKind === 'password-input';
}

function isDateLike(element: UiElementRecord): boolean {
  const t = inputTypeOf(element);
  return (
    t === 'date' ||
    t === 'time' ||
    t === 'datetime-local' ||
    t === 'month' ||
    t === 'week' ||
    element.elementKind === 'date-input' ||
    element.elementKind === 'time-input' ||
    element.elementKind === 'datetime-input'
  );
}

function isTextarea(element: UiElementRecord): boolean {
  return element.elementType === 'textarea' || element.elementKind === 'textarea' || element.tag === 'textarea';
}

function isFreeTextLike(element: UiElementRecord): boolean {
  const t = inputTypeOf(element);
  return (
    t === '' ||
    t === 'text' ||
    t === 'search' ||
    element.elementType === 'search' ||
    element.elementKind === 'search-field' ||
    isTextarea(element)
  );
}

function isLengthTextLike(element: UiElementRecord): boolean {
  return (
    isFreeTextLike(element) ||
    isEmailType(element) ||
    isPasswordType(element) ||
    element.elementType === 'input' ||
    element.elementType === 'textarea' ||
    element.elementType === 'search'
  );
}

function isWhitespaceApplicable(element: UiElementRecord): boolean {
  return (
    isFreeTextLike(element) ||
    isEmailType(element) ||
    isPasswordType(element)
  );
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

function hasUniqueRule(element: UiElementRecord): boolean {
  const blob = `${element.evidence ?? ''} ${JSON.stringify(element.attributes ?? {})}`.toLowerCase();
  return /\bunique\b/.test(blob);
}

function pushUnique(seen: Set<string>, plans: EdgeSubcasePlan[], plan: EdgeSubcasePlan): void {
  if (seen.has(plan.subcaseId)) return;
  seen.add(plan.subcaseId);
  plans.push(plan);
}

function excludeUnique(exclusions: string[], note: string): void {
  if (!exclusions.includes(note)) exclusions.push(note);
}

/** Positive-cases text max fixture (may differ from edge-max when maxLength > 32). */
function positiveTextMaxValue(maxLength: number): string {
  const preferred = Math.min(maxLength, 32);
  if (maxLength > 64) {
    return 'a'.repeat(Math.min(preferred, 64));
  }
  return 'a'.repeat(preferred);
}

function positiveMinCoveredValue(element: UiElementRecord): string | undefined {
  if (isNumberType(element)) {
    const min = parseFiniteNumber(element.min ?? element.attributes?.min);
    return min != null ? String(min) : undefined;
  }
  const minLen = parseLength(element.minLength ?? element.attributes?.minlength);
  if (minLen != null) {
    if (isPasswordType(element)) return 'a'.repeat(Math.min(Math.max(0, minLen), 64));
    return 'a'.repeat(minLen);
  }
  return undefined;
}

function positiveMaxCoveredValue(element: UiElementRecord): string | undefined {
  if (isNumberType(element)) {
    const max = parseFiniteNumber(element.max ?? element.attributes?.max);
    return max != null ? String(max) : undefined;
  }
  const maxLen = parseLength(element.maxLength ?? element.attributes?.maxlength);
  if (maxLen != null) {
    if (isPasswordType(element)) return 'a'.repeat(Math.min(Math.max(0, maxLen), 64));
    return positiveTextMaxValue(maxLen);
  }
  return undefined;
}

function fillPlan(input: {
  subcaseId: EdgeSubcaseId;
  title: string;
  fillValue: string;
  fillAuthorized: boolean;
  locator: string;
  control: ControlKind;
  element: UiElementRecord;
  kind?: CheckKind;
  reason?: string;
  note?: string;
  constraintInvalid?: boolean;
}): EdgeSubcasePlan {
  const {
    subcaseId,
    title,
    fillValue,
    fillAuthorized,
    locator,
    control,
    element,
    kind = 'boundary-values',
    reason,
    note,
    constraintInvalid,
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
      boundary: true,
      note,
    },
  };
}

/** Track planned fill values so we do not emit two rows with the same value and assertion. */
function registerValue(
  byValue: Map<string, string>,
  value: string,
  assertionKey: string
): boolean {
  const prev = byValue.get(value);
  if (prev != null && prev === assertionKey) return false;
  byValue.set(value, assertionKey);
  return true;
}

function planNumericBoundaries(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  seen: Set<string>,
  plans: EdgeSubcasePlan[],
  exclusions: string[],
  byValue: Map<string, string>,
  positiveCovered?: { min?: string; max?: string }
): { min?: number; max?: number } {
  const min = parseFiniteNumber(element.min ?? element.attributes?.min);
  const max = parseFiniteNumber(element.max ?? element.attributes?.max);
  const coveredMin = positiveCovered?.min;
  const coveredMax = positiveCovered?.max;

  if (min == null) {
    excludeUnique(exclusions, 'edge-min (no minimum constraint discovered)');
    excludeUnique(exclusions, 'edge-min-minus-5 (no minimum constraint discovered)');
    excludeUnique(exclusions, 'edge-min-plus-5 (no minimum constraint discovered)');
  } else {
    const minStr = String(min);
    if (coveredMin === minStr) {
      excludeUnique(exclusions, 'edge-min (already covered by positive-min)');
    } else if (registerValue(byValue, minStr, 'at-minimum')) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'edge-min',
          title: `${label} — edge-min (at minimum)`,
          fillValue: minStr,
          fillAuthorized,
          locator,
          control,
          element,
          note: 'at documented minimum',
        })
      );
    }

    const below = min - 5;
    const belowStr = String(below);
    if (registerValue(byValue, belowStr, 'below-minimum')) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'edge-min-minus-5',
          title: `${label} — edge-min-minus-5 (below minimum)`,
          fillValue: belowStr,
          fillAuthorized,
          locator,
          control,
          element,
          constraintInvalid: true,
          note: 'below documented minimum',
        })
      );
    }

    const minPlus = min + 5;
    if (max != null && minPlus > max) {
      excludeUnique(exclusions, 'edge-min-plus-5 (min+5 exceeds documented maximum)');
    } else {
      const plusStr = String(minPlus);
      if (registerValue(byValue, plusStr, 'inside-above-min')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-min-plus-5',
            title: `${label} — edge-min-plus-5 (above minimum, inside range)`,
            fillValue: plusStr,
            fillAuthorized,
            locator,
            control,
            element,
            note: 'minimum plus 5',
          })
        );
      }
    }
  }

  if (max == null) {
    excludeUnique(exclusions, 'edge-max (no maximum constraint discovered)');
    excludeUnique(exclusions, 'edge-max-minus-5 (no maximum constraint discovered)');
    excludeUnique(exclusions, 'edge-max-plus-5 (no maximum constraint discovered)');
  } else {
    const maxStr = String(max);
    if (coveredMax === maxStr) {
      excludeUnique(exclusions, 'edge-max (already covered by positive-max)');
    } else if (registerValue(byValue, maxStr, 'at-maximum')) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'edge-max',
          title: `${label} — edge-max (at maximum)`,
          fillValue: maxStr,
          fillAuthorized,
          locator,
          control,
          element,
          note: 'at documented maximum',
        })
      );
    }

    const maxMinus = max - 5;
    if (min != null && maxMinus < min) {
      excludeUnique(exclusions, 'edge-max-minus-5 (max-5 below documented minimum)');
    } else {
      const minusStr = String(maxMinus);
      // Same numeric value as min+5 is OK when assertion differs (inside vs near-max).
      if (registerValue(byValue, minusStr, 'inside-below-max')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-max-minus-5',
            title: `${label} — edge-max-minus-5 (below maximum, inside range)`,
            fillValue: minusStr,
            fillAuthorized,
            locator,
            control,
            element,
            note: 'maximum minus 5',
          })
        );
      } else if (byValue.get(minusStr) === 'inside-above-min') {
        // Allow a second row when min+5 === max-5: different assertion (near-max).
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-max-minus-5',
            title: `${label} — edge-max-minus-5 (below maximum, inside range)`,
            fillValue: minusStr,
            fillAuthorized,
            locator,
            control,
            element,
            note: 'maximum minus 5',
          })
        );
      }
    }

    const above = max + 5;
    const aboveStr = String(above);
    if (registerValue(byValue, aboveStr, 'above-maximum')) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'edge-max-plus-5',
          title: `${label} — edge-max-plus-5 (above maximum)`,
          fillValue: aboveStr,
          fillAuthorized,
          locator,
          control,
          element,
          constraintInvalid: true,
          note: 'above documented maximum',
        })
      );
    }
  }

  return { min, max };
}

function planLengthBoundaries(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  seen: Set<string>,
  plans: EdgeSubcasePlan[],
  exclusions: string[],
  byValue: Map<string, string>,
  positiveCovered?: { min?: string; max?: string }
): void {
  const minLen = parseLength(element.minLength ?? element.attributes?.minlength);
  const maxLen = parseLength(element.maxLength ?? element.attributes?.maxlength);
  const coveredMin = positiveCovered?.min;
  const coveredMax = positiveCovered?.max;
  const char = 'a';

  if (minLen == null) {
    excludeUnique(exclusions, 'edge-min (no minimum constraint discovered)');
    excludeUnique(exclusions, 'edge-min-minus-5 (no minimum constraint discovered)');
    excludeUnique(exclusions, 'edge-min-plus-5 (no minimum constraint discovered)');
  } else {
    if (minLen > 0 && minLen <= MAX_EMBED_LENGTH) {
      const atMin = char.repeat(minLen);
      if (coveredMin === atMin) {
        excludeUnique(exclusions, 'edge-min (already covered by positive-min)');
      } else if (registerValue(byValue, atMin, 'at-min-length')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-min',
            title: `${label} — edge-min (minLength ${minLen})`,
            fillValue: atMin,
            fillAuthorized,
            locator,
            control,
            element,
            note: `length ${minLen}`,
          })
        );
      }
    } else if (minLen === 0) {
      excludeUnique(exclusions, 'edge-min (minLength is zero; empty covered separately)');
    } else {
      excludeUnique(exclusions, 'edge-min (length too large to embed)');
    }

    const shortLen = Math.max(0, minLen - 5);
    if (minLen < 5 && shortLen === 0) {
      excludeUnique(
        exclusions,
        'edge-min-minus-5 (shorter than minimum collapses to empty)'
      );
    } else if (minLen > 0 && shortLen === 0) {
      const empty = '';
      if (registerValue(byValue, empty, 'below-min-length')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-min-minus-5',
            title: `${label} — edge-min-minus-5 (below minLength)`,
            fillValue: empty,
            fillAuthorized,
            locator,
            control,
            element,
            constraintInvalid: true,
            reason: `length 0 is below documented minLength ${minLen}`,
            note: `length 0 (minLength-5)`,
          })
        );
      }
    } else if (minLen > 0) {
      const short = char.repeat(shortLen);
      if (registerValue(byValue, short, 'below-min-length')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-min-minus-5',
            title: `${label} — edge-min-minus-5 (below minLength)`,
            fillValue: short,
            fillAuthorized,
            locator,
            control,
            element,
            constraintInvalid: true,
            note: `length ${shortLen}`,
          })
        );
      }
    } else {
      excludeUnique(exclusions, 'edge-min-minus-5 (no positive minLength)');
    }

    const minPlusLen = minLen + 5;
    if (maxLen != null && minPlusLen > maxLen) {
      excludeUnique(exclusions, 'edge-min-plus-5 (min+5 exceeds documented maximum)');
    } else if (minPlusLen > MAX_EMBED_LENGTH) {
      excludeUnique(exclusions, 'edge-min-plus-5 (length too large to embed)');
    } else {
      const mid = char.repeat(minPlusLen);
      if (registerValue(byValue, mid, 'above-min-length')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-min-plus-5',
            title: `${label} — edge-min-plus-5 (above minLength)`,
            fillValue: mid,
            fillAuthorized,
            locator,
            control,
            element,
            note: `length ${minPlusLen}`,
          })
        );
      }
    }
  }

  if (maxLen == null) {
    excludeUnique(exclusions, 'edge-max (no maximum constraint discovered)');
    excludeUnique(exclusions, 'edge-max-minus-5 (no maximum constraint discovered)');
    excludeUnique(exclusions, 'edge-max-plus-5 (no maximum constraint discovered)');
  } else {
    if (maxLen > 0 && maxLen <= MAX_EMBED_LENGTH) {
      const atMax = char.repeat(maxLen);
      if (coveredMax === atMax) {
        excludeUnique(exclusions, 'edge-max (already covered by positive-max)');
      } else if (registerValue(byValue, atMax, 'at-max-length')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-max',
            title: `${label} — edge-max (maxLength ${maxLen})`,
            fillValue: atMax,
            fillAuthorized,
            locator,
            control,
            element,
            note: `length ${maxLen}`,
          })
        );
      }
    } else if (maxLen === 0) {
      excludeUnique(exclusions, 'edge-max (maxLength is zero)');
    } else {
      excludeUnique(exclusions, 'edge-max (length too large to embed)');
    }

    const maxMinusLen = Math.max(0, maxLen - 5);
    if (minLen != null && maxMinusLen < minLen) {
      excludeUnique(exclusions, 'edge-max-minus-5 (max-5 below documented minimum)');
    } else if (maxLen > 0 && maxMinusLen <= MAX_EMBED_LENGTH) {
      const near = char.repeat(maxMinusLen);
      if (registerValue(byValue, near, 'below-max-length')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-max-minus-5',
            title: `${label} — edge-max-minus-5 (below maxLength)`,
            fillValue: near,
            fillAuthorized,
            locator,
            control,
            element,
            note: `length ${maxMinusLen}`,
          })
        );
      } else if (byValue.get(near) === 'above-min-length') {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-max-minus-5',
            title: `${label} — edge-max-minus-5 (below maxLength)`,
            fillValue: near,
            fillAuthorized,
            locator,
            control,
            element,
            note: `length ${maxMinusLen}`,
          })
        );
      }
    } else {
      excludeUnique(exclusions, 'edge-max-minus-5 (length not embeddable)');
    }

    const overLen = maxLen + 5;
    if (overLen > MAX_EMBED_LENGTH) {
      excludeUnique(exclusions, 'edge-max-plus-5 (length too large to embed)');
    } else {
      const over = char.repeat(overLen);
      if (registerValue(byValue, over, 'above-max-length')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-max-plus-5',
            title: `${label} — edge-max-plus-5 (above maxLength)`,
            fillValue: over,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'long-input',
            constraintInvalid: true,
            note: `length ${overLen}`,
          })
        );
      }
    }
  }
}

function planZeroNegativeVery(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  seen: Set<string>,
  plans: EdgeSubcasePlan[],
  exclusions: string[],
  byValue: Map<string, string>,
  range: { min?: number; max?: number }
): void {
  if (!isNumberType(element)) {
    excludeUnique(exclusions, 'edge-zero (not applicable to non-number)');
    excludeUnique(exclusions, 'edge-negative (not applicable to non-number)');
    excludeUnique(exclusions, 'edge-very-large (not applicable to non-number)');
    excludeUnique(exclusions, 'edge-very-small (not applicable to non-number)');
    return;
  }

  const { min, max } = range;

  // zero: only when outside a discovered range
  if (min == null && max == null) {
    excludeUnique(exclusions, 'edge-zero (zero is not outside a discovered range)');
  } else if ((min != null && 0 < min) || (max != null && 0 > max)) {
    if (registerValue(byValue, EDGE_FIXTURES.zero, 'zero-outside-range')) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'edge-zero',
          title: `${label} — edge-zero (outside range)`,
          fillValue: EDGE_FIXTURES.zero,
          fillAuthorized,
          locator,
          control,
          element,
          constraintInvalid: true,
        })
      );
    }
  } else {
    excludeUnique(exclusions, 'edge-zero (zero is not outside a discovered range)');
  }

  // negative: only when -1 is below a documented minimum
  if (min != null && -1 < min) {
    if (registerValue(byValue, EDGE_FIXTURES.negative, 'negative-outside-range')) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'edge-negative',
          title: `${label} — edge-negative (below minimum)`,
          fillValue: EDGE_FIXTURES.negative,
          fillAuthorized,
          locator,
          control,
          element,
          constraintInvalid: true,
        })
      );
    }
  } else {
    excludeUnique(
      exclusions,
      'edge-negative (no minimum documents that negatives are out of range)'
    );
  }

  // very-large: max+1 when safe; skip if same value already planned (e.g. max+5 === max+1 never)
  if (max != null) {
    const large = max + 1;
    if (Math.abs(large) <= SAFE_INT_ABS && Number.isSafeInteger(large)) {
      const largeStr = String(large);
      if (byValue.has(largeStr) && byValue.get(largeStr) === 'above-maximum') {
        excludeUnique(exclusions, 'edge-very-large (already covered by edge-max-plus-5)');
      } else if (registerValue(byValue, largeStr, 'very-large')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-very-large',
            title: `${label} — edge-very-large (just above maximum)`,
            fillValue: largeStr,
            fillAuthorized,
            locator,
            control,
            element,
            constraintInvalid: true,
          })
        );
      }
    } else {
      excludeUnique(exclusions, 'edge-very-large (value not a safe embeddable integer)');
    }
  } else {
    excludeUnique(exclusions, 'edge-very-large (no maximum constraint discovered)');
  }

  if (min != null) {
    const small = min - 1;
    if (Math.abs(small) <= SAFE_INT_ABS && Number.isSafeInteger(small)) {
      const smallStr = String(small);
      if (byValue.has(smallStr) && byValue.get(smallStr) === 'below-minimum') {
        excludeUnique(exclusions, 'edge-very-small (already covered by edge-min-minus-5)');
      } else if (registerValue(byValue, smallStr, 'very-small')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-very-small',
            title: `${label} — edge-very-small (just below minimum)`,
            fillValue: smallStr,
            fillAuthorized,
            locator,
            control,
            element,
            constraintInvalid: true,
          })
        );
      }
    } else {
      excludeUnique(exclusions, 'edge-very-small (value not a safe embeddable integer)');
    }
  } else {
    excludeUnique(exclusions, 'edge-very-small (no minimum constraint discovered)');
  }
}

function planFormatEdges(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  seen: Set<string>,
  plans: EdgeSubcasePlan[],
  exclusions: string[],
  byValue: Map<string, string>
): void {
  // empty — required text-like only (text, search, textarea, password, email)
  if (isNumberType(element) || isDateLike(element)) {
    excludeUnique(exclusions, 'edge-empty (not applicable to number/date)');
  } else if (
    element.required &&
    (isFreeTextLike(element) || isEmailType(element) || isPasswordType(element))
  ) {
    if (registerValue(byValue, '', 'empty-required')) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'edge-empty',
          title: `${label} — edge-empty`,
          fillValue: '',
          fillAuthorized,
          locator,
          control,
          element,
          kind: 'empty-input',
        })
      );
    }
  } else if (!element.required) {
    excludeUnique(exclusions, 'edge-empty (empty is valid when not required)');
  } else {
    excludeUnique(exclusions, 'edge-empty (empty is valid when not required)');
  }

  excludeUnique(exclusions, 'edge-null (DOM fill has no null type)');

  // whitespace family
  if (isNumberType(element)) {
    excludeUnique(exclusions, 'edge-whitespace (not applicable to number)');
    excludeUnique(exclusions, 'edge-leading-space (not applicable to number)');
    excludeUnique(exclusions, 'edge-trailing-space (not applicable to number)');
  } else if (isDateLike(element)) {
    excludeUnique(exclusions, 'edge-whitespace (not applicable to date/time)');
    excludeUnique(exclusions, 'edge-leading-space (not applicable to date/time)');
    excludeUnique(exclusions, 'edge-trailing-space (not applicable to date/time)');
  } else if (isWhitespaceApplicable(element)) {
    if (isEmailType(element)) {
      excludeUnique(
        exclusions,
        'edge-whitespace (already covered by negative email spaces)'
      );
      if (registerValue(byValue, EDGE_FIXTURES.emailLeading, 'email-leading-space')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-leading-space',
            title: `${label} — edge-leading-space`,
            fillValue: EDGE_FIXTURES.emailLeading,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'whitespace-input',
            constraintInvalid: true,
          })
        );
      }
      if (registerValue(byValue, EDGE_FIXTURES.emailTrailing, 'email-trailing-space')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-trailing-space',
            title: `${label} — edge-trailing-space`,
            fillValue: EDGE_FIXTURES.emailTrailing,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'whitespace-input',
            constraintInvalid: true,
          })
        );
      }
    } else {
      if (registerValue(byValue, EDGE_FIXTURES.whitespace, 'whitespace')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-whitespace',
            title: `${label} — edge-whitespace`,
            fillValue: EDGE_FIXTURES.whitespace,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'whitespace-input',
          })
        );
      }
      if (registerValue(byValue, EDGE_FIXTURES.leadingSpace, 'leading-space')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-leading-space',
            title: `${label} — edge-leading-space`,
            fillValue: EDGE_FIXTURES.leadingSpace,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'whitespace-input',
          })
        );
      }
      if (registerValue(byValue, EDGE_FIXTURES.trailingSpace, 'trailing-space')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-trailing-space',
            title: `${label} — edge-trailing-space`,
            fillValue: EDGE_FIXTURES.trailingSpace,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'whitespace-input',
          })
        );
      }
    }
  } else {
    excludeUnique(exclusions, 'edge-whitespace (not applicable to this control type)');
    excludeUnique(exclusions, 'edge-leading-space (not applicable to this control type)');
    excludeUnique(exclusions, 'edge-trailing-space (not applicable to this control type)');
  }

  // special
  const pattern = patternOf(element);
  if (isEmailType(element)) {
    excludeUnique(exclusions, 'edge-special (plus and symbols covered by email format cases)');
  } else if (isNumberType(element) || isDateLike(element)) {
    excludeUnique(exclusions, 'edge-special (not applicable to this control type)');
  } else if (isFreeTextLike(element) || isPasswordType(element)) {
    const fixture = isPasswordType(element) ? EDGE_FIXTURES.passwordSpecial : EDGE_FIXTURES.special;
    if (pattern && !patternAllows(pattern, fixture)) {
      excludeUnique(
        exclusions,
        'edge-special (pattern forbids fixture; covered by negative pattern miss)'
      );
    } else if (!pattern || patternAllows(pattern, fixture)) {
      if (registerValue(byValue, fixture, 'special')) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'edge-special',
            title: `${label} — edge-special`,
            fillValue: fixture,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'special-characters',
            reason: isPasswordType(element)
              ? 'password special-character fixture; not a policy claim'
              : undefined,
          })
        );
      }
    }
  } else {
    excludeUnique(exclusions, 'edge-special (not applicable to this control type)');
  }

  // unicode
  if (isEmailType(element) || isNumberType(element) || isDateLike(element) || isPasswordType(element)) {
    excludeUnique(exclusions, 'edge-unicode (not applicable to this control type)');
  } else if (isFreeTextLike(element)) {
    if (pattern) {
      excludeUnique(exclusions, 'edge-unicode (pattern present)');
    } else if (registerValue(byValue, EDGE_FIXTURES.unicode, 'unicode')) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'edge-unicode',
          title: `${label} — edge-unicode`,
          fillValue: EDGE_FIXTURES.unicode,
          fillAuthorized,
          locator,
          control,
          element,
          kind: 'unicode-input',
        })
      );
    }
  } else {
    excludeUnique(exclusions, 'edge-unicode (not applicable to this control type)');
  }

  // emoji — text/textarea only
  if (isNumberType(element) || isDateLike(element) || isEmailType(element) || isPasswordType(element)) {
    excludeUnique(exclusions, 'edge-emoji (not applicable to this control type)');
  } else if (
    (inputTypeOf(element) === '' ||
      inputTypeOf(element) === 'text' ||
      isTextarea(element)) &&
    !pattern
  ) {
    if (registerValue(byValue, EDGE_FIXTURES.emoji, 'emoji')) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'edge-emoji',
          title: `${label} — edge-emoji`,
          fillValue: EDGE_FIXTURES.emoji,
          fillAuthorized,
          locator,
          control,
          element,
          kind: 'unicode-input',
        })
      );
    }
  } else if (pattern) {
    excludeUnique(exclusions, 'edge-emoji (pattern present)');
  } else {
    excludeUnique(exclusions, 'edge-emoji (not applicable to this control type)');
  }

  // newline / multiline — textarea only
  if (isTextarea(element)) {
    if (registerValue(byValue, EDGE_FIXTURES.newline, 'newline')) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'edge-newline',
          title: `${label} — edge-newline`,
          fillValue: EDGE_FIXTURES.newline,
          fillAuthorized,
          locator,
          control,
          element,
        })
      );
    }
    if (registerValue(byValue, EDGE_FIXTURES.multiline, 'multiline')) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'edge-multiline',
          title: `${label} — edge-multiline`,
          fillValue: EDGE_FIXTURES.multiline,
          fillAuthorized,
          locator,
          control,
          element,
        })
      );
    }
  } else {
    excludeUnique(exclusions, 'edge-newline (newline not applicable to single-line input)');
    excludeUnique(exclusions, 'edge-multiline (newline not applicable to single-line input)');
  }

  if (hasUniqueRule(element)) {
    excludeUnique(
      exclusions,
      'edge-duplicate (uniqueness rule observed but duplicate fixture was not generated)'
    );
  } else {
    excludeUnique(exclusions, 'edge-duplicate (no documented uniqueness rule)');
  }

  // rapid / paste — compact exclusion only (never PLANNED, never PASS)
  excludeUnique(
    exclusions,
    'edge-rapid (input timing was not observed in discovery)'
  );
  excludeUnique(
    exclusions,
    'edge-paste (paste was not observed in discovery)'
  );
}

function planTextLikeEdges(
  element: UiElementRecord,
  label: string,
  control: ControlKind,
  locator: string,
  fillAuthorized: boolean,
  positiveCovered?: { min?: string; max?: string }
): EdgeCaseResult {
  const plans: EdgeSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();
  const byValue = new Map<string, string>();

  let range: { min?: number; max?: number } = {};
  if (isNumberType(element)) {
    range = planNumericBoundaries(
      element,
      label,
      locator,
      control,
      fillAuthorized,
      seen,
      plans,
      exclusions,
      byValue,
      positiveCovered
    );
  } else if (isLengthTextLike(element)) {
    planLengthBoundaries(
      element,
      label,
      locator,
      control,
      fillAuthorized,
      seen,
      plans,
      exclusions,
      byValue,
      positiveCovered
    );
  } else {
    excludeUnique(exclusions, 'edge-min (no minimum constraint discovered)');
    excludeUnique(exclusions, 'edge-min-minus-5 (no minimum constraint discovered)');
    excludeUnique(exclusions, 'edge-min-plus-5 (no minimum constraint discovered)');
    excludeUnique(exclusions, 'edge-max (no maximum constraint discovered)');
    excludeUnique(exclusions, 'edge-max-minus-5 (no maximum constraint discovered)');
    excludeUnique(exclusions, 'edge-max-plus-5 (no maximum constraint discovered)');
  }

  planZeroNegativeVery(
    element,
    label,
    locator,
    control,
    fillAuthorized,
    seen,
    plans,
    exclusions,
    byValue,
    range
  );

  planFormatEdges(
    element,
    label,
    locator,
    control,
    fillAuthorized,
    seen,
    plans,
    exclusions,
    byValue
  );

  return { plans, exclusions };
}

/**
 * Build edge / boundary subcases from discovery evidence only.
 * Does not invent min/max. Fill-only — never submit. Never PASS for excluded cases.
 *
 * When `positiveCovered` is supplied (from planEdge after positive-min/max were planned),
 * identical edge-min/edge-max values are excluded to avoid duplicate fixtures.
 */
export function buildEdgeSubcases(input: {
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  label: string;
  locator: string;
  /** Fill values already planned as positive-min / positive-max for this element. */
  positiveCovered?: { min?: string; max?: string };
}): EdgeCaseResult {
  const { element, purpose, control, label, locator, positiveCovered } = input;
  const fillAuthorized = authorize({ kind: 'fill-field' });

  if (
    purpose === 'select' ||
    purpose === 'checkbox' ||
    purpose === 'radio' ||
    purpose === 'button' ||
    purpose === 'navigation-link' ||
    purpose === 'form' ||
    purpose === 'hidden-input' ||
    purpose === 'unknown'
  ) {
    return {
      plans: [],
      exclusions: ['edge analysis not applicable to this control type'],
    };
  }

  if (
    purpose === 'text-input' ||
    purpose === 'password-input' ||
    element.elementType === 'input' ||
    element.elementType === 'textarea' ||
    element.elementType === 'search'
  ) {
    if (element.readOnly) {
      return {
        plans: [],
        exclusions: ['edge analysis not applicable to read-only control'],
      };
    }
    return planTextLikeEdges(element, label, control, locator, fillAuthorized, positiveCovered);
  }

  return {
    plans: [],
    exclusions: ['edge analysis not applicable to this control type'],
  };
}

/** Values positive-cases would use for positive-min / positive-max (for duplicate checks). */
export function positiveMinMaxCoveredValues(element: UiElementRecord): { min?: string; max?: string } {
  return {
    min: positiveMinCoveredValue(element),
    max: positiveMaxCoveredValue(element),
  };
}

/**
 * Append edge subcase exclusion notes onto the compact excluded-categories reason.
 */
export function mergeEdgeExclusions(baseReason: string | undefined, exclusions: string[]): string {
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
