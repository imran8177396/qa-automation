import path from 'path';
import { PATHS } from '../lib/paths';
import { loadConfig } from '../lib/load-config';
import { writeJson } from '../discovery/write-json';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import {
  buildEngineSummary,
  makeResult,
  type TestResult,
} from '../core/engine-contract';
import { getTestType } from '../core/test-types/registry';
import type { ReliabilityTestsConfig } from '../types';
import {
  destructiveAuthorized,
  destructiveKindResults,
} from './resilience-auth';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const RELIABILITY_CATEGORY = getTestType('reliability')?.category ?? 'resilience';

export const RELIABILITY_CHECK_IDS = {
  serviceHealth: 'reliability:service-health',
  timeoutHandling: 'reliability:timeout-handling',
  retryBehavior: 'reliability:retry-behavior',
  errorHandling: 'reliability:error-handling',
} as const;

export type FetchLike = (
  input: string,
  init?: { method?: string; signal?: AbortSignal }
) => Promise<{ status: number; ok: boolean }>;

export interface RunReliabilityOptions {
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  writeSummary?: boolean;
  /** CLI argv used for `--authorize-destructive`. Defaults to process.argv. */
  argv?: string[];
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveOptionalUrl(
  direct: string | undefined,
  envName: string | undefined,
  env: NodeJS.ProcessEnv
): string | undefined {
  const fromDirect = direct?.trim();
  if (fromDirect && isHttpUrl(fromDirect)) return fromDirect;
  const key = envName?.trim();
  if (key) {
    const fromEnv = env[key]?.trim();
    if (fromEnv && isHttpUrl(fromEnv)) return fromEnv;
  }
  return undefined;
}

export function resolveReliabilityTimeoutMs(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(raw), MAX_TIMEOUT_MS);
}

function buildFetchSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  const anyFn = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anyFn === 'function') {
    return anyFn([timeout, external]);
  }
  return timeout;
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name;
  if (name === 'TimeoutError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /timed?\s*out|TimeoutError/i.test(message);
}

type ProbeOutcome =
  | { kind: 'response'; status: number; durationMs: number; timedOut: false; thrown: false }
  | { kind: 'error'; error: string; durationMs: number; timedOut: boolean; thrown: true };

