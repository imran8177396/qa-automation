/**
 * Per-stage child-process timeouts for qa:all.
 * Sized for slow live sites (pages often 4–6s) and 3-browser Playwright suites.
 * A timed-out stage is recorded FAIL (environment/timeout) and the pipeline continues
 * unless --fail-fast is set.
 *
 * Worst-case wall clock if every stage hits its cap (serial, ignoring page-scan
 * parallelism): sum of STAGE_TIMEOUT_MS ≈ 16 hours. That is an upper bound so a
 * hung child cannot run forever — not a typical runtime. Parallel page-scan
 * (security/seo/content) reduces real elapsed time.
 */

const MINUTE = 60_000;

/** Default when a stage key is not listed (45 minutes). */
export const DEFAULT_STAGE_TIMEOUT_MS = 45 * MINUTE;

/**
 * Explicit ceilings per stage key. Playwright suites are generous because
 * navigation + teardown on live sites previously hung (especially responsive).
 */
export const STAGE_TIMEOUT_MS: Readonly<Record<string, number>> = {
  preflight: 20 * MINUTE,
  dependencies: 15 * MINUTE,
  discovery: 45 * MINUTE,
  inventory: 15 * MINUTE,
  'coverage-planning': 30 * MINUTE,
  e2e: 90 * MINUTE,
  visual: 75 * MINUTE,
  responsive: 90 * MINUTE,
  'cross-browser': 75 * MINUTE,
  accessibility: 60 * MINUTE,
  api: 20 * MINUTE,
  performance: 40 * MINUTE,
  security: 30 * MINUTE,
  seo: 30 * MINUTE,
  content: 30 * MINUTE,
  workflows: 45 * MINUTE,
  smoke: 30 * MINUTE,
  regression: 30 * MINUTE,
  localization: 30 * MINUTE,
  collect: 5 * MINUTE,
  coverage: 20 * MINUTE,
  analyze: 20 * MINUTE,
  retest: 60 * MINUTE,
  allure: 15 * MINUTE,
  'playwright-reports': 10 * MINUTE,
  report: 30 * MINUTE,
};

/** Sum of all configured stage caps (serial worst case), in ms. */
export function totalConfiguredStageTimeoutBudgetMs(
  keys: readonly string[] = Object.keys(STAGE_TIMEOUT_MS)
): number {
  return keys.reduce((sum, key) => sum + timeoutMsForStageKey(key), 0);
}

export function timeoutMsForStageKey(key: string): number {
  const configured = STAGE_TIMEOUT_MS[key];
  if (typeof configured === 'number' && configured > 0) return configured;
  return DEFAULT_STAGE_TIMEOUT_MS;
}

export function formatStageTimeoutReason(key: string, timeoutMs: number): string {
  const minutes = Math.round(timeoutMs / MINUTE);
  return `Stage timed out after ${minutes} minute(s) (${timeoutMs}ms) — recorded FAIL (environment/timeout), not skipped. Pipeline continues unless --fail-fast.`;
}
