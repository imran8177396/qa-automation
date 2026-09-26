/**
 * Optional dependent-test plan executor for the orchestrator.
 * Not wired into run-all / qa:all — scheduling only when a caller invokes it.
 *
 * Config example (caller-supplied; committed qa.config.json stays sequential / retry off):
 * `{ "execution": { "parallel": true, "maxConcurrency": 4 } }`
 * `{ "retry": { "enabled": true, "maxAttempts": 2 } }`
 * Defaults remain `parallel: false`, `maxConcurrency: 1`, `retry.enabled: false`.
 */
import {
  isEngineResultStatus,
  makeResult,
  type EngineResultStatus,
  type TestResult,
} from '../core/engine-contract';
import {
  dependentTestsToNodes,
  scheduleDependentTests,
  type DependentTest,
  type ScheduleBlockedResult,
  type ScheduleDependentTestsResult,
} from '../core/platform/dependencies';
import {
  runWithTimeout,
  type RunWithTimeoutCleanupReason,
} from '../core/platform/cancellation';
import {
  classifyRetry,
  DEFAULT_RETRY_ENABLED,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  resolveRetryMaxAttemptsAllowed,
  type RetryAttemptRecord,
  type RetryPolicy,
} from '../core/platform/flaky';
import { planParallel, runWithConcurrency } from '../core/platform/parallel';
import {
  packResourceCompatibleWaves,
  type ResourceAwareTest,
} from '../core/platform/resources';
import { assertResourceBudget } from '../core/platform/safety-budget';

export type DependentPlanRunOne = (testId: string) => Promise<{ status: string }>;

export type ExecuteDependentPlanOptions = {
  /** Default false — one test at a time in dependency order. */
  parallel?: boolean;
  /** Default 1. When parallel is true, caps overlapping work per chunk. */
  maxConcurrency?: number;
  /**
   * Optional plan-wide timeout. Positive ms arms a timer per runOne wrap.
   * Omitted or 0 = no plan timer (node.timeoutMs may still apply).
   */
  timeoutMs?: number;
  /** Optional AbortSignal — cancel/abort yields CANCELLED, not PASS. */
  signal?: AbortSignal;
  /**
   * Always invoked after each item outcome (including timeout / cancel / abort).
   * Separate from runWithTimeout's internal cleanup.
   */
  cleanup?: (testId: string, outcome: RunWithTimeoutCleanupReason) => Promise<void>;
  /**
   * Optional retry for FAIL only. Default `{ enabled: false, maxAttempts: 2 }`.
   * Mixed FAIL then PASS → FLAKY (never PASS). Dependents still require PASS.
   */
  retry?: RetryPolicy;
};

export type ExecuteDependentPlanResult = {
  order: string[];
  results: TestResult[];
  /** Final schedule snapshot after the walk (for callers / tests). */
  schedule: ScheduleDependentTestsResult;
};

const DEFAULT_RETRY: RetryPolicy = {
  enabled: DEFAULT_RETRY_ENABLED,
  maxAttempts: DEFAULT_RETRY_MAX_ATTEMPTS,
};

/** Statuses that end the retry loop — only FAIL is retried when policy allows. */
const RETRY_STOP_STATUSES = new Set<string>([
  'PASS',
  'TIMEOUT',
  'CANCELLED',
  'BLOCKED',
  'NOT_TESTED',
  'REQUIRES_CONFIGURATION',
  'SKIPPED',
  'NOT_APPLICABLE',
  'FLAKY',
]);

function toEngineStatus(status: string): EngineResultStatus {
  if (isEngineResultStatus(status)) return status;
  throw new Error(`executeDependentPlan: runOne returned unknown status "${status}"`);
}

function recordBlockedResult(testId: string, reason: string): TestResult {
  return makeResult({
    id: testId,
    testType: 'workflow',
    category: 'functional',
    name: testId,
    status: 'BLOCKED',
    metadata: { reason },
    error: { message: reason },
  });
}

function recordRunOutcome(
  testId: string,
  status: EngineResultStatus,
  reason?: string,
  extraMetadata?: Record<string, unknown>
): TestResult {
  if (
    status === 'BLOCKED' ||
    status === 'NOT_TESTED' ||
    status === 'SKIPPED' ||
    status === 'REQUIRES_CONFIGURATION' ||
    status === 'TIMEOUT' ||
    status === 'CANCELLED' ||
    status === 'FLAKY'
  ) {
    const message = reason?.trim() || `${testId} recorded as ${status}`;
    return makeResult({
      id: testId,
      testType: 'workflow',
      category: 'functional',
      name: testId,
      status,
      metadata: { reason: message, ...(extraMetadata ?? {}) },
      error: { message },
    });
  }

  const metadata: Record<string, unknown> = { ...(extraMetadata ?? {}) };
  if (reason?.trim()) {
    metadata.reason = reason.trim();
  }

  return makeResult({
    id: testId,
    testType: 'workflow',
    category: 'functional',
    name: testId,
    status,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(reason?.trim() ? { error: { message: reason.trim() } } : {}),
  });
}

