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
import type { ResilienceTestsConfig } from '../types';
import {
  destructiveAuthorized,
  destructiveKindResults,
} from './resilience-auth';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const RESILIENCE_CATEGORY = getTestType('resilience')?.category ?? 'resilience';

export const RESILIENCE_CHECK_IDS = {
  dependencyUnavailable: 'resilience:dependency-unavailable',
  recovery: 'resilience:recovery',
  serviceHealth: 'resilience:service-health',
} as const;

export type FetchLike = (
  input: string,
  init?: { method?: string; signal?: AbortSignal }
) => Promise<{ status: number; ok: boolean }>;

export interface RunResilienceOptions {
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

function resolveTimeoutMs(raw: number | undefined): number {
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
  | { kind: 'response'; status: number; durationMs: number }
  | { kind: 'error'; error: string; durationMs: number; timedOut: boolean };

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
    return { kind: 'response', status: response.status, durationMs: Date.now() - started };
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
    };
  }
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

/** Network / 5xx count as dependency unavailable (observed failure). */
function isDependencyFailure(outcome: ProbeOutcome): boolean {
  if (outcome.kind === 'error') return true;
  return outcome.status >= 500;
}

function loadResilienceConfig(): ResilienceTestsConfig {
  const loaded = loadConfig();
  const resilience = loaded.tests?.resilience;
  return {
    enabled: resilience?.enabled ?? false,
    dependencyUrl: resilience?.dependencyUrl,
    dependencyUrlEnv: resilience?.dependencyUrlEnv,
    healthUrl: resilience?.healthUrl,
    healthUrlEnv: resilience?.healthUrlEnv,
    timeoutMs: resilience?.timeoutMs,
  };
}

/**
 * Safe GET-only resilience probes. Never takes dependencies down or injects faults.
 * Disabled → one NOT_TESTED (no destructive rows).
 * Enabled → three safe rows plus destructive catalog rows.
 */
