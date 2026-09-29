/**
 * Human override document (qa.generated-overrides.json): { version:"1", overrides:[{ testCaseId, action:"include"|"exclude"|"override", reason?, priority?, expectedResult?, testData?, authorization? }] }. Absent file = no overrides.
 */

import fs from 'node:fs';
import type { SeverityLevel, UniqueTestCase } from './test-case-uniqueness';

export type OverrideAction = 'include' | 'exclude' | 'override';
export type HumanAuthorization = 'allow' | 'deny';

export interface OverrideEntry {
  testCaseId: string;
  action: OverrideAction;
  reason?: string;
  priority?: string;
  expectedResult?: string;
  /** Replaces UniqueTestCase.input when action is override. */
  testData?: string;
  authorization?: HumanAuthorization | string;
}

export interface OverrideDocument {
  version: string;
  overrides: OverrideEntry[];
}

export interface HumanOverrideRef {
  testCaseId: string;
  reason: string;
}

export interface ApplyHumanOverridesResult {
  cases: UniqueTestCase[];
  excluded: HumanOverrideRef[];
  unmatched: HumanOverrideRef[];
  rejected: HumanOverrideRef[];
}

const PRIORITY_LEVELS = new Set(['critical', 'high', 'medium', 'low']);
const INCLUDE_REASON = 'included by human override';
const PRIORITY_OVERRIDE_REASON = 'priority set by human override';
/** Recorded semantic: authorization never executes delete/submit or marks PASS. */
export const HUMAN_AUTHORIZATION_NOTE = 'human authorization does not execute the case';
const EXCLUDE_REASON_REQUIRED = 'exclude requires a recorded reason';
const UNMATCHED_REASON = 'no generated test case with this id';
const INVALID_PRIORITY = 'priority must be critical|high|medium|low';
const OVERRIDE_FIELDS_REQUIRED =
  'override requires at least one of priority, expectedResult, testData, authorization';

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cloneCase(c: UniqueTestCase): UniqueTestCase {
  return {
    ...c,
    preconditions: [...c.preconditions],
    steps: [...c.steps],
    quality: { ...c.quality },
  };
}

function isAuthorization(value: string | undefined): value is HumanAuthorization {
  return value === 'allow' || value === 'deny';
}

/**
 * Apply human overrides after dedupe. Cases are never deleted; exclusions stay in
 * `cases` with excluded:true. Overrides never invent cases, never mark PASS, and
 * authorization "allow" never sets executable or clears BLOCKED safety.
 */