function resolveEffectiveTimeoutMs(
  test: DependentTest | undefined,
  options: ExecuteDependentPlanOptions
): number | undefined {
  const nodeTimeout = test?.timeoutMs;
  if (typeof nodeTimeout === 'number' && nodeTimeout > 0) return nodeTimeout;
  if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0) return options.timeoutMs;
  return undefined;
}

function shouldWrapRunOne(
  test: DependentTest | undefined,
  options: ExecuteDependentPlanOptions
): boolean {
  const effective = resolveEffectiveTimeoutMs(test, options);
  if (effective !== undefined && effective > 0) return true;
  if (options.timeoutMs !== undefined) return true;
  if (options.signal !== undefined) return true;
  return false;
}

/**
 * Invoke runOne, optionally wrapped with runWithTimeout when a timer or signal applies.
 * TIMEOUT / CANCELLED never take the PASS success path.
 */
async function invokeRunOne(
  testId: string,
  test: DependentTest | undefined,
  runOne: DependentPlanRunOne,
  options: ExecuteDependentPlanOptions
): Promise<TestResult> {
  if (!shouldWrapRunOne(test, options)) {
    const outcome = await runOne(testId);
    const status = toEngineStatus(outcome.status);
    await options.cleanup?.(testId, 'completed');
    return recordRunOutcome(testId, status);
  }

  const timeoutMs = resolveEffectiveTimeoutMs(test, options);
  const wrapTimeoutMs =
    timeoutMs ??
    (typeof options.timeoutMs === 'number' ? options.timeoutMs : undefined);

  let runOneStatus: EngineResultStatus | undefined;
  let cleanupReason: RunWithTimeoutCleanupReason = 'completed';

  const wrapped = await runWithTimeout({
    ...(wrapTimeoutMs !== undefined ? { timeoutMs: wrapTimeoutMs } : {}),
    signal: options.signal,
    run: async (_signal) => {
      const outcome = await runOne(testId);
      runOneStatus = toEngineStatus(outcome.status);
    },
    cleanup: async (reason) => {
      cleanupReason = reason;
      await options.cleanup?.(testId, reason);
    },
  });

  if (wrapped.status === 'TIMEOUT') {
    return recordRunOutcome(testId, 'TIMEOUT', wrapped.reason);
  }
  if (wrapped.status === 'CANCELLED') {
    return recordRunOutcome(testId, 'CANCELLED', wrapped.reason);
  }

  if (runOneStatus === undefined) {
    throw new Error(`executeDependentPlan: ${testId} completed without a runOne status`);
  }
  void cleanupReason;
  return recordRunOutcome(testId, runOneStatus);
}

/**
 * Optionally retry FAIL via classifyRetry. Mixed FAIL→PASS stores FLAKY, never PASS.
 * TIMEOUT / CANCELLED / gated statuses are not retried. Retest.ts is unrelated.
 */
async function invokeRunOneWithRetry(
  testId: string,
  test: DependentTest | undefined,
  runOne: DependentPlanRunOne,
  options: ExecuteDependentPlanOptions
): Promise<TestResult> {
  const policy: RetryPolicy = {
    enabled: options.retry?.enabled ?? DEFAULT_RETRY.enabled,
    maxAttempts: options.retry?.maxAttempts ?? DEFAULT_RETRY.maxAttempts,
  };

  if (policy.enabled !== true) {
    return invokeRunOne(testId, test, runOne, options);
  }

  const maxAttemptsAllowed = resolveRetryMaxAttemptsAllowed(policy);
  const attemptRecords: RetryAttemptRecord[] = [];

  for (let attempt = 1; attempt <= maxAttemptsAllowed; attempt++) {
    const recorded = await invokeRunOne(testId, test, runOne, options);
    attemptRecords.push({ attempt, status: recorded.status });

    if (RETRY_STOP_STATUSES.has(recorded.status) || recorded.status !== 'FAIL') {
      break;
    }
  }

  const classified = classifyRetry(attemptRecords, policy);
  const overall = toEngineStatus(classified.status);
  const attemptsMeta = { attempts: attemptRecords };

  if (overall === 'FLAKY') {
    const reason = classified.reason ?? formatFallbackRetryReason(attemptRecords);
    return recordRunOutcome(testId, 'FLAKY', reason, attemptsMeta);
  }

  if (overall === 'TIMEOUT' || overall === 'CANCELLED') {
    const reason = classified.reason ?? formatFallbackRetryReason(attemptRecords);
    return recordRunOutcome(testId, overall, reason, attemptsMeta);
  }

  if (overall === 'FAIL') {
    return recordRunOutcome(
      testId,
      'FAIL',
      classified.reason ?? formatFallbackRetryReason(attemptRecords),
      attemptsMeta
    );
  }

  if (
    overall === 'BLOCKED' ||
    overall === 'NOT_TESTED' ||
    overall === 'SKIPPED' ||
    overall === 'REQUIRES_CONFIGURATION'
  ) {
    const reason = classified.reason ?? formatFallbackRetryReason(attemptRecords);
    return recordRunOutcome(testId, overall, reason, attemptsMeta);
  }

  return recordRunOutcome(testId, overall, classified.reason, attemptsMeta);
}