export async function runResilience(
  config: ResilienceTestsConfig = loadResilienceConfig(),
  env: NodeJS.ProcessEnv = process.env,
  options?: RunResilienceOptions
): Promise<TestResult[]> {
  const fetchImpl = options?.fetchImpl ?? (globalThis.fetch as FetchLike);
  const writeSummary = options?.writeSummary !== false;
  const argv = options?.argv ?? process.argv.slice(2);
  const results: TestResult[] = [];

  if (!config.enabled) {
    results.push(
      makeResult({
        id: 'resilience:disabled',
        testType: 'resilience',
        category: RESILIENCE_CATEGORY,
        name: 'Resilience engine',
        status: 'NOT_TESTED',
        error: { message: 'resilience engine disabled' },
        metadata: { reason: 'resilience engine disabled' },
      })
    );
    if (writeSummary) writeResilienceSummary(results);
    return results;
  }

  const timeoutMs = resolveTimeoutMs(config.timeoutMs);
  const dependencyUrl = resolveOptionalUrl(
    config.dependencyUrl,
    config.dependencyUrlEnv,
    env
  );
  const healthUrl = resolveOptionalUrl(config.healthUrl, config.healthUrlEnv, env);

  // 1. dependency-unavailable — observe only; never take the dependency down.
  if (!dependencyUrl) {
    results.push(
      makeResult({
        id: RESILIENCE_CHECK_IDS.dependencyUnavailable,
        testType: 'resilience',
        category: RESILIENCE_CATEGORY,
        name: 'Dependency unavailable',
        status: 'REQUIRES_CONFIGURATION',
        error: {
          message:
            'no dependency URL configured (set tests.resilience.dependencyUrl or dependencyUrlEnv)',
        },
        metadata: {
          reason:
            'no dependency URL configured (set tests.resilience.dependencyUrl or dependencyUrlEnv)',
        },
      })
    );
  } else {
    const outcome = await probeGet(fetchImpl, dependencyUrl, timeoutMs, options?.signal);
    if (isDependencyFailure(outcome)) {
      const message =
        outcome.kind === 'error'
          ? outcome.error
          : `HTTP ${outcome.status}`;
      results.push(
        makeResult({
          id: RESILIENCE_CHECK_IDS.dependencyUnavailable,
          testType: 'resilience',
          category: RESILIENCE_CATEGORY,
          name: 'Dependency unavailable',
          status: 'FAIL',
          durationMs: outcome.durationMs,
          target: dependencyUrl,
          error: { message },
          metadata: { timeoutMs, observedUnavailable: true },
        })
      );
    } else if (outcome.kind === 'response' && isSuccessStatus(outcome.status)) {
      results.push(
        makeResult({
          id: RESILIENCE_CHECK_IDS.dependencyUnavailable,
          testType: 'resilience',
          category: RESILIENCE_CATEGORY,
          name: 'Dependency unavailable',
          status: 'PASS',
          durationMs: outcome.durationMs,
          target: dependencyUrl,
          assertion: {
            expected: 'dependency unavailable observed',
            actual: 'dependency responded; unavailable behavior was not observed',
          },
          metadata: {
            timeoutMs,
            message: 'dependency responded; unavailable behavior was not observed',
          },
        })
      );
    } else {
      // 4xx — not treated as "unavailable" observation; still FAIL as unexpected for this probe.
      const status = outcome.kind === 'response' ? outcome.status : 0;
      results.push(
        makeResult({
          id: RESILIENCE_CHECK_IDS.dependencyUnavailable,
          testType: 'resilience',
          category: RESILIENCE_CATEGORY,
          name: 'Dependency unavailable',
          status: 'FAIL',
          durationMs: outcome.durationMs,
          target: dependencyUrl,
          assertion: { expected: '2xx/3xx or network/5xx', actual: status },
          error: { message: `HTTP ${status}` },
          metadata: { timeoutMs },
        })
      );
    }
  }

  // 2. recovery — two GETs; do not inject the first failure.
  if (!dependencyUrl) {
    results.push(
      makeResult({
        id: RESILIENCE_CHECK_IDS.recovery,
        testType: 'resilience',
        category: RESILIENCE_CATEGORY,
        name: 'Recovery',
        status: 'REQUIRES_CONFIGURATION',
        error: {
          message:
            'no dependency URL configured (set tests.resilience.dependencyUrl or dependencyUrlEnv)',
        },
        metadata: {
          reason:
            'no dependency URL configured (set tests.resilience.dependencyUrl or dependencyUrlEnv)',
        },
      })
    );
  } else {
    const first = await probeGet(fetchImpl, dependencyUrl, timeoutMs, options?.signal);
    const second = await probeGet(fetchImpl, dependencyUrl, timeoutMs, options?.signal);
    const firstOk = first.kind === 'response' && isSuccessStatus(first.status);
    const secondOk = second.kind === 'response' && isSuccessStatus(second.status);
    const durationMs = (first.durationMs ?? 0) + (second.durationMs ?? 0);

    if (firstOk && secondOk) {
      results.push(
        makeResult({
          id: RESILIENCE_CHECK_IDS.recovery,
          testType: 'resilience',
          category: RESILIENCE_CATEGORY,
          name: 'Recovery',
          status: 'PASS',
          durationMs,
          target: dependencyUrl,
          metadata: { recovered: false, bothSucceeded: true, timeoutMs },
        })
      );
    } else if (!firstOk && secondOk) {
      results.push(
        makeResult({
          id: RESILIENCE_CHECK_IDS.recovery,
          testType: 'resilience',
          category: RESILIENCE_CATEGORY,
          name: 'Recovery',
          status: 'PASS',
          durationMs,
          target: dependencyUrl,
          metadata: { recovered: true, timeoutMs },
        })
      );
    } else {
      const detail =
        second.kind === 'error'
          ? second.error
          : second.kind === 'response'
            ? `HTTP ${second.status}`
            : 'both attempts failed';
      results.push(
        makeResult({
          id: RESILIENCE_CHECK_IDS.recovery,
          testType: 'resilience',
          category: RESILIENCE_CATEGORY,
          name: 'Recovery',
          status: 'FAIL',
          durationMs,
          target: dependencyUrl,
          error: { message: detail },
          metadata: {
            recovered: false,
            firstOk,
            secondOk,
            timeoutMs,
          },
        })
      );
    }
  }

  // 3. service-health — GET healthUrl only; never borrow a demo host.
  if (!healthUrl) {
    results.push(
      makeResult({
        id: RESILIENCE_CHECK_IDS.serviceHealth,
        testType: 'resilience',
        category: RESILIENCE_CATEGORY,
        name: 'Service health',
        status: 'REQUIRES_CONFIGURATION',
        error: {
          message:
            'no health URL configured (set tests.resilience.healthUrl or healthUrlEnv)',
        },
        metadata: {
          reason:
            'no health URL configured (set tests.resilience.healthUrl or healthUrlEnv)',
        },
      })
    );
  } else {
    const outcome = await probeGet(fetchImpl, healthUrl, timeoutMs, options?.signal);
    if (outcome.kind === 'response' && isSuccessStatus(outcome.status)) {
      results.push(
        makeResult({
          id: RESILIENCE_CHECK_IDS.serviceHealth,
          testType: 'resilience',
          category: RESILIENCE_CATEGORY,
          name: 'Service health',
          status: 'PASS',
          durationMs: outcome.durationMs,
          target: healthUrl,
          assertion: { expected: '2xx/3xx', actual: outcome.status },
          metadata: { timeoutMs },
        })
      );
    } else if (outcome.kind === 'response') {
      results.push(
        makeResult({
          id: RESILIENCE_CHECK_IDS.serviceHealth,
          testType: 'resilience',
          category: RESILIENCE_CATEGORY,
          name: 'Service health',
          status: 'FAIL',
          durationMs: outcome.durationMs,
          target: healthUrl,
          assertion: { expected: '2xx/3xx', actual: outcome.status },
          error: { message: `HTTP ${outcome.status}` },
          metadata: { timeoutMs },
        })
      );
    } else {
      results.push(
        makeResult({
          id: RESILIENCE_CHECK_IDS.serviceHealth,
          testType: 'resilience',
          category: RESILIENCE_CATEGORY,
          name: 'Service health',
          status: 'FAIL',
          durationMs: outcome.durationMs,
          target: healthUrl,
          error: { message: outcome.error },
          metadata: { timeoutMs, timedOut: outcome.timedOut },
        })
      );
    }
  }

  const authorized = destructiveAuthorized(argv, env);
  results.push(
    ...destructiveKindResults({
      testType: 'resilience',
      category: RESILIENCE_CATEGORY,
      authorized,
    })
  );

  if (writeSummary) writeResilienceSummary(results);
  return results;
}

