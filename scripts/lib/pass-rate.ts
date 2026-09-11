/**
 * Single labelled pass-rate helper.
 *
 * Named rates (use these; do not invent additional headline rates):
 * - uiExecutionPassRate  = passed / (passed + failed); skipped excluded
 * - assertionPassRate    = assertions passed / assertions executed (all suites)
 *
 * ---------------------------------------------------------------------------
 * Call sites left for the report-generator agent (do not edit those files here)
 * ---------------------------------------------------------------------------
 * scripts/lib/qa-report/enterprise-model.ts
 *   - local passRate(passed, total) ~L460 — formats passed/total as "N.N%"
 *   - browserSummaries[].passRate = passRate(passed, rows.length) ~L984
 *     (denominator includes skipped when rows include SKIPPED)
 *   - executive/analysis prose: passRate(pwPassed, executions.length) ~L1268
 *   - kpi.passRate = passRate(pwPassed, executions.length) ~L1386  ← headline UI figure
 *   - playwright.passRate = passRate(pwPassed, executions.length) ~L1606
 *   - evidence-integrity note: passRate(pwPassed, executions.length) ~L1773
 * scripts/lib/qa-report/enterprise-html.ts
 *   - KPI / Playwright tables render model.kpi.passRate and model.playwright.passRate
 *   - distribution passedPct = passed / totalUiExecutions (includes skip) ~L73
 * scripts/lib/qa-report/enterprise-docx.ts
 *   - same model fields; distribution % uses totalUiExecutions (includes skip) ~L818
 * scripts/lib/qa-report/build-report.ts
 *   - prints model.kpi.passRate
 * scripts/reporting/generate-final-report.ts
 *   - prints coverage.totals.passRatePercent (already skipped-excluded via coverage)
 *
 * Those sites currently divide by executions including skipped (5/10 → 50.0%).
 * They should call uiExecutionPassRate / assertionPassRate (5/9 → 55.6%).
 *
 * ---------------------------------------------------------------------------
 * Shared-lib / parser sites (touched from this helper task)
 * ---------------------------------------------------------------------------
 * scripts/coverage/calculate.ts — passRatePercent now uses uiExecutionPassRate
 *
 * Display-only (no computation; left unchanged):
 * scripts/coverage/run-coverage.ts, scripts/coverage/markdown.ts
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