function formatFallbackRetryReason(attempts: readonly RetryAttemptRecord[]): string {
  return attempts.map((row) => `attempt ${row.attempt} ${row.status}`).join('; ');
}

function toResourceAware(test: DependentTest): ResourceAwareTest {
  return {
    id: test.testId,
    resources: test.resources,
    allowSharedMutableState: test.allowSharedMutableState,
  };
}

/**
 * Pack ready tests into sub-waves from resource declarations.
 * Undeclared tests run alone. Preserves input order; does not drop tests.
 */
function splitByResourceRequirements(ready: readonly DependentTest[]): DependentTest[][] {
  const aware = ready.map(toResourceAware);
  const groups = packResourceCompatibleWaves(aware);
  const byId = new Map(ready.map((test) => [test.testId, test]));
  return groups.map((group) =>
    group.map((row) => {
      const test = byId.get(row.id);
      if (!test) {
        throw new Error(`splitByResourceRequirements: unknown test id ${row.id}`);
      }
      return test;
    })
  );
}

function chunkByMaxConcurrency<T>(items: readonly T[], maxConcurrency: number): T[][] {
  const size = Math.max(1, maxConcurrency);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Record BLOCKED only for ids that are due now (current wave / chunk).
 * Do not treat "prereq not executed yet" as terminal BLOCKED for later waves.
 */
function applyBlockedForIds(
  ids: readonly string[],
  blocked: readonly ScheduleBlockedResult[],
  resultsById: Map<string, { status: string }>,
  results: TestResult[]
): void {
  const blockedById = new Map(blocked.map((row) => [row.testId, row]));
  for (const id of ids) {
    if (resultsById.has(id)) continue;
    const row = blockedById.get(id);
    if (!row) continue;
    results.push(recordBlockedResult(id, row.reason));
    resultsById.set(id, { status: 'BLOCKED' });
  }
}

/**
 * Schedule then walk dependent tests in topological order.
 *
 * - Scheduler throws (cycle / unknown id / bad requiredStatus) are rethrown — never converted to PASS.
 * - BLOCKED ids are recorded via makeResult with a non-empty reason; runOne is never called for them.
 * - After each runOne result (or each parallel wave), the gate is recomputed so a FAIL blocks later dependents.
 * - TIMEOUT / CANCELLED / FLAKY are not PASS — dependents are BLOCKED the same way as any non-PASS prerequisite.
 * - Never marks a test FAIL when it was never executed.
 * - Optional `{ parallel, maxConcurrency }` defaults to `{ parallel: false, maxConcurrency: 1 }` (sequential).
 *   When parallel is true and maxConcurrency > 1, ready independents may overlap via runWithConcurrency.
 * - Optional `{ retry }` defaults to `{ enabled: false, maxAttempts: 2 }`. FAIL-then-PASS → FLAKY, never PASS.
 */
export async function executeDependentPlan(
  tests: readonly DependentTest[],
  runOne: DependentPlanRunOne,
  options: ExecuteDependentPlanOptions = {}
): Promise<ExecuteDependentPlanResult> {
  const parallel = options.parallel === true;
  const maxConcurrency = options.maxConcurrency ?? 1;

  // qa.config.json example for callers: { "execution": { "parallel": true, "maxConcurrency": 4 } }
  // Committed defaults remain parallel: false and maxConcurrency: 1 (safe sequential).
  // Retry example: { "retry": { "enabled": true, "maxAttempts": 2 } } — committed stays enabled: false.

  if (parallel && maxConcurrency < 1) {
    assertResourceBudget({ concurrency: 1, maxConcurrency });
  }

  if (!parallel || maxConcurrency === 1) {
    return executeDependentPlanSequential(tests, runOne, options);
  }

  return executeDependentPlanParallel(tests, runOne, maxConcurrency, options);
}

async function executeDependentPlanSequential(
  tests: readonly DependentTest[],
  runOne: DependentPlanRunOne,
  options: ExecuteDependentPlanOptions
): Promise<ExecuteDependentPlanResult> {
  const byId = new Map(tests.map((test) => [test.testId, test]));
  const initial = scheduleDependentTests(tests, {});
  const resultsById = new Map<string, { status: string }>();
  const results: TestResult[] = [];

  for (const testId of initial.order) {
    const snap = scheduleDependentTests(tests, resultsById);
    const blocked = snap.blocked.find((row) => row.testId === testId);
    if (blocked) {
      results.push(recordBlockedResult(testId, blocked.reason));
      resultsById.set(testId, { status: 'BLOCKED' });
      continue;
    }

    if (!snap.runnable.includes(testId)) {
      if (resultsById.has(testId)) continue;
      throw new Error(
        `executeDependentPlan: ${testId} is neither runnable nor blocked after scheduling`
      );
    }

    const recorded = await invokeRunOneWithRetry(testId, byId.get(testId), runOne, options);
    resultsById.set(testId, { status: recorded.status });
    results.push(recorded);
  }

  return {
    order: initial.order,
    results,
    schedule: scheduleDependentTests(tests, resultsById),
  };
}

/**
 * Parallel path: dependency waves from {@link planParallel}, then resource-requirement
 * splits and maxConcurrency chunks. Real in-process Promise concurrency via {@link runWithConcurrency}.
 */
export async function executeDependentPlanParallel(
  tests: readonly DependentTest[],
  runOne: DependentPlanRunOne,
  maxConcurrency: number,
  options: ExecuteDependentPlanOptions = {}
): Promise<ExecuteDependentPlanResult> {
  const initial = scheduleDependentTests(tests, {});
  const byId = new Map(tests.map((test) => [test.testId, test]));
  const resultsById = new Map<string, { status: string }>();
  const results: TestResult[] = [];

  const plan = planParallel({
    nodes: dependentTestsToNodes(tests),
    enabled: true,
    concurrency: maxConcurrency,
    maxWorkers: maxConcurrency,
    signal: options.signal,
  });

  for (const waveIds of plan.waves) {
    let snap = scheduleDependentTests(tests, resultsById);
    applyBlockedForIds(waveIds, snap.blocked, resultsById, results);

    const readyIds = waveIds.filter((id) => snap.runnable.includes(id));
    if (readyIds.length === 0) continue;

    const readyTests = readyIds.map((id) => {
      const test = byId.get(id);
      if (!test) {
        throw new Error(`executeDependentPlan: unknown test id in wave: ${id}`);
      }
      return test;
    });

    const resourceGroups = splitByResourceRequirements(readyTests);

    for (const group of resourceGroups) {
      const chunks = chunkByMaxConcurrency(group, maxConcurrency);

      for (const chunk of chunks) {
        const chunkIds = chunk.map((test) => test.testId);
        snap = scheduleDependentTests(tests, resultsById);
        applyBlockedForIds(chunkIds, snap.blocked, resultsById, results);

        const runnableChunk = chunk.filter((test) => snap.runnable.includes(test.testId));
        if (runnableChunk.length === 0) continue;

        assertResourceBudget({
          concurrency: runnableChunk.length,
          maxConcurrency,
        });

        const concurrencyResults = await runWithConcurrency(
          runnableChunk.map((test) => async () => {
            const recorded = await invokeRunOneWithRetry(test.testId, test, runOne, options);
            return recorded;
          }),
          runnableChunk.length,
          options.signal
        );

        for (let i = 0; i < concurrencyResults.length; i++) {
          const row = concurrencyResults[i]!;
          const testId = runnableChunk[i]!.testId;
          if (row.status === 'FAIL') {
            throw row.error;
          }
          if (row.status === 'cancelled') {
            const reason = `cancelled: ${row.reason}`;
            const recorded = recordRunOutcome(testId, 'CANCELLED', reason);
            resultsById.set(testId, { status: 'CANCELLED' });
            results.push(recorded);
            await options.cleanup?.(testId, 'cancelled');
            continue;
          }
          resultsById.set(testId, { status: row.value.status });
          results.push(row.value);
        }
      }
    }
  }

  const finalSnap = scheduleDependentTests(tests, resultsById);
  applyBlockedForIds(initial.order, finalSnap.blocked, resultsById, results);

  for (const testId of initial.order) {
    if (resultsById.has(testId)) continue;
    throw new Error(
      `executeDependentPlan: ${testId} was never executed and was not BLOCKED`
    );
  }

  return {
    order: initial.order,
    results,
    schedule: scheduleDependentTests(tests, resultsById),
  };
}
