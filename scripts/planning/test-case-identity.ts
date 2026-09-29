/**
 * Stable test-case identities for regression / historical reporting.
 *
 * identityKey = projectId + screenId + elementId + behavior + category + scenario
 * (unit separator). testCaseId = "TC-" + first 12 hex chars of sha256(identityKey).
 * Same key → same id every run. No randomness, no incrementing counters.
 *
 * Does not invent PASS, does not delete deprecated records, does not crawl.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UniqueTestCase } from './test-case-uniqueness';

const UNIT_SEP = '\u0001';

export const INPUT_COLLISION_NOTE =
  'input appended to identity because scenario fields collided';

export interface PersistedTestCase {
  testCaseId: string;
  identityKey: string;
  projectId: string;
  screenId: string;
  elementId: string | null;
  behavior: string;
  category: string;
  scenario: string;
  lifecycle: 'updated' | 'new' | 'deprecated';
  firstSeen: string;
  lastSeen: string;
}

export interface TestCaseIdentityRegistry {
  version: '1';
  cases: PersistedTestCase[];
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Trim only — preserve internal spaces so email space fixtures stay distinct. */
function normalizeInputForKey(input: string | null | undefined): string {
  if (input == null) return '';
  return input.trim();
}

function resolveIdentityProjectId(c: Pick<UniqueTestCase, 'projectId'>): string {
  return nonEmpty(c.projectId) ?? 'default';
}

function resolveIdentityBehavior(
  c: Pick<UniqueTestCase, 'behavior' | 'category'>
): string {
  return nonEmpty(c.behavior) ?? nonEmpty(c.category) ?? 'unspecified';
}

/**
 * Six fields only (plus optional input suffix on collision).
 * Does not include timestamps — now never enters the hash.
 */
export function buildIdentityKey(fields: {
  projectId: string;
  screenId: string;
  elementId: string | null;
  behavior: string;
  category: string;
  scenario: string;
  /** Appended only when six fields collided within one run. */
  inputSuffix?: string;
}): string {
  const parts = [
    fields.projectId,
    fields.screenId,
    fields.elementId ?? '',
    fields.behavior,
    fields.category,
    fields.scenario,
  ];
  if (fields.inputSuffix !== undefined) {
    parts.push(fields.inputSuffix);
  }
  return parts.join(UNIT_SEP);
}

export function testCaseIdFromIdentityKey(identityKey: string): string {
  const hex = createHash('sha256').update(identityKey, 'utf8').digest('hex').slice(0, 12);
  return `TC-${hex}`;
}

function baseFieldsFromCase(c: UniqueTestCase): {
  projectId: string;
  screenId: string;
  elementId: string | null;
  behavior: string;
  category: string;
  scenario: string;
} {
  return {
    projectId: resolveIdentityProjectId(c),
    screenId: nonEmpty(c.screenId) ?? '',
    elementId: c.elementId ?? null,
    behavior: resolveIdentityBehavior(c),
    category: nonEmpty(c.category) ?? '',
    scenario: nonEmpty(c.scenario) ?? '',
  };
}

/**
 * Assign identity keys for the current run. First case keeps the six-field key;
 * later cases that collide on those six fields get normalized input appended.
 */
function assignIdentityKeys(
  current: UniqueTestCase[]
): Array<{ case: UniqueTestCase; identityKey: string; note?: string }> {
  const seen = new Set<string>();
  const out: Array<{ case: UniqueTestCase; identityKey: string; note?: string }> = [];

  for (const c of current) {
    const base = baseFieldsFromCase(c);
    let identityKey = buildIdentityKey(base);
    let note: string | undefined;

    if (seen.has(identityKey)) {
      const inputSuffix = normalizeInputForKey(c.input);
      identityKey = buildIdentityKey({ ...base, inputSuffix });
      note = INPUT_COLLISION_NOTE;
    }

    seen.add(identityKey);
    out.push(note !== undefined ? { case: c, identityKey, note } : { case: c, identityKey });
  }

  return out;
}

/**
 * Reconcile current UniqueTestCase rows with a previous identity registry.
 * - Match by identityKey → updated (keep previous testCaseId when present)
 * - No previous match → new
 * - Previous key absent from current → deprecated (kept in persisted, never deleted, never PASS)
 * - previous null → all current are new, deprecated []
 */