export function applyHumanOverrides(
  cases: UniqueTestCase[],
  document: OverrideDocument | null
): ApplyHumanOverridesResult {
  if (document == null || !Array.isArray(document.overrides) || document.overrides.length === 0) {
    return {
      cases: cases.map(cloneCase),
      excluded: [],
      unmatched: [],
      rejected: [],
    };
  }

  const byId = new Map<string, UniqueTestCase>();
  const order: string[] = [];
  for (const c of cases) {
    const id = c.testCaseId;
    if (!byId.has(id)) {
      order.push(id);
    }
    byId.set(id, cloneCase(c));
  }

  const excluded: HumanOverrideRef[] = [];
  const unmatched: HumanOverrideRef[] = [];
  const rejected: HumanOverrideRef[] = [];
  /** Track which ids were excluded so a later include can clear them from excluded[]. */
  const excludedIds = new Set<string>();

  for (const entry of document.overrides) {
    const testCaseId = nonEmpty(entry?.testCaseId);
    if (!testCaseId) {
      rejected.push({
        testCaseId: String(entry?.testCaseId ?? ''),
        reason: 'REQUIRES_CONFIGURATION: testCaseId is required',
      });
      continue;
    }

    const action = entry.action;
    const existing = byId.get(testCaseId);

    if (existing == null) {
      unmatched.push({ testCaseId, reason: UNMATCHED_REASON });
      continue;
    }

    if (action === 'exclude') {
      const reason = nonEmpty(entry.reason);
      if (!reason) {
        rejected.push({
          testCaseId,
          reason: EXCLUDE_REASON_REQUIRED,
        });
        continue;
      }
      const next: UniqueTestCase = {
        ...existing,
        excluded: true,
        exclusionReason: reason,
      };
      byId.set(testCaseId, next);
      if (!excludedIds.has(testCaseId)) {
        excluded.push({ testCaseId, reason });
        excludedIds.add(testCaseId);
      } else {
        const idx = excluded.findIndex((e) => e.testCaseId === testCaseId);
        if (idx >= 0) excluded[idx] = { testCaseId, reason };
      }
      continue;
    }

    if (action === 'include') {
      const next: UniqueTestCase = {
        ...existing,
        excluded: false,
        exclusionReason: INCLUDE_REASON,
      };
      byId.set(testCaseId, next);
      if (excludedIds.has(testCaseId)) {
        const idx = excluded.findIndex((e) => e.testCaseId === testCaseId);
        if (idx >= 0) excluded.splice(idx, 1);
        excludedIds.delete(testCaseId);
      }
      continue;
    }

    if (action === 'override') {
      const hasPriority = entry.priority !== undefined && entry.priority !== null;
      const hasExpected = entry.expectedResult !== undefined && entry.expectedResult !== null;
      const hasTestData = entry.testData !== undefined && entry.testData !== null;
      const hasAuth = entry.authorization !== undefined && entry.authorization !== null;

      if (!hasPriority && !hasExpected && !hasTestData && !hasAuth) {
        rejected.push({ testCaseId, reason: OVERRIDE_FIELDS_REQUIRED });
        continue;
      }

      let next: UniqueTestCase = { ...existing };

      if (hasPriority) {
        const priorityRaw = String(entry.priority).trim().toLowerCase();
        if (!PRIORITY_LEVELS.has(priorityRaw)) {
          rejected.push({ testCaseId, reason: INVALID_PRIORITY });
          continue;
        }
        next = {
          ...next,
          priority: priorityRaw as SeverityLevel,
          priorityReason: PRIORITY_OVERRIDE_REASON,
        };
      }

      if (hasExpected) {
        next = {
          ...next,
          expectedResult: String(entry.expectedResult),
        };
      }

      if (hasTestData) {
        next = {
          ...next,
          input: String(entry.testData),
        };
      }

      if (hasAuth) {
        const authRaw = String(entry.authorization).trim().toLowerCase();
        if (!isAuthorization(authRaw)) {
          rejected.push({
            testCaseId,
            reason: 'authorization must be allow|deny',
          });
          continue;
        }
        // humanAuthorization "allow" does NOT set executable and does NOT clear BLOCKED.
        // HUMAN_AUTHORIZATION_NOTE: authorization never executes the case.
        next = {
          ...next,
          humanAuthorization: authRaw,
        };
      }

      byId.set(testCaseId, next);
      continue;
    }

    rejected.push({
      testCaseId,
      reason: `REQUIRES_CONFIGURATION: unknown action ${JSON.stringify(action)}`,
    });
  }

  const resultCases = order.map((id) => byId.get(id)!);
  return { cases: resultCases, excluded, unmatched, rejected };
}

export type LoadHumanOverridesResult =
  | { ok: true; document: OverrideDocument | null }
  | { ok: false; reason: string };

/**
 * Load qa.generated-overrides.json. Missing file → null document (no overrides).
 * Invalid JSON → ok:false (caller must exit 1 and not write generated-tests.json).
 */
export function loadHumanOverridesDocument(filePath: string): LoadHumanOverridesResult {
  if (!fs.existsSync(filePath)) {
    return { ok: true, document: null };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      reason: `failed to read human overrides: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      reason: `invalid JSON in human overrides file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'human overrides document must be a JSON object' };
  }

  const doc = parsed as Record<string, unknown>;
  if (!Array.isArray(doc.overrides)) {
    return { ok: false, reason: 'human overrides document.overrides must be an array' };
  }

  return {
    ok: true,
    document: {
      version: typeof doc.version === 'string' ? doc.version : '1',
      overrides: doc.overrides as OverrideEntry[],
    },
  };
}
