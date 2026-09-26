/**
 * Single labelled pass-rate helper.
 *
 * Named rates (do not invent additional headline rates):
 * - uiExecutionPassRate  = passed / (passed + failed); skipped excluded
 * - assertionPassRate    = assertions passed / assertions executed (all suites)
 *
 * enterprise-model formats those via formatLabelledPassRate. Coverage
 * passRatePercent uses uiExecutionPassRate. Coverage markdown only displays
 * the stored percent — it does not recompute a second rate.
 */

export const UI_EXECUTION_PASS_RATE_SCOPE = 'uiExecutionPassRate';
export const ASSERTION_PASS_RATE_SCOPE = 'assertionPassRate';

export interface LabelledPassRate {
  scope: string;
  numerator: number;
  denominator: number;
  excludesSkipped: boolean;
  value: number | null;
}

function requireNonNegativeFinite(name: string, n: number): number {
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Pass-rate ${name} must be a non-negative finite number (got ${String(n)}).`);
  }
  return n;
}

/** One-decimal percent; never reports 100 when numerator < denominator. */
function roundPercent(numerator: number, denominator: number): number {
  const raw = (numerator / denominator) * 100;
  const rounded = Math.round(raw * 10) / 10;
  if (rounded === 100 && numerator < denominator) return 99.9;
  return rounded;
}

/** Generic labelled rate. Prefer the two named helpers below at call sites. */
export function labelledPassRate(input: {
  scope: string;
  numerator: number;
  denominator: number;
  excludesSkipped: boolean;
}): LabelledPassRate {
  const numerator = requireNonNegativeFinite('numerator', input.numerator);
  const denominator = requireNonNegativeFinite('denominator', input.denominator);
  return {
    scope: input.scope,
    numerator,
    denominator,
    excludesSkipped: input.excludesSkipped,
    value: denominator === 0 ? null : roundPercent(numerator, denominator),
  };
}

/** UI / execution pass rate: passed / (passed + failed). Skipped is excluded. */
export function uiExecutionPassRate(input: {
  passed: number;
  failed: number;
  skipped?: number;
}): LabelledPassRate {
  const passed = requireNonNegativeFinite('passed', input.passed);
  const failed = requireNonNegativeFinite('failed', input.failed);
  if (input.skipped !== undefined) {
    requireNonNegativeFinite('skipped', input.skipped);
  }
  return labelledPassRate({
    scope: UI_EXECUTION_PASS_RATE_SCOPE,
    numerator: passed,
    denominator: passed + failed,
    excludesSkipped: true,
  });
}

/**
 * Assertion pass rate: assertions passed / assertions executed, across all suites.
 * Uses assertion counts, not test-execution counts.
 */
export function assertionPassRate(input: { passed: number; executed: number }): LabelledPassRate {
  return labelledPassRate({
    scope: ASSERTION_PASS_RATE_SCOPE,
    numerator: requireNonNegativeFinite('passed', input.passed),
    denominator: requireNonNegativeFinite('executed', input.executed),
    excludesSkipped: false,
  });
}

function ratesDiffer(a: LabelledPassRate, b: LabelledPassRate): boolean {
  return (
    a.numerator !== b.numerator ||
    a.denominator !== b.denominator ||
    a.excludesSkipped !== b.excludesSkipped ||
    a.value !== b.value
  );
}

/** Throws when two rates share a scope label but are not the same measurement. */
export function assertNoConflictingRates(rates: readonly LabelledPassRate[]): void {
  const seen = new Map<string, LabelledPassRate>();
  for (const rate of rates) {
    const existing = seen.get(rate.scope);
    if (!existing) {
      seen.set(rate.scope, rate);
      continue;
    }
    if (ratesDiffer(existing, rate)) {
      throw new Error(
        `Conflicting pass rates for scope "${rate.scope}": ` +
          `${existing.numerator}/${existing.denominator} (value ${String(existing.value)}) vs ` +
          `${rate.numerator}/${rate.denominator} (value ${String(rate.value)})`
      );
    }
  }
}
