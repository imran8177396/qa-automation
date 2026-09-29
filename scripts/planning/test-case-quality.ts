/**
 * Quality statements for unique test cases kept by deduplicateTestCases.
 * Answers WHAT / WHY / HOW / expected / distinction from source evidence only.
 * Never invents method, URL, control labels, submit steps, or PASS outcomes.
 */

import { redactSecrets } from '../core/safety-policy';
import type { DedupableTestCase, UniqueTestCase } from './test-case-uniqueness';

export interface TestCaseQuality {
  what: string;
  why: string;
  how: string;
  expectedResult: string;
  distinction: string;
  generic: boolean;
}

/** Fields the quality builder may read from the source row — never invents missing ones. */
export type QualitySourceFields = Pick<
  DedupableTestCase,
  'title' | 'action' | 'method' | 'url' | 'controlLabel' | 'elementType' | 'reason'
>;

const VAGUE_TITLES = new Set(['test', 'check', 'verify']);

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Lowercase, strip punctuation, collapse whitespace — for title phrase checks only. */
export function normalizeTitlePhrase(title: string | null | undefined): string {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Vague titles: "verify button works" (verify + button + works) or shorter than a
 * useful sentence ("test", "check", "verify"). Generic cases are rewritten, not deleted.
 */
export function isGenericTitle(title: string | null | undefined): boolean {
  const phrase = normalizeTitlePhrase(title);
  if (!phrase) return true;
  if (phrase === 'verify button works') return true;
  if (VAGUE_TITLES.has(phrase)) return true;
  return false;
}

function subjectLabel(
  source: QualitySourceFields,
  unique: Pick<UniqueTestCase, 'elementId'>
): string {
  return (
    nonEmpty(source.elementType) ??
    nonEmpty(source.controlLabel) ??
    nonEmpty(unique.elementId) ??
    'control'
  );
}

function buildWhat(
  unique: Pick<UniqueTestCase, 'category' | 'screenId' | 'elementId' | 'scenario'>,
  source: QualitySourceFields
): string {
  const category = nonEmpty(unique.category) ?? 'unspecified';
  const screenId = nonEmpty(unique.screenId) ?? 'unspecified-screen';
  const scenario = nonEmpty(unique.scenario) ?? 'unspecified';
  const subject = subjectLabel(source, unique);
  return `${category} check of ${subject} on ${screenId}: ${scenario}`;
}

function buildWhy(
  unique: Pick<UniqueTestCase, 'category'>,
  source: QualitySourceFields
): string {
  const reasonRaw = nonEmpty(source.reason);
  if (reasonRaw) {
    const redacted = redactSecrets(reasonRaw);
    const trimmed = typeof redacted === 'string' ? redacted.trim() : reasonRaw.trim();
    if (trimmed.length > 0) return trimmed;
  }

  const category = (nonEmpty(unique.category) ?? '').toLowerCase();
  if (category === 'negative') {
    return 'This checks a documented invalid input so a bad value is not treated as success.';
  }
  if (category === 'edge' || category === 'boundary') {
    return 'This checks a boundary that was discovered on the control.';
  }
  if (category === 'security' || category === 'security-context') {
    return 'This records a bounded observation and does not run an attack.';
  }
  const label = nonEmpty(unique.category) ?? 'planned';
  return `This records a ${label} check against the discovered control.`;
}

/**
 * Authorized click actions the planner may emit. State-changing controls are not
 * authorized as click-button in this framework — they stay observe / none / blocked.
 */
function isAuthorizedClick(action: string | null | undefined): boolean {
  const a = (action ?? '').trim().toLowerCase();
  return a === 'click-link' || a === 'click-button';
}

/**
 * Rich labeled-button sentence: only when source already has matching controlLabel,
 * method, and url, and the action is an authorized click. State-changing labels are
 * never authorized here, so observe/fill paths use the recorded-request append instead.
 * Success / list clauses are included only when expectedResult already says so.
 */
function tryAuthorizedLabeledClickHow(
  source: QualitySourceFields,
  expectedResult: string
): string | null {
  const label = nonEmpty(source.controlLabel);
  const method = nonEmpty(source.method);
  const url = nonEmpty(source.url);
  // Gate on the source label text; do not hard-code a product control name as default how.
  if (!label || !/create user/i.test(label)) return null;
  if (!isAuthorizedClick(source.action)) return null;
  if (!method || !url) return null;

  const methodUpper = method.toUpperCase();
  const parts: string[] = [
    `Click the ${label} button with all required fields populated`,
    `verify ${methodUpper} ${url} is sent with the expected payload`,
  ];
  if (/successful response/i.test(expectedResult)) {
    parts.push('verify a successful response');
  }
  if (
    /appears in (the )?users? list/i.test(expectedResult) ||
    /newly created user appears/i.test(expectedResult)
  ) {
    parts.push('verify the newly created user appears in the users list');
  }
  return (
    `${parts.join(', ')}. ` +
    `The recorded request is ${methodUpper} ${url}. It is not sent by this plan.`
  );
}

function buildHow(
  unique: { steps: string[]; expectedResult: string | null },
  source: QualitySourceFields
): string {
  const expected = buildExpectedResult(unique.expectedResult);
  const labeledClickHow = tryAuthorizedLabeledClickHow(source, expected);
  if (labeledClickHow) return labeledClickHow;

  const action = (source.action ?? '').trim().toLowerCase();
  let how: string;
  if (action === 'fill-no-submit') {
    how = 'Fill with the recorded input and do not submit.';
  } else if (action === 'observe') {
    how = 'Observe the recorded evidence and do not activate the control.';
  } else if (unique.steps.length > 0) {
    how = unique.steps.join(' ');
  } else {
    how = 'Do not execute.';
  }

  const method = nonEmpty(source.method);
  const url = nonEmpty(source.url);
  if (method && url) {
    how += ` The recorded request is ${method.toUpperCase()} ${url}. It is not sent by this plan.`;
  }

  return how;
}

function buildExpectedResult(expectedResult: string | null | undefined): string {
  if (expectedResult == null) {
    return 'No expected result was recorded';
  }
  const trimmed = String(expectedResult).trim();
  if (trimmed.length === 0) {
    return 'No expected result was recorded';
  }
  return trimmed;
}

function buildDistinction(
  unique: Pick<UniqueTestCase, 'scenario' | 'input' | 'duplicateCount'>
): string {
  const scenario = nonEmpty(unique.scenario) ?? 'unspecified';
  const inputLabel =
    unique.input == null || String(unique.input).trim() === '' ? 'none' : String(unique.input);
  let distinction = `Differs by scenario ${scenario} and input ${inputLabel}.`;
  if (unique.duplicateCount > 0) {
    distinction += ` Collapsed ${unique.duplicateCount} equivalent titles with the same input.`;
  }
  return distinction;
}

/**
 * Build the five quality answers for a kept UniqueTestCase.
 * Uses source optional method/url/controlLabel/elementType/reason only when present.
 */
export function buildTestCaseQuality(
  unique: {
    category: string;
    screenId: string;
    elementId: string | null;
    scenario: string;
    input: string | null;
    expectedResult: string | null;
    duplicateCount: number;
    steps: string[];
  },
  source: QualitySourceFields
): TestCaseQuality {
  const generic = isGenericTitle(source.title);

  const what = buildWhat(unique, source);
  const why = buildWhy(unique, source);
  const how = buildHow(unique, source);
  const expectedResult = buildExpectedResult(unique.expectedResult);
  const distinction = buildDistinction(unique);

  // Reject empty answers (hard fail — callers must not write blank quality).
  if (!what.trim()) throw new Error('test-case-quality: what must not be empty');
  if (!why.trim()) throw new Error('test-case-quality: why must not be empty');
  if (!how.trim()) throw new Error('test-case-quality: how must not be empty');
  if (!expectedResult.trim()) throw new Error('test-case-quality: expectedResult must not be empty');
  if (!distinction.trim()) throw new Error('test-case-quality: distinction must not be empty');

  // Vague titles must not survive as the WHAT/HOW sentence.
  const vague = normalizeTitlePhrase(source.title);
  if (vague === 'verify button works') {
    if (normalizeTitlePhrase(what) === vague || normalizeTitlePhrase(how) === vague) {
      throw new Error('test-case-quality: generic title must be replaced in what/how');
    }
  }

  return {
    what,
    why,
    how,
    expectedResult,
    distinction,
    generic,
  };
}
