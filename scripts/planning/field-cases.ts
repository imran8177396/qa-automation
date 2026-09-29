/**
 * Field-specific subcases for the existing planner.
 * Consumed only by buildScenarioInventory → planField — not a second planner.
 * Only cases applicable to the discovered data type and constraints.
 * Defers to positive/negative/edge when the same value/purpose is already planned.
 * Never submit. Never write file bytes. Never emit executable XSS/SQL payloads.
 */

import { authorize } from '../core/safety-policy';
import type { UiElementRecord } from '../discovery/ui-scan';
import { buildEdgeSubcases } from './edge-cases';
import { buildNegativeSubcases } from './negative-cases';
import { buildPositiveSubcases, POSITIVE_FIXTURES } from './positive-cases';
import type {
  CheckKind,
  CheckStatus,
  ControlKind,
  ElementPurpose,
  PlannedAction,
  PlannedCheck,
} from './types';

/** Inert fixtures only — never tags, event handlers, or executable script. */
export const FIELD_FIXTURES = {
  html: 'html-tag-fixture',
  scriptLike: 'script-like-fixture',
  weakPassword: 'weak-password-fixture',
  phoneValid: '+14155552671',
  phoneInvalid: 'phone-invalid',
  phoneSpaces: '415 555 2671',
  phoneSpecial: '+1(415)555-2671',
  dateValid: '2024-06-15',
  fileValid: 'fixture.txt',
  fileUnsupported: 'fixture.unsupported',
  fileSpecialName: 'fixture file.txt',
} as const;

const INERT_REASON = 'inert fixture; not an executable payload';
const WEAK_PASSWORD_REASON =
  'weak-password fixture; no password policy was discovered; form is not submitted';
const PHONE_FORMAT_REASON =
  'format fixture; country acceptance was not discovered';
const PHONE_COUNTRY_REASON =
  'country code is a format prefix; no country list was discovered';
const FILE_BYTES_NOTE = 'file bytes are not written';

const MAX_EMBED_LENGTH = 40;

export type FieldSubcaseId =
  | 'field-empty'
  | 'field-normal'
  | 'field-minimum'
  | 'field-maximum'
  | 'field-over-maximum'
  | 'field-special'
  | 'field-unicode'
  | 'field-html'
  | 'field-script-like'
  | 'field-whitespace'
  | 'field-email-valid'
  | 'field-email-invalid'
  | 'field-email-empty'
  | 'field-email-duplicate'
  | 'field-email-boundary'
  | 'field-email-malformed'
  | 'field-password-valid'
  | 'field-password-invalid'
  | 'field-password-empty'
  | 'field-password-minimum'
  | 'field-password-maximum'
  | 'field-weak-password'
  | 'field-incorrect-password'
  | 'field-phone-valid'
  | 'field-phone-invalid'
  | 'field-phone-country-code'
  | 'field-phone-too-short'
  | 'field-phone-too-long'
  | 'field-phone-spaces'
  | 'field-phone-special'
  | 'field-number-minimum'
  | 'field-number-maximum'
  | 'field-number-zero'
  | 'field-number-negative'
  | 'field-number-decimal'
  | 'field-number-large'
  | 'field-number-invalid-string'
  | 'field-date-valid'
  | 'field-date-invalid'
  | 'field-date-minimum'
  | 'field-date-maximum'
  | 'field-date-past'
  | 'field-date-future'
  | 'field-today'
  | 'field-date-timezone'
  | 'field-file-valid'
  | 'field-file-unsupported'
  | 'field-file-wrong-mime'
  | 'field-file-empty'
  | 'field-file-very-large'
  | 'field-file-corrupted'
  | 'field-file-duplicate'
  | 'field-file-special-name'
  | 'field-search-valid'
  | 'field-search-empty'
  | 'field-search-no-results'
  | 'field-search-partial'
  | 'field-search-exact'
  | 'field-search-case'
  | 'field-search-special'
  | 'field-search-unicode'
  | 'field-search-very-long'
  | 'field-search-rapid';

export interface FieldSubcasePlan {
  subcaseId: FieldSubcaseId;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  reason?: string;
  expect?: PlannedCheck['expect'];
}

export interface FieldCaseResult {
  /** Field-specific rows (never PASS). */
  plans: FieldSubcasePlan[];
  /** Compact exclusion notes for the existing NOT_APPLICABLE summary row. */
  exclusions: string[];
}

interface CoverageIndex {
  plannedIds: Set<string>;
  byValue: Map<string, string>;
  siblingExclusions: string[];
}

