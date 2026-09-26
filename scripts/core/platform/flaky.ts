/** Detection only — does not add retry loops to runners or change retest.ts. */
export const FLAKY_DETECTION_STATUS = 'PARTIAL' as const;

/** Config default: no extra attempts. Detection only; runners are unchanged. */
export const DEFAULT_MAX_EXTRA_ATTEMPTS = 0;

/** Safe default for optional executor retry — disabled; callers may enable explicitly. */
export const DEFAULT_RETRY_ENABLED = false;

/** Total attempts including the first when retry is enabled. 2 = attempt 1 + at most attempt 2. */
export const DEFAULT_RETRY_MAX_ATTEMPTS = 2;

export type AttemptStatus = 'PASS' | 'FAIL';

export interface StabilityAttempt {
  status: AttemptStatus;
  at: string;
}

export type StabilityClassification =
  | { status: 'consistent-pass' }
  | { status: 'consistent-fail' }
  | { status: 'intermittent' }
  | { status: 'NOT_TESTED'; reason: string };

export interface QuarantineEntry {
  id: string;
  status: 'FAIL';
  quarantined: true;
  originalStatus: 'FAIL';
}

export interface FailureHistoryEntry {
  id: string;
  status: AttemptStatus;
  runAt?: string;
}

/** Optional retry policy for classifyRetry / executeDependentPlan — not retest.ts. */
export interface RetryPolicy {
  enabled?: boolean;
  /** Total attempts including the first. Ignored when enabled is not true. */
  maxAttempts?: number;
}

export interface RetryAttemptRecord {
  attempt: number;
  status: string;
}

export type RetryClassification = {
  /** Overall status — never PASS when attempts mixed FAIL/PASS. */
  status: string;
  reason?: string;
  /** Total attempts the caller may run (1 when disabled). */
  maxAttemptsAllowed: number;
};

/**
 * Classify attempt history. Mixed PASS/FAIL → intermittent (flaky).
 * Never collapses intermittent results to PASS. Empty → NOT_TESTED.
 */
export function classifyStability(attempts: readonly StabilityAttempt[]): StabilityClassification {
  if (attempts.length === 0) {
    return { status: 'NOT_TESTED', reason: 'no attempts recorded' };
  }

  const statuses = attempts.map((row) => row.status);
  const allPass = statuses.every((s) => s === 'PASS');
  const allFail = statuses.every((s) => s === 'FAIL');

  if (allPass) return { status: 'consistent-pass' };
  if (allFail) return { status: 'consistent-fail' };
  return { status: 'intermittent' };
}

/**
 * Bound extra retry attempts. Never runs more than `maxExtra` extra tries beyond
 * the first attempt. Default maxExtra is 0. Does not add retries to runners.
 *
 * @returns total attempts allowed (1 + maxExtra), clamped so attempts never exceed that.
 */
export function boundedRetries(attempts: number, maxExtra: number = DEFAULT_MAX_EXTRA_ATTEMPTS): number {
  const extra = Math.max(0, Math.floor(maxExtra));
  const requested = Math.max(0, Math.floor(attempts));
  const maxAllowed = 1 + extra;
  return Math.min(requested, maxAllowed);
}

/**
 * Resolve how many total attempts are allowed. When `enabled !== true`, always 1
 * (maxAttempts is ignored). When enabled, extra = maxAttempts - 1, capped via
 * {@link boundedRetries}. Throws if enabled and maxAttempts &lt; 1.
 */
export function resolveRetryMaxAttemptsAllowed(policy: RetryPolicy = {}): number {
  if (policy.enabled !== true) {
    return 1;
  }
  const raw = policy.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS;
  if (!Number.isFinite(raw) || raw < 1) {
    throw new Error(`retry.maxAttempts must be >= 1 (got ${String(raw)})`);
  }
  const maxAttempts = Math.floor(raw);
  const extra = maxAttempts - 1;
  return boundedRetries(maxAttempts, extra);
}

function formatAttemptReason(attempts: readonly RetryAttemptRecord[]): string {
  return attempts.map((row) => `attempt ${row.attempt} ${row.status}`).join('; ');
}

/**
 * Classify recorded attempts under a retry policy. Does not run retries itself.
 *
 * - enabled !== true → maxAttemptsAllowed 1; classify the single recorded outcome (no extra-attempt narrative).
 * - All PASS → PASS (caller should not continue after attempt 1 PASS).
 * - All FAIL → FAIL (consistent defect; attempts remain listed by the caller).
 * - Mixed FAIL/PASS → FLAKY with a reason listing each attempt — never PASS.
 * - TIMEOUT / CANCELLED on any attempt → that status; do not treat as FLAKY or PASS.
 */
export function classifyRetry(
  attempts: readonly RetryAttemptRecord[],
  policy: RetryPolicy = {}
): RetryClassification {
  const maxAttemptsAllowed = resolveRetryMaxAttemptsAllowed(policy);

  if (attempts.length === 0) {
    return {
      status: 'NOT_TESTED',
      reason: 'no attempts recorded',
      maxAttemptsAllowed,
    };
  }

  if (policy.enabled !== true) {
    const only = attempts[0]!;
    return { status: only.status, maxAttemptsAllowed: 1 };
  }

  for (const row of attempts) {
    if (row.status === 'TIMEOUT' || row.status === 'CANCELLED') {
      return {
        status: row.status,
        reason: formatAttemptReason(attempts),
        maxAttemptsAllowed,
      };
    }
  }

  const statuses = attempts.map((row) => row.status);
  const allPass = statuses.every((s) => s === 'PASS');
  const allFail = statuses.every((s) => s === 'FAIL');

  if (allPass) {
    return { status: 'PASS', maxAttemptsAllowed };
  }
  if (allFail) {
    return {
      status: 'FAIL',
      reason: formatAttemptReason(attempts),
      maxAttemptsAllowed,
    };
  }

  return {
    status: 'FLAKY',
    reason: formatAttemptReason(attempts),
    maxAttemptsAllowed,
  };
}

