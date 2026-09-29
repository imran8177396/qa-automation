/**
 * Post-pass uniqueness for planned / inventory test cases.
 * Collapses equivalent scenarios (same screen, element, category, normalized
 * scenario token, and input) into one UniqueTestCase. Never invents TC-NNN,
 * numeric priority/risk scores, demo hosts, or PASS. Does not mutate
 * planned-checks.json. Explainable priority may be assigned when the source
 * left priority unspecified (see assignTestPriority).
 */

import { buildTestCaseQuality, type TestCaseQuality } from './test-case-quality';
import { assignTestPriority } from './test-priority';

export type { TestCaseQuality };

export type SeverityLevel = 'unspecified' | 'critical' | 'high' | 'medium' | 'low';

export interface UniqueTestCase {
  testCaseId: string;
  screenId: string;
  elementId: string | null;
  category: string;
  scenario: string;
  preconditions: string[];
  steps: string[];
  input: string | null;
  expectedResult: string;
  priority: SeverityLevel;
  risk: SeverityLevel;
  /** Extras removed for this equivalence key (group size − 1). */
  duplicateCount: number;
  /** WHAT / WHY / HOW / expected / distinction — evidence-only, never a PASS. */
  quality: TestCaseQuality;
  /** Explainable priority reason when assignTestPriority ran (optional). */
  priorityReason?: string;
  /** Matching priority rule id when assignTestPriority ran (optional). */
  priorityRuleId?: string;
  /** Human override: case remains in the registry but is marked excluded (never deleted). */
  excluded?: boolean;
  /** Recorded reason for exclude / include human override. */
  exclusionReason?: string;
  /**
   * Human authorization override. "allow" never sets executable and never clears
   * BLOCKED safety; "deny" does not delete the case.
   */
  humanAuthorization?: 'allow' | 'deny';
  /** Project scope for stable identity (defaults to "default" when hashing). */
  projectId?: string;
  /** Behavior token for stable identity (defaults to category when hashing). */
  behavior?: string;
  /** Set when input was appended to identityKey due to a six-field collision. */
  identityNote?: string;
}

/** Source row the deduper can read — PlannedCheck-shaped or unit fixture. */
export interface DedupableTestCase {
  id?: string;
  subcaseId?: string;
  screenId?: string;
  elementId?: string | null;
  targetElementId?: string;
  category?: string;
  scenarioKind?: string;
  title?: string;
  scenario?: string;
  preconditions?: string[];
  action?: string;
  input?: string | null;
  expect?: { fillValue?: string; note?: string; recoveryValue?: string; accessibleName?: string | null } | null;
  status?: string;
  executionResult?: string | null;
  priority?: string;
  risk?: string;
  /** Optional planner reason — preferred for quality.why when present. */
  reason?: string;
  /** Optional observed request method — never invented by quality builder. */
  method?: string;
  /** Optional observed request URL — never invented by quality builder. */
  url?: string;
  /** Optional control label from scan evidence — never invented by quality builder. */
  controlLabel?: string;
  /** Optional element type / purpose from scan evidence. */
  elementType?: string;
}

const SEVERITY = new Set(['critical', 'high', 'medium', 'low']);

/** Phrases that must never collapse onto invalid-format. */
const PROTECTED_PHRASES = [
  'too short',
  'too long',
  'missing at',
  'double at',
  'subdomain',
  'empty',
  'spaces',
] as const;

/**
 * Synonyms that map onto the single token invalid-format (longest first).
 * Whole-phrase match against the normalized title/kind.
 */