function parseLength(raw: string | null | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function inputTypeOf(element: UiElementRecord): string {
  return (element.inputType ?? element.attributes?.type ?? '').toLowerCase();
}

function inputModeOf(element: UiElementRecord): string {
  return (element.attributes?.inputmode ?? '').toLowerCase();
}

function acceptOf(element: UiElementRecord): string | undefined {
  const a = element.attributes?.accept;
  return a != null && a !== '' ? a : undefined;
}

function isEmailType(element: UiElementRecord): boolean {
  return inputTypeOf(element) === 'email' || element.elementKind === 'email-input';
}

function isPasswordType(element: UiElementRecord): boolean {
  return inputTypeOf(element) === 'password' || element.elementKind === 'password-input';
}

function isNumberType(element: UiElementRecord): boolean {
  return inputTypeOf(element) === 'number' || element.elementKind === 'number-input';
}

function isDateType(element: UiElementRecord): boolean {
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

function isFileType(element: UiElementRecord): boolean {
  return (
    inputTypeOf(element) === 'file' ||
    element.elementKind === 'file-upload' ||
    element.elementType === 'file-upload'
  );
}

function isTextarea(element: UiElementRecord): boolean {
  return (
    element.elementType === 'textarea' ||
    element.elementKind === 'textarea' ||
    element.tag === 'textarea'
  );
}

function isSearchField(element: UiElementRecord): boolean {
  const t = inputTypeOf(element);
  if (t === 'search' || element.elementType === 'search' || element.elementKind === 'search-field') {
    return true;
  }
  const name = `${element.accessibleName ?? ''} ${element.attributes?.name ?? ''} ${element.label ?? ''}`;
  return /search/i.test(name);
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

/**
 * Phone: type=tel or inputmode=tel, or a generic text control whose accessible name / name
 * matches /phone|tel/i. Plain text without that name is not a phone field.
 */
export function isPhoneField(element: UiElementRecord): boolean {
  const t = inputTypeOf(element);
  const mode = inputModeOf(element);
  if (t === 'tel' || mode === 'tel') return true;
  if (t === 'email' || t === 'password' || t === 'number' || t === 'date' || t === 'file') {
    return false;
  }
  if (t === 'text' || t === '' || t === 'search' || isTextarea(element)) {
    const name = `${element.accessibleName ?? ''} ${element.attributes?.name ?? ''} ${element.label ?? ''}`;
    return /phone|tel/i.test(name);
  }
  return false;
}

function pushUnique(seen: Set<string>, plans: FieldSubcasePlan[], plan: FieldSubcasePlan): void {
  if (seen.has(plan.subcaseId)) return;
  seen.add(plan.subcaseId);
  plans.push(plan);
}

function excludeUnique(exclusions: string[], note: string): void {
  if (!exclusions.includes(note)) exclusions.push(note);
}

function buildCoverage(
  element: UiElementRecord,
  purpose: ElementPurpose,
  control: ControlKind,
  label: string,
  locator: string,
  pageElements: UiElementRecord[]
): CoverageIndex {
  const positive = buildPositiveSubcases({
    element,
    purpose,
    control,
    label,
    locator,
    stateChanging: false,
    pageElements,
  });
  const negative = buildNegativeSubcases({ element, purpose, control, label, locator, pageElements });
  const edge = buildEdgeSubcases({ element, purpose, control, label, locator });

  const plannedIds = new Set<string>();
  const byValue = new Map<string, string>();

  for (const plan of [...positive.plans, ...negative.plans, ...edge.plans]) {
    if (plan.status !== 'PLANNED') continue;
    plannedIds.add(plan.subcaseId);
    const value = plan.expect?.fillValue;
    if (value != null && !byValue.has(value)) {
      byValue.set(value, plan.subcaseId);
    }
  }

  return {
    plannedIds,
    byValue,
    siblingExclusions: [...positive.exclusions, ...negative.exclusions, ...edge.exclusions],
  };
}

function siblingHas(exclusions: string[], subcaseId: string): boolean {
  return exclusions.some((note) => note.startsWith(`${subcaseId} (`));
}

/**
 * If a sibling already planned the same purpose, exclude.
 * If a sibling excluded it (e.g. no constraint), keep field excluded too — do not invent.
 * Returns true when the field case should not be planned.
 */
function deferToSibling(
  exclusions: string[],
  fieldId: FieldSubcaseId,
  coveringIds: string[],
  coverage: CoverageIndex
): boolean {
  for (const id of coveringIds) {
    if (coverage.plannedIds.has(id)) {
      excludeUnique(exclusions, `${fieldId} (already covered by ${id})`);
      return true;
    }
  }
  for (const id of coveringIds) {
    if (siblingHas(coverage.siblingExclusions, id)) {
      excludeUnique(exclusions, `${fieldId} (already covered by ${id})`);
      return true;
    }
  }
  return false;
}

function deferByValue(
  exclusions: string[],
  fieldId: FieldSubcaseId,
  value: string,
  coverage: CoverageIndex
): boolean {
  const existing = coverage.byValue.get(value);
  if (existing) {
    excludeUnique(exclusions, `${fieldId} (already covered by ${existing})`);
    return true;
  }
  return false;
}

function fillPlan(input: {
  subcaseId: FieldSubcaseId;
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
}): FieldSubcasePlan {
  const {
    subcaseId,
    title,
    fillValue,
    fillAuthorized,
    locator,
    control,
    element,
    kind = 'valid-input',
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

function notTestedPlan(
  subcaseId: FieldSubcaseId,
  title: string,
  reason: string,
  kind: CheckKind = 'invalid-input'
): FieldSubcasePlan {
  return {
    subcaseId,
    kind,
    title,
    status: 'NOT_TESTED',
    action: 'none',
    reason: reason.startsWith('NOT_TESTED:') ? reason : `NOT_TESTED: ${reason}`,
  };
}

function planTextFamily(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  coverage: CoverageIndex,
  opts: { searchMode: boolean }
): FieldCaseResult {
  const plans: FieldSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();

  const emptyId: FieldSubcaseId = opts.searchMode ? 'field-search-empty' : 'field-empty';
  const normalId: FieldSubcaseId = opts.searchMode ? 'field-search-valid' : 'field-normal';
  const specialId: FieldSubcaseId = opts.searchMode ? 'field-search-special' : 'field-special';
  const unicodeId: FieldSubcaseId = opts.searchMode ? 'field-search-unicode' : 'field-unicode';

  // empty — same required rule as negative/edge
  if (
    !deferToSibling(exclusions, emptyId, ['negative-empty', 'edge-empty'], coverage)
  ) {
    if (element.required) {
      if (!deferByValue(exclusions, emptyId, '', coverage)) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: emptyId,
            title: `${label} — ${emptyId}`,
            fillValue: '',
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'empty-input',
          })
        );
      }
    } else {
      excludeUnique(exclusions, `${emptyId} (empty is valid when not required)`);
    }
  }

  // normal / valid search
  if (!deferToSibling(exclusions, normalId, ['positive-valid'], coverage)) {
    if (!deferByValue(exclusions, normalId, POSITIVE_FIXTURES.textValid, coverage)) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: normalId,
          title: `${label} — ${normalId}`,
          fillValue: POSITIVE_FIXTURES.textValid,
          fillAuthorized,
          locator,
          control,
          element,
        })
      );
    }
  }

  // minimum
  const minLen = parseLength(element.minLength ?? element.attributes?.minlength);
  if (!deferToSibling(exclusions, 'field-minimum', ['positive-min', 'edge-min'], coverage)) {
    if (minLen != null && minLen > 0 && minLen <= MAX_EMBED_LENGTH) {
      const value = 'a'.repeat(minLen);
      if (!deferByValue(exclusions, 'field-minimum', value, coverage)) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'field-minimum',
            title: `${label} — field-minimum`,
            fillValue: value,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'boundary-values',
          })
        );
      }
    } else {
      excludeUnique(exclusions, 'field-minimum (no minimum constraint discovered)');
    }
  }

  // maximum
  const maxLen = parseLength(element.maxLength ?? element.attributes?.maxlength);
  if (!deferToSibling(exclusions, 'field-maximum', ['positive-max', 'edge-max'], coverage)) {
    if (maxLen != null && maxLen > 0 && maxLen <= MAX_EMBED_LENGTH) {
      const value = 'a'.repeat(maxLen);
      if (!deferByValue(exclusions, 'field-maximum', value, coverage)) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'field-maximum',
            title: `${label} — field-maximum`,
            fillValue: value,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'boundary-values',
          })
        );
      }
    } else if (maxLen != null && maxLen > MAX_EMBED_LENGTH) {
      excludeUnique(exclusions, 'field-maximum (length too large to embed)');
    } else {
      excludeUnique(exclusions, 'field-maximum (no maximum constraint discovered)');
    }
  }

  // over maximum
  const overId: FieldSubcaseId = opts.searchMode ? 'field-search-very-long' : 'field-over-maximum';
  if (
    !deferToSibling(exclusions, overId, ['edge-max-plus-5', 'negative-too-long'], coverage)
  ) {
    if (maxLen != null && maxLen > 0 && maxLen <= MAX_EMBED_LENGTH) {
      const value = 'a'.repeat(maxLen + 1);
      if (!deferByValue(exclusions, overId, value, coverage)) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: overId,
            title: `${label} — ${overId}`,
            fillValue: value,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'long-input',
            constraintInvalid: true,
          })
        );
      }
    } else {
      excludeUnique(
        exclusions,
        maxLen != null && maxLen > MAX_EMBED_LENGTH
          ? `${overId} (length too large to embed)`
          : `${overId} (no maximum constraint discovered)`
      );
    }
  }

  // special
  if (
    !deferToSibling(exclusions, specialId, ['positive-special', 'edge-special'], coverage)
  ) {
    if (!deferByValue(exclusions, specialId, POSITIVE_FIXTURES.textSpecial, coverage)) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: specialId,
          title: `${label} — ${specialId}`,
          fillValue: POSITIVE_FIXTURES.textSpecial,
          fillAuthorized,
          locator,
          control,
          element,
          kind: 'special-characters',
        })
      );
    }
  }

  // unicode
  if (
    !deferToSibling(exclusions, unicodeId, ['positive-unicode', 'edge-unicode'], coverage)
  ) {
    if (!deferByValue(exclusions, unicodeId, POSITIVE_FIXTURES.textUnicode, coverage)) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: unicodeId,
          title: `${label} — ${unicodeId}`,
          fillValue: POSITIVE_FIXTURES.textUnicode,
          fillAuthorized,
          locator,
          control,
          element,
          kind: 'unicode-input',
        })
      );
    }
  }

  // whitespace (non-search text family)
  if (!opts.searchMode) {
    if (
      !deferToSibling(exclusions, 'field-whitespace', ['edge-whitespace'], coverage)
    ) {
      const ws = '   ';
      if (!deferByValue(exclusions, 'field-whitespace', ws, coverage)) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'field-whitespace',
            title: `${label} — field-whitespace`,
            fillValue: ws,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'whitespace-input',
          })
        );
      }
    }
  }

  // HTML + script-like — inert fixtures for text/search/textarea only
  for (const row of [
    {
      id: 'field-html' as const,
      value: FIELD_FIXTURES.html,
      title: 'html',
    },
    {
      id: 'field-script-like' as const,
      value: FIELD_FIXTURES.scriptLike,
      title: 'script-like',
    },
  ]) {
    if (!deferByValue(exclusions, row.id, row.value, coverage)) {
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
          kind: 'special-characters',
          reason: INERT_REASON,
          note: INERT_REASON,
        })
      );
    }
  }

  if (opts.searchMode) {
    for (const row of [
      {
        id: 'field-search-no-results' as const,
        reason: 'search result behavior was not in discovery evidence',
      },
      {
        id: 'field-search-partial' as const,
        reason: 'search result behavior was not in discovery evidence',
      },
      {
        id: 'field-search-exact' as const,
        reason: 'search result behavior was not in discovery evidence',
      },
      {
        id: 'field-search-case' as const,
        reason: 'search result behavior was not in discovery evidence',
      },
      {
        id: 'field-search-rapid' as const,
        reason: 'rapid search was not observed in discovery',
      },
    ]) {
      pushUnique(seen, plans, notTestedPlan(row.id, `${label} — ${row.id}`, row.reason));
    }
  }

  return { plans, exclusions };
}

