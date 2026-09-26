import { redactSecrets } from '../safety-policy';
import type { QaEnvironmentName } from './environment';

/** Environment permissions + resource budgets — does not loosen destructive/heavy gates. */
export const SAFETY_BUDGET_STATUS = 'PARTIAL' as const;

export interface EnvironmentPermissions {
  mode: 'read-only' | 'destructive-approved';
  destructive: boolean;
}

export interface EnvironmentPermissionsInput {
  approveDestructive?: boolean;
}

export interface ResourceBudgetInput {
  concurrency: number;
  maxConcurrency?: number;
  durationMs?: number;
  maxDurationMs?: number | null;
}

export type ResourceBudgetResult =
  | { ok: true }
  | { ok: false; status: 'BLOCKED'; reason: string };

/**
 * Production → read-only unless approveDestructive is true.
 * Development/staging → read-only unless approveDestructive is true.
 * Does not loosen existing destructive/heavy gates elsewhere.
 */
export function environmentPermissions(
  env: QaEnvironmentName,
  input: EnvironmentPermissionsInput = {}
): EnvironmentPermissions {
  void env;
  if (input.approveDestructive === true) {
    return { mode: 'destructive-approved', destructive: true };
  }
  return { mode: 'read-only', destructive: false };
}

/**
 * Assert concurrency / duration budgets.
 * Default maxConcurrency 1. maxDurationMs null/undefined means no duration cap.
 * Throws Error when over budget, or returns BLOCKED with reason when `throwOnViolation` is false.
 */
export function assertResourceBudget(
  input: ResourceBudgetInput,
  options: { throwOnViolation?: boolean } = {}
): ResourceBudgetResult {
  const maxConcurrency = input.maxConcurrency ?? 1;
  const throwOnViolation = options.throwOnViolation !== false;

  if (input.concurrency > maxConcurrency) {
    const reason = `concurrency ${input.concurrency} exceeds maxConcurrency ${maxConcurrency}`;
    if (throwOnViolation) {
      throw new Error(reason);
    }
    return { ok: false, status: 'BLOCKED', reason };
  }

  const maxDurationMs = input.maxDurationMs;
  if (
    maxDurationMs !== null &&
    maxDurationMs !== undefined &&
    typeof input.durationMs === 'number' &&
    input.durationMs > maxDurationMs
  ) {
    const reason = `durationMs ${input.durationMs} exceeds maxDurationMs ${maxDurationMs}`;
    if (throwOnViolation) {
      throw new Error(reason);
    }
    return { ok: false, status: 'BLOCKED', reason };
  }

  return { ok: true };
}

/** Re-export credential redaction for callers that import safety-budget. */
export { redactSecrets };