export function writeResilienceSummary(results: TestResult[]): string {
  const summary = buildEngineSummary({
    engine: 'resilience',
    testType: 'resilience',
    results,
    note: 'Safe GET-only resilience probes. Destructive kinds are catalogued, never injected.',
    limitations: [
      'Fault injection, chaos, process kill, service restart, and raw sockets are not implemented.',
      'dependency-unavailable observes live GET failure only — it never takes a dependency down.',
    ],
  });
  const out = path.join(PATHS.reports.resilience, 'summary.json');
  writeJson(out, summary);
  return out;
}

async function main(): Promise<void> {
  logStep('Resilience engine (GET probes only — no fault injection)');
  const results = await runResilience();
  const summary = buildEngineSummary({
    engine: 'resilience',
    testType: 'resilience',
    results,
  });
  for (const row of results) {
    console.log(`${row.status}\t${row.name}\t${row.error?.message ?? row.target ?? ''}`);
  }
  if (summary.failCount > 0) {
    logError(`${summary.failCount} resilience FAIL(s) — see reports/resilience/`);
    process.exit(1);
  }
  if (summary.requiresConfigurationCount > 0) {
    logWarn('Resilience REQUIRES_CONFIGURATION — see reports/resilience/');
    return;
  }
  if (summary.blockedCount > 0 && summary.passCount === 0) {
    logWarn('Resilience BLOCKED / NOT_TESTED — see reports/resilience/');
    return;
  }
  if (summary.notTestedCount > 0 && summary.passCount === 0) {
    logWarn('Resilience NOT_TESTED — engine disabled or destructive catalog only');
    return;
  }
  logSuccess('Resilience engine completed');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