function planEmailField(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  coverage: CoverageIndex
): FieldCaseResult {
  const plans: FieldSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();

  if (!deferToSibling(exclusions, 'field-email-valid', ['positive-valid'], coverage)) {
    // Should not normally plan — positive-valid always plans user@example.com for email.
    if (!deferByValue(exclusions, 'field-email-valid', POSITIVE_FIXTURES.emailValid, coverage)) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'field-email-valid',
          title: `${label} — field-email-valid`,
          fillValue: POSITIVE_FIXTURES.emailValid,
          fillAuthorized,
          locator,
          control,
          element,
        })
      );
    }
  }

  if (
    !deferToSibling(
      exclusions,
      'field-email-invalid',
      [
        'negative-missing-at',
        'negative-missing-domain',
        'negative-invalid-domain',
        'negative-double-at',
        'negative-spaces',
        'negative-malformed',
      ],
      coverage
    )
  ) {
    excludeUnique(exclusions, 'field-email-invalid (no email format fixtures discovered)');
  }

  if (
    !deferToSibling(exclusions, 'field-email-empty', ['negative-empty', 'edge-empty'], coverage)
  ) {
    if (element.required) {
      if (!deferByValue(exclusions, 'field-email-empty', '', coverage)) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'field-email-empty',
            title: `${label} — field-email-empty`,
            fillValue: '',
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'empty-input',
          })
        );
      }
    } else {
      excludeUnique(exclusions, 'field-email-empty (empty is valid when not required)');
    }
  }

  excludeUnique(exclusions, 'field-email-duplicate (no documented uniqueness rule)');

  if (
    !deferToSibling(
      exclusions,
      'field-email-boundary',
      ['edge-min', 'edge-max', 'positive-min', 'positive-max', 'negative-too-short', 'negative-too-long'],
      coverage
    )
  ) {
    const minLen = parseLength(element.minLength ?? element.attributes?.minlength);
    const maxLen = parseLength(element.maxLength ?? element.attributes?.maxlength);
    if (minLen == null && maxLen == null) {
      excludeUnique(exclusions, 'field-email-boundary (no length constraint discovered)');
    } else {
      excludeUnique(exclusions, 'field-email-boundary (length boundaries covered by edge/negative)');
    }
  }

  if (!deferToSibling(exclusions, 'field-email-malformed', ['negative-malformed'], coverage)) {
    excludeUnique(exclusions, 'field-email-malformed (already covered by negative-malformed)');
  }

  // HTML / script-like not applicable to email
  excludeUnique(exclusions, 'field-html (not applicable to email)');
  excludeUnique(exclusions, 'field-script-like (not applicable to email)');

  return { plans, exclusions };
}

