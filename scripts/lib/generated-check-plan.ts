/**
 * Decide whether the generated-check Playwright suite should run.
 * An absent or empty plan is NOT_EXECUTED with 0 checks — never a FAIL
 * from leftover URLs, and never a vacuous PASS that pretends checks ran.
 */
export interface GeneratedCheckPlan {
  execute: boolean;
  checkCount: number;
  reason?: string;
}

const ABSENT_REASON =
  'NOT_EXECUTED: reports/discovery/planned-checks.json is absent. 0 generated checks. Discovery has not planned UI checks for this run.';
const EMPTY_REASON =
  'NOT_EXECUTED: planned-checks.json is empty. 0 generated checks.';
const INVALID_REASON =
  'NOT_EXECUTED: planned-checks.json is not an array. 0 generated checks.';

export function resolveGeneratedCheckPlan(raw: unknown): GeneratedCheckPlan {
  if (raw == null) {
    return { execute: false, checkCount: 0, reason: ABSENT_REASON };
  }
  if (!Array.isArray(raw)) {
    return { execute: false, checkCount: 0, reason: INVALID_REASON };
  }
  if (raw.length === 0) {
    return { execute: false, checkCount: 0, reason: EMPTY_REASON };
  }
  return { execute: true, checkCount: raw.length };
}