async function probeGet(
  fetchImpl: FetchLike,
  target: string,
  timeoutMs: number,
  external?: AbortSignal
): Promise<ProbeOutcome> {
  const started = Date.now();
  try {
    const response = await fetchImpl(target, {
      method: 'GET',
      signal: buildFetchSignal(timeoutMs, external),
    });
    return {
      kind: 'response',
      status: response.status,
      durationMs: Date.now() - started,
      timedOut: false,
      thrown: false,
    };
  } catch (error: unknown) {
    const timedOut = isTimeoutError(error);
    const message = timedOut
      ? 'timed out'
      : error instanceof Error
        ? error.message
        : String(error);
    return {
      kind: 'error',
      error: message,
      durationMs: Date.now() - started,
      timedOut,
      thrown: true,
    };
  }
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

function loadReliabilityConfig(): ReliabilityTestsConfig {
  const loaded = loadConfig();
  const reliability = loaded.tests?.reliability;
  return {
    enabled: reliability?.enabled ?? false,
    healthUrl: reliability?.healthUrl,
    healthUrlEnv: reliability?.healthUrlEnv,
    timeoutMs: reliability?.timeoutMs,
  };
}

/**
 * Safe GET-only reliability probes. Never injects faults.
 * Disabled → one NOT_TESTED (no destructive rows).
 * Enabled → four safe rows (never omitted) plus destructive catalog rows.
 */
export async function runReliability(
  config: ReliabilityTestsConfig = loadReliabilityConfig(),
  env: NodeJS.ProcessEnv = process.env,
  options?: RunReliabilityOptions
): Promise<TestResult[]> {
  const fetchImpl = options?.fetchImpl ?? (globalThis.fetch as FetchLike);
  const writeSummary = options?.writeSummary !== false;
  const argv = options?.argv ?? process.argv.slice(2);
  const results: TestResult[] = [];

  if (!config.enabled) {
    results.push(
      makeResult({
        id: 'reliability:disabled',
        testType: 'reliability',
        category: RELIABILITY_CATEGORY,
        name: 'Reliability engine',
        status: 'NOT_TESTED',
        error: { message: 'reliability engine disabled' },
        metadata: { reason: 'reliability engine disabled' },
      })
    );
    if (writeSummary) writeReliabilitySummary(results);
    return results;
  }

  const timeoutMs = resolveReliabilityTimeoutMs(config.timeoutMs);
  const healthUrl = resolveOptionalUrl(config.healthUrl, config.healthUrlEnv, env);
  const missingUrlMessage =
    'no health URL configured (set tests.reliability.healthUrl or healthUrlEnv)';

  if (!healthUrl) {
    for (const [id, name] of [
      [RELIABILITY_CHECK_IDS.serviceHealth, 'Service health'],
      [RELIABILITY_CHECK_IDS.timeoutHandling, 'Timeout handling'],
      [RELIABILITY_CHECK_IDS.retryBehavior, 'Retry behavior'],
      [RELIABILITY_CHECK_IDS.errorHandling, 'Error handling'],
    ] as const) {
      results.push(
        makeResult({
          id,
          testType: 'reliability',
          category: RELIABILITY_CATEGORY,
          name,
          status: 'REQUIRES_CONFIGURATION',
          error: { message: missingUrlMessage },
          metadata: { reason: missingUrlMessage, timeoutMs },
        })
      );
    }
  } else {
    // Shared GET for service-health, timeout-handling, and error-handling.
    const shared = await probeGet(fetchImpl, healthUrl, timeoutMs, options?.signal);

    if (shared.kind === 'response' && isSuccessStatus(shared.status)) {
      results.push(
        makeResult({
          id: RELIABILITY_CHECK_IDS.serviceHealth,
          testType: 'reliability',
          category: RELIABILITY_CATEGORY,
          name: 'Service health',
          status: 'PASS',
          durationMs: shared.durationMs,
          target: healthUrl,
          assertion: { expected: '2xx/3xx', actual: shared.status },
          metadata: { timeoutMs },
        })
      );
    } else if (shared.kind === 'response') {
      results.push(
        makeResult({
          id: RELIABILITY_CHECK_IDS.serviceHealth,
          testType: 'reliability',
          category: RELIABILITY_CATEGORY,
          name: 'Service health',
          status: 'FAIL',
          durationMs: shared.durationMs,
          target: healthUrl,
          assertion: { expected: '2xx/3xx', actual: shared.status },
          error: { message: `HTTP ${shared.status}` },
          metadata: { timeoutMs },
        })
      );
    } else {
      results.push(
        makeResult({
          id: RELIABILITY_CHECK_IDS.serviceHealth,
          testType: 'reliability',
          category: RELIABILITY_CATEGORY,
          name: 'Service health',
          status: 'FAIL',
          durationMs: shared.durationMs,
          target: healthUrl,
          error: { message: shared.error },
          metadata: { timeoutMs, timedOut: shared.timedOut },
        })
      );
    }

    if (shared.timedOut) {
      results.push(
        makeResult({
          id: RELIABILITY_CHECK_IDS.timeoutHandling,
          testType: 'reliability',
          category: RELIABILITY_CATEGORY,
          name: 'Timeout handling',
          status: 'FAIL',
          durationMs: shared.durationMs,
          target: healthUrl,
          error: { message: 'timed out' },
          metadata: { timeoutMs, timedOut: true },
        })
      );
    } else {
      results.push(
        makeResult({
          id: RELIABILITY_CHECK_IDS.timeoutHandling,
          testType: 'reliability',
          category: RELIABILITY_CATEGORY,
          name: 'Timeout handling',
          status: 'PASS',
          durationMs: shared.durationMs,
          target: healthUrl,
          assertion: { expected: 'settled before timeout', actual: 'settled' },
          metadata: { timeoutMs, timedOut: false },
        })
      );
    }

    // Retry: at most 2 GET attempts; final failure stays FAIL.
    let attempts = 0;
    let last: ProbeOutcome | undefined;
    for (let i = 0; i < 2; i += 1) {
      attempts += 1;
      last = await probeGet(fetchImpl, healthUrl, timeoutMs, options?.signal);
      if (last.kind === 'response' && isSuccessStatus(last.status)) break;
    }
    if (last && last.kind === 'response' && isSuccessStatus(last.status)) {
      results.push(
        makeResult({
          id: RELIABILITY_CHECK_IDS.retryBehavior,
          testType: 'reliability',
          category: RELIABILITY_CATEGORY,
          name: 'Retry behavior',
          status: 'PASS',
          durationMs: last.durationMs,
          target: healthUrl,
          assertion: { expected: '2xx/3xx', actual: last.status },
          metadata: { attempts, timeoutMs },
        })
      );
    } else if (last && last.kind === 'response') {
      results.push(
        makeResult({
          id: RELIABILITY_CHECK_IDS.retryBehavior,
          testType: 'reliability',
          category: RELIABILITY_CATEGORY,
          name: 'Retry behavior',
          status: 'FAIL',
          durationMs: last.durationMs,
          target: healthUrl,
          assertion: { expected: '2xx/3xx', actual: last.status },
          error: { message: `HTTP ${last.status}` },
          metadata: { attempts, timeoutMs },
        })
      );
    } else {
      results.push(
        makeResult({
          id: RELIABILITY_CHECK_IDS.retryBehavior,
          testType: 'reliability',
          category: RELIABILITY_CATEGORY,
          name: 'Retry behavior',
          status: 'FAIL',
          durationMs: last?.durationMs,
          target: healthUrl,
          error: { message: last?.error ?? 'request failed' },
          metadata: { attempts, timeoutMs },
        })
      );
    }

    if (shared.thrown) {
      results.push(
        makeResult({
          id: RELIABILITY_CHECK_IDS.errorHandling,
          testType: 'reliability',
          category: RELIABILITY_CATEGORY,
          name: 'Error handling',
          status: 'FAIL',
          durationMs: shared.durationMs,
          target: healthUrl,
          error: {
            message: shared.kind === 'error' ? shared.error : 'request failed',
          },
          metadata: { timeoutMs, thrown: true },
        })
      );
    } else {
      results.push(
        makeResult({
          id: RELIABILITY_CHECK_IDS.errorHandling,
          testType: 'reliability',
          category: RELIABILITY_CATEGORY,
          name: 'Error handling',
          status: 'PASS',
          durationMs: shared.durationMs,
          target: healthUrl,
          assertion: { expected: 'no throw', actual: 'settled' },
          metadata: { timeoutMs, thrown: false },
        })
      );
    }
  }

  const authorized = destructiveAuthorized(argv, env);
  results.push(
    ...destructiveKindResults({
      testType: 'reliability',
      category: RELIABILITY_CATEGORY,
      authorized,
    })
  );

  if (writeSummary) writeReliabilitySummary(results);
  return results;
}

export function writeReliabilitySummary(results: TestResult[]): string {
  const summary = buildEngineSummary({
    engine: 'reliability',
    testType: 'reliability',
    results,
    note: 'Safe GET-only reliability probes. Destructive kinds are catalogued, never injected.',
    limitations: [
      'Fault injection, chaos, process kill, service restart, and raw sockets are not implemented.',
    ],
  });
  const out = path.join(PATHS.reports.reliability, 'summary.json');
  writeJson(out, summary);
  return out;
}

async function main(): Promise<void> {
  logStep('Reliability engine (GET probes only — no fault injection)');
  const results = await runReliability();
  const summary = buildEngineSummary({
    engine: 'reliability',
    testType: 'reliability',
    results,
  });
  for (const row of results) {
    console.log(`${row.status}\t${row.name}\t${row.error?.message ?? row.target ?? ''}`);
  }
  if (summary.failCount > 0) {
    logError(`${summary.failCount} reliability FAIL(s) — see reports/reliability/`);
    process.exit(1);
  }
  if (summary.requiresConfigurationCount > 0) {
    logWarn('Reliability REQUIRES_CONFIGURATION — see reports/reliability/');
    return;
  }
  if (summary.blockedCount > 0 && summary.passCount === 0) {
    logWarn('Reliability BLOCKED / NOT_TESTED — see reports/reliability/');
    return;
  }
  if (summary.notTestedCount > 0 && summary.passCount === 0) {
    logWarn('Reliability NOT_TESTED — engine disabled or destructive catalog only');
    return;
  }
  logSuccess('Reliability engine completed');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