function planPasswordField(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  coverage: CoverageIndex
): FieldCaseResult {
  const plans: FieldSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();

  if (!deferToSibling(exclusions, 'field-password-valid', ['positive-valid'], coverage)) {
    excludeUnique(exclusions, 'field-password-valid (already covered by positive-valid)');
  }

  if (
    !deferToSibling(exclusions, 'field-password-invalid', ['negative-invalid-credentials'], coverage)
  ) {
    excludeUnique(
      exclusions,
      'field-password-invalid (already covered by negative-invalid-credentials)'
    );
  }

  if (
    !deferToSibling(exclusions, 'field-password-empty', ['negative-empty', 'edge-empty'], coverage)
  ) {
    if (element.required) {
      if (!deferByValue(exclusions, 'field-password-empty', '', coverage)) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'field-password-empty',
            title: `${label} — field-password-empty`,
            fillValue: '',
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'empty-input',
          })
        );
      }
    } else {
      excludeUnique(exclusions, 'field-password-empty (empty is valid when not required)');
    }
  }

  if (
    !deferToSibling(exclusions, 'field-password-minimum', ['positive-min', 'edge-min'], coverage)
  ) {
    const minLen = parseLength(element.minLength ?? element.attributes?.minlength);
    if (minLen == null) {
      excludeUnique(exclusions, 'field-password-minimum (no minimum constraint discovered)');
    } else {
      excludeUnique(exclusions, 'field-password-minimum (already covered by positive-min or edge-min)');
    }
  }

  if (
    !deferToSibling(exclusions, 'field-password-maximum', ['positive-max', 'edge-max'], coverage)
  ) {
    const maxLen = parseLength(element.maxLength ?? element.attributes?.maxlength);
    if (maxLen == null) {
      excludeUnique(exclusions, 'field-password-maximum (no maximum constraint discovered)');
    } else {
      excludeUnique(exclusions, 'field-password-maximum (already covered by positive-max or edge-max)');
    }
  }

  // weak password — one PLANNED inert fixture, never submitted
  if (
    !deferByValue(exclusions, 'field-weak-password', FIELD_FIXTURES.weakPassword, coverage)
  ) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'field-weak-password',
        title: `${label} — field-weak-password`,
        fillValue: FIELD_FIXTURES.weakPassword,
        fillAuthorized,
        locator,
        control,
        element,
        kind: 'invalid-input',
        reason: WEAK_PASSWORD_REASON,
        note: WEAK_PASSWORD_REASON,
      })
    );
  }

  // incorrect password — do not duplicate negative-invalid-credentials
  excludeUnique(
    exclusions,
    'field-incorrect-password (already covered by negative-invalid-credentials)'
  );

  return { plans, exclusions };
}