export function reconcileTestCases(input: {
  current: UniqueTestCase[];
  previous: PersistedTestCase[] | null;
  now: string;
}): {
  cases: UniqueTestCase[];
  persisted: PersistedTestCase[];
  deprecated: PersistedTestCase[];
} {
  const now = input.now;
  const previous = input.previous;
  const assigned = assignIdentityKeys(input.current ?? []);
  const previousByKey = new Map<string, PersistedTestCase>();
  if (previous != null) {
    for (const row of previous) {
      if (row?.identityKey) {
        previousByKey.set(row.identityKey, row);
      }
    }
  }

  const cases: UniqueTestCase[] = [];
  const activePersisted: PersistedTestCase[] = [];
  const seenKeys = new Set<string>();

  for (const { case: c, identityKey, note } of assigned) {
    seenKeys.add(identityKey);
    const prev = previousByKey.get(identityKey);
    const fields = baseFieldsFromCase(c);
    let testCaseId: string;
    let lifecycle: PersistedTestCase['lifecycle'];
    let firstSeen: string;
    let lastSeen: string;

    if (prev) {
      lifecycle = 'updated';
      const storedId = nonEmpty(prev.testCaseId);
      testCaseId = storedId ?? testCaseIdFromIdentityKey(identityKey);
      firstSeen = nonEmpty(prev.firstSeen) ?? now;
      lastSeen = now;
    } else {
      lifecycle = 'new';
      testCaseId = testCaseIdFromIdentityKey(identityKey);
      firstSeen = now;
      lastSeen = now;
    }

    const nextCase: UniqueTestCase = {
      ...c,
      testCaseId,
      projectId: fields.projectId,
      behavior: fields.behavior,
      ...(note !== undefined ? { identityNote: note } : {}),
    };
    cases.push(nextCase);

    activePersisted.push({
      testCaseId,
      identityKey,
      projectId: fields.projectId,
      screenId: fields.screenId,
      elementId: fields.elementId,
      behavior: fields.behavior,
      category: fields.category,
      scenario: fields.scenario,
      lifecycle,
      firstSeen,
      lastSeen,
    });
  }

  const deprecated: PersistedTestCase[] = [];
  if (previous != null) {
    for (const row of previous) {
      if (!row?.identityKey || seenKeys.has(row.identityKey)) continue;
      deprecated.push({
        ...row,
        lifecycle: 'deprecated',
      });
    }
  }

  return {
    cases,
    persisted: [...activePersisted, ...deprecated],
    deprecated,
  };
}

function isPersistedRow(value: unknown): value is PersistedTestCase {
  if (value == null || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.identityKey === 'string' && typeof row.testCaseId === 'string';
}

/**
 * Load the identity registry. Missing file → null (start a new registry).
 * Corrupt JSON → throw; never wipe the file.
 */
export function loadPersistedTestCases(filePath: string): PersistedTestCase[] | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read test-case identities at ${filePath}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Corrupt test-case identities JSON at ${filePath}: ${message}. File was not modified.`
    );
  }

  if (Array.isArray(parsed)) {
    if (!parsed.every(isPersistedRow)) {
      throw new Error(
        `Corrupt test-case identities JSON at ${filePath}: expected PersistedTestCase[]. File was not modified.`
      );
    }
    return parsed;
  }

  if (parsed != null && typeof parsed === 'object') {
    const cases = (parsed as TestCaseIdentityRegistry).cases;
    if (!Array.isArray(cases) || !cases.every(isPersistedRow)) {
      throw new Error(
        `Corrupt test-case identities JSON at ${filePath}: expected { version, cases }. File was not modified.`
      );
    }
    return cases;
  }

  throw new Error(
    `Corrupt test-case identities JSON at ${filePath}: unexpected root type. File was not modified.`
  );
}

/** Persist the identity registry (versioned wrapper). Creates parent dirs as needed. */
export function savePersistedTestCases(filePath: string, cases: PersistedTestCase[]): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const registry: TestCaseIdentityRegistry = {
    version: '1',
    cases,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}