const INVALID_FORMAT_SYNONYMS = [
  'incorrect email format',
  'malformed email',
  'invalid email',
  'incorrect format',
  'wrong format',
  'bad format',
  'malformed',
  'invalid',
] as const;

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function includesPhrase(haystack: string, phrase: string): boolean {
  const parts = phrase.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  const pattern = new RegExp(`(?:^|\\s)${parts.map(escapeRe).join('\\s+')}(?:\\s|$)`);
  return pattern.test(haystack);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lowercase, strip punctuation, collapse whitespace.
 * Map invalid/malformed/incorrect-format synonyms → invalid-format.
 * Preserve protected identities (empty, missing at, double at, spaces, …).
 */
export function normalizeScenario(titleOrKind: string): string {
  const normalized = String(titleOrKind ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  if (!normalized) return '';

  for (const phrase of PROTECTED_PHRASES) {
    if (includesPhrase(normalized, phrase)) {
      return normalized.replace(/\s+/g, '-');
    }
  }

  for (const synonym of INVALID_FORMAT_SYNONYMS) {
    if (includesPhrase(normalized, synonym)) {
      return 'invalid-format';
    }
  }

  return normalized.replace(/\s+/g, '-');
}

function resolveScenarioSource(c: DedupableTestCase): string {
  return nonEmpty(c.scenario) ?? nonEmpty(c.title) ?? nonEmpty(c.scenarioKind) ?? '';
}

function resolveCategory(c: DedupableTestCase): string {
  return nonEmpty(c.category) ?? nonEmpty(c.scenarioKind) ?? '';
}

function resolveElementId(c: DedupableTestCase): string | null {
  return nonEmpty(c.elementId ?? undefined) ?? nonEmpty(c.targetElementId) ?? null;
}

function resolveInput(c: DedupableTestCase): string | null {
  if (c.input !== undefined && c.input !== null) {
    return c.input;
  }
  const fill = c.expect?.fillValue;
  if (typeof fill === 'string') return fill;
  return null;
}

/** Trim only; preserve internal spaces so email space fixtures stay distinct. */
function normalizeInputForKey(input: string | null): string {
  if (input == null) return '';
  return input.trim();
}

export function equivalenceKey(c: DedupableTestCase): string {
  const screenId = nonEmpty(c.screenId) ?? '';
  const elementId = resolveElementId(c) ?? '';
  const category = resolveCategory(c);
  const scenario = normalizeScenario(resolveScenarioSource(c));
  const input = normalizeInputForKey(resolveInput(c));
  return [screenId, elementId, category, scenario, input].join('\u0001');
}

function resolveTestCaseId(c: DedupableTestCase): string {
  return nonEmpty(c.subcaseId) ?? nonEmpty(c.id) ?? 'unspecified';
}

function severityOf(value: string | undefined | null): SeverityLevel {
  if (typeof value !== 'string') return 'unspecified';
  const lower = value.trim().toLowerCase();
  if (SEVERITY.has(lower)) return lower as SeverityLevel;
  return 'unspecified';
}

function preconditionsOf(c: DedupableTestCase): string[] {
  if (Array.isArray(c.preconditions) && c.preconditions.length > 0) {
    return c.preconditions.filter((p) => typeof p === 'string');
  }
  return ['none recorded'];
}

function stepsFromAction(action: string | undefined | null): string[] {
  const a = (action ?? 'none').trim().toLowerCase();
  if (a === 'fill-no-submit') {
    return ['Fill the field with the recorded input. Do not submit.'];
  }
  if (a === 'observe') {
    return ['Observe the recorded evidence. Do not activate the control.'];
  }
  // none / blocked / other — never add a submit step
  return ['Do not execute.'];
}

function expectedResultOf(c: DedupableTestCase): string {
  const note = nonEmpty(c.expect?.note ?? undefined);
  if (note) return note;
  const executed = nonEmpty(c.executionResult);
  if (executed) return executed;
  const status = nonEmpty(c.status);
  if (status) return status;
  return 'NOT_TESTED';
}

function toUnique(c: DedupableTestCase, duplicateCount: number): UniqueTestCase {
  const controlLabel =
    c.controlLabel ?? (typeof c.expect?.accessibleName === 'string' ? c.expect.accessibleName : undefined);
  let priority = severityOf(c.priority);
  let priorityReason: string | undefined;
  let priorityRuleId: string | undefined;

  // Assign explainable priority only when the source left it unspecified.
  // Explicit critical|high|medium|low on the case is never overwritten.
  if (priority === 'unspecified') {
    const decision = assignTestPriority({
      category: resolveCategory(c),
      scenarioKind: c.scenarioKind,
      scenario: haystackForPriority(c),
      elementType: c.elementType,
      controlLabel,
      url: c.url,
      title: c.title,
      existingPriority: c.priority,
    });
    priority = decision.priority;
    priorityReason = decision.reason;
    priorityRuleId = decision.ruleId;
  }

  const base = {
    testCaseId: resolveTestCaseId(c),
    screenId: nonEmpty(c.screenId) ?? '',
    elementId: resolveElementId(c),
    category: resolveCategory(c),
    scenario: normalizeScenario(resolveScenarioSource(c)),
    preconditions: preconditionsOf(c),
    steps: stepsFromAction(c.action),
    input: resolveInput(c),
    expectedResult: expectedResultOf(c),
    priority,
    risk: severityOf(c.risk),
    duplicateCount,
  };

  const quality = buildTestCaseQuality(base, {
    title: c.title,
    action: c.action,
    method: c.method,
    url: c.url,
    controlLabel,
    elementType: c.elementType,
    reason: c.reason,
  });

  // Optional one-sentence priority note on distinction — never a grade or score.
  const distinctionIsOneSentence = !/\.\s/.test(quality.distinction.replace(/\.$/, ''));
  if (
    priorityReason &&
    priority !== 'unspecified' &&
    distinctionIsOneSentence &&
    !/\b(grade|score|health)\b/i.test(priorityReason)
  ) {
    quality.distinction = `${quality.distinction.replace(/\.$/, '')} (${priorityReason}).`;
  }

  return {
    ...base,
    quality,
    ...(priorityReason !== undefined ? { priorityReason } : {}),
    ...(priorityRuleId !== undefined ? { priorityRuleId } : {}),
  };
}

/** Scenario + subcaseId for priority signals (login-*, workflow-happy, delete, …). */
function haystackForPriority(c: DedupableTestCase): string | null {
  const parts = [nonEmpty(c.scenario), nonEmpty(c.subcaseId)].filter((p): p is string => p != null);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Keep the first row per equivalence key. duplicateCount = extras removed for that key.
 * Empty input → { kept: [], removed: 0 }.
 */
export function deduplicateTestCases(cases: DedupableTestCase[]): {
  kept: UniqueTestCase[];
  removed: number;
  /** Indexes into the input array of the first-kept row per key (matrix/trace wiring). */
  keptIndexes: number[];
} {
  if (!Array.isArray(cases) || cases.length === 0) {
    return { kept: [], removed: 0, keptIndexes: [] };
  }

  const firstIndexByKey = new Map<string, number>();
  const groupSizeByKey = new Map<string, number>();

  for (let i = 0; i < cases.length; i++) {
    const key = equivalenceKey(cases[i]!);
    const size = groupSizeByKey.get(key) ?? 0;
    groupSizeByKey.set(key, size + 1);
    if (!firstIndexByKey.has(key)) {
      firstIndexByKey.set(key, i);
    }
  }

  const keptIndexes: number[] = [];
  const kept: UniqueTestCase[] = [];
  for (const [key, index] of firstIndexByKey) {
    const size = groupSizeByKey.get(key) ?? 1;
    keptIndexes.push(index);
    kept.push(toUnique(cases[index]!, size - 1));
  }

  const removed = cases.length - kept.length;
  return { kept, removed, keptIndexes };
}