function planPhoneField(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  coverage: CoverageIndex
): FieldCaseResult {
  const plans: FieldSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();

  if (!deferByValue(exclusions, 'field-phone-valid', FIELD_FIXTURES.phoneValid, coverage)) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'field-phone-valid',
        title: `${label} — field-phone-valid`,
        fillValue: FIELD_FIXTURES.phoneValid,
        fillAuthorized,
        locator,
        control,
        element,
        reason: PHONE_FORMAT_REASON,
        note: PHONE_FORMAT_REASON,
      })
    );
  }

  if (!deferByValue(exclusions, 'field-phone-invalid', FIELD_FIXTURES.phoneInvalid, coverage)) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'field-phone-invalid',
        title: `${label} — field-phone-invalid`,
        fillValue: FIELD_FIXTURES.phoneInvalid,
        fillAuthorized,
        locator,
        control,
        element,
        kind: 'invalid-input',
        constraintInvalid: true,
      })
    );
  }

  // country code uses the same +1 fixture — keep one valid row, exclude duplicate
  if (coverage.byValue.has(FIELD_FIXTURES.phoneValid) || seen.has('field-phone-valid')) {
    excludeUnique(
      exclusions,
      'field-phone-country-code (already covered by field-phone-valid)'
    );
  } else if (!deferByValue(exclusions, 'field-phone-country-code', FIELD_FIXTURES.phoneValid, coverage)) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'field-phone-country-code',
        title: `${label} — field-phone-country-code`,
        fillValue: FIELD_FIXTURES.phoneValid,
        fillAuthorized,
        locator,
        control,
        element,
        reason: PHONE_COUNTRY_REASON,
        note: PHONE_COUNTRY_REASON,
      })
    );
  }

  const minLen = parseLength(element.minLength ?? element.attributes?.minlength);
  const maxLen = parseLength(element.maxLength ?? element.attributes?.maxlength);

  if (
    !deferToSibling(exclusions, 'field-phone-too-short', ['negative-too-short', 'edge-min-minus-5'], coverage)
  ) {
    if (minLen != null && minLen > 0 && minLen <= MAX_EMBED_LENGTH) {
      const value = minLen === 1 ? '1' : '1'.repeat(Math.max(0, minLen - 1));
      if (!deferByValue(exclusions, 'field-phone-too-short', value, coverage)) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'field-phone-too-short',
            title: `${label} — field-phone-too-short`,
            fillValue: value,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'invalid-input',
            constraintInvalid: true,
          })
        );
      }
    } else {
      excludeUnique(exclusions, 'field-phone-too-short (no minLength discovered)');
    }
  }

  if (
    !deferToSibling(exclusions, 'field-phone-too-long', ['negative-too-long', 'edge-max-plus-5'], coverage)
  ) {
    if (maxLen != null && maxLen > 0 && maxLen <= MAX_EMBED_LENGTH) {
      const value = '1'.repeat(maxLen + 1);
      if (!deferByValue(exclusions, 'field-phone-too-long', value, coverage)) {
        pushUnique(
          seen,
          plans,
          fillPlan({
            subcaseId: 'field-phone-too-long',
            title: `${label} — field-phone-too-long`,
            fillValue: value,
            fillAuthorized,
            locator,
            control,
            element,
            kind: 'long-input',
            constraintInvalid: true,
          })
        );
      }
    } else {
      excludeUnique(exclusions, 'field-phone-too-long (no maxLength discovered)');
    }
  }

  if (!deferByValue(exclusions, 'field-phone-spaces', FIELD_FIXTURES.phoneSpaces, coverage)) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'field-phone-spaces',
        title: `${label} — field-phone-spaces`,
        fillValue: FIELD_FIXTURES.phoneSpaces,
        fillAuthorized,
        locator,
        control,
        element,
        kind: 'whitespace-input',
        reason: PHONE_FORMAT_REASON,
      })
    );
  }

  if (!deferByValue(exclusions, 'field-phone-special', FIELD_FIXTURES.phoneSpecial, coverage)) {
    pushUnique(
      seen,
      plans,
      fillPlan({
        subcaseId: 'field-phone-special',
        title: `${label} — field-phone-special`,
        fillValue: FIELD_FIXTURES.phoneSpecial,
        fillAuthorized,
        locator,
        control,
        element,
        kind: 'special-characters',
        reason: PHONE_FORMAT_REASON,
      })
    );
  }

  return { plans, exclusions };
}