/**
 * Mark an id as quarantined. Stored status remains the original FAIL —
 * a quarantined FAIL is never PASS.
 */
export function quarantine(id: string, list: readonly QuarantineEntry[] = []): QuarantineEntry[] {
  const existing = list.find((row) => row.id === id);
  if (existing) {
    return list.map((row) =>
      row.id === id
        ? { id, status: 'FAIL' as const, quarantined: true as const, originalStatus: 'FAIL' as const }
        : row
    );
  }
  return [
    ...list,
    { id, status: 'FAIL', quarantined: true, originalStatus: 'FAIL' },
  ];
}

/**
 * Count how many runs each id failed. Does not flip intermittent to PASS.
 */
export function trackFailures(
  history: readonly FailureHistoryEntry[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of history) {
    if (row.status !== 'FAIL') continue;
    counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  }
  return counts;
}

/** Evidence attached to one historical run — preserved unchanged on FAIL entries. */
export interface HistoricalRunEvidence {
  message?: string;
  screenshot?: string;
  log?: string;
}

/** One ordered historical run for a single test (oldest first). */
export interface HistoricalRun {
  run: number;
  status: string;
  evidence?: HistoricalRunEvidence;
}

export interface HistoricalFailureEntry {
  run: number;
  status: 'FAIL';
  evidence?: HistoricalRunEvidence;
}

/**
 * Classification across historical runs. `suppress` is always false —
 * FLAKY never quarantines, skips, or hides a test.
 */
export type HistoricalClassification = {
  status: string;
  reason?: string;
  failures: HistoricalFailureEntry[];
  suppress: false;
};

function formatHistoricalRunReason(runs: readonly HistoricalRun[]): string {
  return runs.map((row) => `run ${row.run} ${row.status}`).join('; ');
}

function collectHistoricalFailures(
  runs: readonly HistoricalRun[]
): HistoricalFailureEntry[] {
  const failures: HistoricalFailureEntry[] = [];
  for (const row of runs) {
    if (row.status !== 'FAIL') continue;
    if (row.evidence !== undefined) {
      failures.push({ run: row.run, status: 'FAIL', evidence: row.evidence });
    } else {
      failures.push({ run: row.run, status: 'FAIL' });
    }
  }
  return failures;
}

/**
 * Classify the same test across ordered historical runs (oldest first).
 *
 * - Empty → NOT_TESTED (not FLAKY).
 * - Only PASS → PASS.
 * - Only FAIL → FAIL (consistent defect; every FAIL keeps its evidence).
 * - At least one PASS and one FAIL → FLAKY (never remapped to PASS).
 * - BLOCKED / NOT_TESTED alone never make a test FLAKY.
 * - TIMEOUT / CANCELLED are not PASS and do not invent PASS.
 * - `suppress` is always false; never calls {@link quarantine}.
 */
export function classifyHistoricalRuns(
  runs: readonly HistoricalRun[]
): HistoricalClassification {
  const failures = collectHistoricalFailures(runs);

  if (runs.length === 0) {
    return {
      status: 'NOT_TESTED',
      reason: 'no historical runs recorded',
      failures,
      suppress: false,
    };
  }

  const reason = formatHistoricalRunReason(runs);
  const hasPass = runs.some((row) => row.status === 'PASS');
  const hasFail = runs.some((row) => row.status === 'FAIL');

  if (hasPass && hasFail) {
    return { status: 'FLAKY', reason, failures, suppress: false };
  }

  if (hasFail) {
    // Consistent FAIL — TIMEOUT/CANCELLED/BLOCKED/NOT_TESTED may appear in reason only.
    return { status: 'FAIL', reason, failures, suppress: false };
  }

  if (hasPass) {
    // Only PASS among PASS/FAIL; other statuses stay in the reason when present.
    const onlyPass = runs.every((row) => row.status === 'PASS');
    return {
      status: 'PASS',
      ...(onlyPass ? {} : { reason }),
      failures,
      suppress: false,
    };
  }

  // No PASS and no FAIL — BLOCKED / NOT_TESTED / TIMEOUT / CANCELLED alone are not FLAKY.
  const unique = [...new Set(runs.map((row) => row.status))];
  if (unique.length === 1) {
    return { status: unique[0]!, reason, failures, suppress: false };
  }

  return {
    status: 'NOT_TESTED',
    reason,
    failures,
    suppress: false,
  };
}

/**
 * Classify each test id from caller-supplied history. Pure — does not read
 * or delete `reports/history`. Does not wire into qa:all.
 */
export function detectFlakyFromHistory(
  historyByTestId: Record<string, readonly HistoricalRun[]>
): Record<string, HistoricalClassification> {
  const out: Record<string, HistoricalClassification> = {};
  for (const [id, runs] of Object.entries(historyByTestId)) {
    out[id] = classifyHistoricalRuns(runs);
  }
  return out;
}