function planNumberField(coverage: CoverageIndex): FieldCaseResult {
  const exclusions: string[] = [];
  const mapping: Array<{ fieldId: FieldSubcaseId; coverId: string }> = [
    { fieldId: 'field-number-minimum', coverId: 'edge-min' },
    { fieldId: 'field-number-maximum', coverId: 'edge-max' },
    { fieldId: 'field-number-zero', coverId: 'edge-zero' },
    { fieldId: 'field-number-negative', coverId: 'edge-negative' },
    { fieldId: 'field-number-decimal', coverId: 'negative-decimal' },
    { fieldId: 'field-number-large', coverId: 'edge-very-large' },
    { fieldId: 'field-number-invalid-string', coverId: 'negative-string' },
  ];
  for (const row of mapping) {
    excludeUnique(exclusions, `${row.fieldId} (already covered by ${row.coverId})`);
    void coverage;
  }
  excludeUnique(exclusions, 'field-html (not applicable to number)');
  excludeUnique(exclusions, 'field-script-like (not applicable to number)');
  return { plans: [], exclusions };
}

function isoDateInRange(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

function planDateField(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  fillAuthorized: boolean,
  coverage: CoverageIndex
): FieldCaseResult {
  const plans: FieldSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();
  const inputType = inputTypeOf(element);
  const min = element.min ?? element.attributes?.min ?? undefined;
  const max = element.max ?? element.attributes?.max ?? undefined;

  if (inputType === 'date') {
    const fixture = FIELD_FIXTURES.dateValid;
    if (!isoDateInRange(fixture, min || undefined, max || undefined)) {
      excludeUnique(exclusions, 'field-date-valid (fixture outside documented range)');
    } else if (!deferByValue(exclusions, 'field-date-valid', fixture, coverage)) {
      pushUnique(
        seen,
        plans,
        fillPlan({
          subcaseId: 'field-date-valid',
          title: `${label} — field-date-valid`,
          fillValue: fixture,
          fillAuthorized,
          locator,
          control,
          element,
        })
      );
    }
  } else {
    excludeUnique(exclusions, 'field-date-valid (type-inherent date fixture applies to type=date)');
  }

  if (
    !deferToSibling(
      exclusions,
      'field-date-invalid',
      ['negative-invalid-date', 'negative-wrong-format'],
      coverage
    )
  ) {
    excludeUnique(exclusions, 'field-date-invalid (already covered by negative date fixtures)');
  }

  if (!deferToSibling(exclusions, 'field-date-minimum', ['edge-min', 'positive-min'], coverage)) {
    if (!min) {
      excludeUnique(exclusions, 'field-date-minimum (no minimum constraint discovered)');
    } else {
      excludeUnique(exclusions, 'field-date-minimum (already covered by edge-min)');
    }
  }

  if (!deferToSibling(exclusions, 'field-date-maximum', ['edge-max', 'positive-max'], coverage)) {
    if (!max) {
      excludeUnique(exclusions, 'field-date-maximum (no maximum constraint discovered)');
    } else {
      excludeUnique(exclusions, 'field-date-maximum (already covered by edge-max)');
    }
  }

  if (!deferToSibling(exclusions, 'field-date-past', ['negative-past'], coverage)) {
    excludeUnique(exclusions, 'field-date-past (already covered by negative-past)');
  }

  if (!deferToSibling(exclusions, 'field-date-future', ['negative-future'], coverage)) {
    excludeUnique(exclusions, 'field-date-future (already covered by negative-future)');
  }

  pushUnique(
    seen,
    plans,
    notTestedPlan(
      'field-today',
      `${label} — field-today`,
      'field-today (clock was not fixed in discovery)'
    )
  );

  if (!deferToSibling(exclusions, 'field-date-timezone', ['negative-timezone'], coverage)) {
    excludeUnique(exclusions, 'field-date-timezone (already covered by negative-timezone)');
  }

  excludeUnique(exclusions, 'field-html (not applicable to date)');
  excludeUnique(exclusions, 'field-script-like (not applicable to date)');

  return { plans, exclusions };
}

function acceptAllowsUnsupported(accept: string): boolean {
  const tokens = accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return !tokens.some(
    (t) =>
      t === '.unsupported' ||
      t === 'unsupported' ||
      t.includes('unsupported') ||
      t === '*/*' ||
      t === '.*'
  );
}

function planFileField(element: UiElementRecord, label: string, locator: string): FieldCaseResult {
  const plans: FieldSubcasePlan[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();
  const accept = acceptOf(element);

  pushUnique(seen, plans, {
    subcaseId: 'field-file-valid',
    kind: 'valid-input',
    title: `${label} — field-file-valid`,
    status: 'PLANNED',
    action: 'observe',
    reason: 'metadata-only file fixture; form is not submitted',
    expect: {
      locator,
      fillValue: FIELD_FIXTURES.fileValid,
      inputType: 'file',
      note: accept
        ? `${FILE_BYTES_NOTE}; accept-matching when accept is present`
        : FILE_BYTES_NOTE,
    },
  });

  if (accept && acceptAllowsUnsupported(accept)) {
    pushUnique(seen, plans, {
      subcaseId: 'field-file-unsupported',
      kind: 'invalid-input',
      title: `${label} — field-file-unsupported`,
      status: 'PLANNED',
      action: 'observe',
      reason: 'metadata-only unsupported extension; form is not submitted',
      expect: {
        locator,
        fillValue: FIELD_FIXTURES.fileUnsupported,
        inputType: 'file',
        note: FILE_BYTES_NOTE,
      },
    });
  } else if (!accept) {
    excludeUnique(exclusions, 'field-file-unsupported (no accept list discovered)');
  } else {
    excludeUnique(exclusions, 'field-file-unsupported (accept list includes unsupported token)');
  }

  pushUnique(
    seen,
    plans,
    notTestedPlan(
      'field-file-wrong-mime',
      `${label} — field-file-wrong-mime`,
      'MIME type was not observed; file bytes are not written'
    )
  );
  pushUnique(
    seen,
    plans,
    notTestedPlan(
      'field-file-empty',
      `${label} — field-file-empty`,
      'empty file bytes are not written'
    )
  );
  pushUnique(
    seen,
    plans,
    notTestedPlan(
      'field-file-very-large',
      `${label} — field-file-very-large`,
      'very large file is not generated'
    )
  );
  pushUnique(
    seen,
    plans,
    notTestedPlan(
      'field-file-corrupted',
      `${label} — field-file-corrupted`,
      'corrupted file bytes are not generated'
    )
  );

  excludeUnique(exclusions, 'field-file-duplicate (no documented uniqueness rule)');

  pushUnique(seen, plans, {
    subcaseId: 'field-file-special-name',
    kind: 'special-characters',
    title: `${label} — field-file-special-name`,
    status: 'PLANNED',
    action: 'observe',
    reason: 'metadata-only special filename; form is not submitted',
    expect: {
      locator,
      fillValue: FIELD_FIXTURES.fileSpecialName,
      inputType: 'file',
      note: FILE_BYTES_NOTE,
    },
  });

  return { plans, exclusions };
}

/**
 * Build field-specific subcases from discovery evidence and sibling planners.
 * Fill-only (never submit). Never PASS. Never invent business rules or write file bytes.
 * HTML/script-like values are inert letter fixtures only.
 */
export function buildFieldSubcases(input: {
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  label: string;
  locator: string;
  pageElements?: UiElementRecord[];
}): FieldCaseResult {
  const { element, purpose, control, label, locator } = input;
  const pageElements = input.pageElements ?? [];
  const fillAuthorized = authorize({ kind: 'fill-field' });

  if (
    purpose === 'select' ||
    purpose === 'checkbox' ||
    purpose === 'radio' ||
    purpose === 'button' ||
    purpose === 'navigation-link' ||
    purpose === 'form' ||
    purpose === 'hidden-input'
  ) {
    return { plans: [], exclusions: [] };
  }

  if (isFileType(element)) {
    return planFileField(element, label, locator);
  }

  // Coverage from sibling builders (same values/purposes) — do not duplicate PLANNED rows.
  const coveragePurpose: ElementPurpose =
    purpose === 'unknown' && (isFreeTextLike(element) || isPasswordType(element) || isPhoneField(element))
      ? isPasswordType(element)
        ? 'password-input'
        : 'text-input'
      : purpose === 'unknown'
        ? 'text-input'
        : purpose;

  const coverage = buildCoverage(
    element,
    coveragePurpose,
    control,
    label,
    locator,
    pageElements
  );

  if (isEmailType(element)) {
    return planEmailField(element, label, locator, control, fillAuthorized, coverage);
  }
  if (isPasswordType(element) || purpose === 'password-input') {
    return planPasswordField(element, label, locator, control, fillAuthorized, coverage);
  }
  if (isPhoneField(element)) {
    return planPhoneField(element, label, locator, control, fillAuthorized, coverage);
  }
  if (isNumberType(element)) {
    return planNumberField(coverage);
  }
  if (isDateType(element)) {
    return planDateField(element, label, locator, control, fillAuthorized, coverage);
  }
  if (isSearchField(element)) {
    return planTextFamily(element, label, locator, control, fillAuthorized, coverage, {
      searchMode: true,
    });
  }
  if (
    isFreeTextLike(element) ||
    purpose === 'text-input' ||
    element.elementType === 'input' ||
    element.elementType === 'textarea'
  ) {
    return planTextFamily(element, label, locator, control, fillAuthorized, coverage, {
      searchMode: false,
    });
  }

  return { plans: [], exclusions: [] };
}

/**
 * Append field subcase exclusion notes onto the compact excluded-categories reason.
 */
export function mergeFieldExclusions(baseReason: string | undefined, exclusions: string[]): string {
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
