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
import type { DeploymentTestsConfig } from '../types';

const DEPLOYMENT_TIMEOUT_MS = 10_000;
const DEPLOYMENT_CATEGORY = getTestType('deployment')?.category ?? 'release';

const AUTH_BLOCKED_MESSAGE =
  'destructive deployment action requires --authorize-deployment or QA_DEPLOY_AUTHORIZE';
const AUTH_NOT_IMPLEMENTED_MESSAGE = 'migration/rollback execution is not implemented';
const NO_REQUIRED_ENV_MESSAGE = 'no required env names configured';

export const DEPLOYMENT_CHECK_IDS = {
  health: 'deployment:health',
  readiness: 'deployment:readiness',
  configuration: 'deployment:configuration',
  environment: 'deployment:environment',
  verification: 'deployment:verification',
  migration: 'deployment:migration',
  rollback: 'deployment:rollback',
} as const;

export type FetchLike = (
  input: string,
  init?: { method?: string; signal?: AbortSignal }
) => Promise<{ status: number; ok: boolean }>;

export interface RunDeploymentOptions {
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  writeSummary?: boolean;
  /** CLI argv used for `--authorize-deployment`. Defaults to process.argv. */
  argv?: string[];
}

/**
 * True only when argv contains `--authorize-deployment` OR env
 * `QA_DEPLOY_AUTHORIZE` is the string `true`. Does not reuse QA_RESILIENCE_AUTHORIZE.
 * Authorization does not implement or run migration/rollback.
 */
export function deploymentAuthorized(
  argv: string[] = [],
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (argv.includes('--authorize-deployment')) return true;
  return env.QA_DEPLOY_AUTHORIZE === 'true';
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

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

type ProbeOutcome =
  | { kind: 'response'; status: number; durationMs: number }
  | { kind: 'error'; error: string; durationMs: number };

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
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: 'error',
      error: message,
      durationMs: Date.now() - started,
    };
  }
}

async function urlCheckResult(input: {
  id: string;
  name: string;
  target: string | undefined;
  missingMessage: string;
  fetchImpl: FetchLike;
  signal?: AbortSignal;
}): Promise<TestResult> {
  if (!input.target) {
    return makeResult({
      id: input.id,
      testType: 'deployment',
      category: DEPLOYMENT_CATEGORY,
      name: input.name,
      status: 'REQUIRES_CONFIGURATION',
      error: { message: input.missingMessage },
      metadata: { reason: input.missingMessage },
    });
  }

  const outcome = await probeGet(
    input.fetchImpl,
    input.target,
    DEPLOYMENT_TIMEOUT_MS,
    input.signal
  );

  if (outcome.kind === 'response' && isSuccessStatus(outcome.status)) {
    return makeResult({
      id: input.id,
      testType: 'deployment',
      category: DEPLOYMENT_CATEGORY,
      name: input.name,
      status: 'PASS',
      durationMs: outcome.durationMs,
      target: input.target,
      assertion: { expected: '2xx/3xx', actual: outcome.status },
      metadata: { timeoutMs: DEPLOYMENT_TIMEOUT_MS },
    });
  }

  if (outcome.kind === 'response') {
    return makeResult({
      id: input.id,
      testType: 'deployment',
      category: DEPLOYMENT_CATEGORY,
      name: input.name,
      status: 'FAIL',
      durationMs: outcome.durationMs,
      target: input.target,
      assertion: { expected: '2xx/3xx', actual: outcome.status },
      error: { message: `HTTP ${outcome.status}` },
      metadata: { timeoutMs: DEPLOYMENT_TIMEOUT_MS },
    });
  }

  return makeResult({
    id: input.id,
    testType: 'deployment',
    category: DEPLOYMENT_CATEGORY,
    name: input.name,
    status: 'FAIL',
    durationMs: outcome.durationMs,
    target: input.target,
    error: { message: outcome.error },
    metadata: { timeoutMs: DEPLOYMENT_TIMEOUT_MS },
  });
}

/** Names only — never reads or returns env values. */
function missingRequiredEnvNames(
  requiredEnv: string[] | undefined,
  env: NodeJS.ProcessEnv
): { configured: boolean; missing: string[] } {
  if (!requiredEnv || requiredEnv.length === 0) {
    return { configured: false, missing: [] };
  }
  const missing: string[] = [];
  for (const name of requiredEnv) {
    const key = name?.trim();
    if (!key) continue;
    const value = env[key];
    if (value === undefined || String(value).trim() === '') {
      missing.push(key);
    }
  }
  return { configured: true, missing };
}

function requiredEnvResult(
  id: string,
  name: string,
  requiredEnv: string[] | undefined,
  env: NodeJS.ProcessEnv
): TestResult {
  const { configured, missing } = missingRequiredEnvNames(requiredEnv, env);
  if (!configured) {
    return makeResult({
      id,
      testType: 'deployment',
      category: DEPLOYMENT_CATEGORY,
      name,
      status: 'REQUIRES_CONFIGURATION',
      error: { message: NO_REQUIRED_ENV_MESSAGE },
      metadata: { reason: NO_REQUIRED_ENV_MESSAGE },
    });
  }
  if (missing.length > 0) {
    const message = `missing or blank required env: ${missing.join(', ')}`;
    return makeResult({
      id,
      testType: 'deployment',
      category: DEPLOYMENT_CATEGORY,
      name,
      status: 'FAIL',
      error: { message },
      assertion: { expected: 'all requiredEnv names set', actual: missing },
      metadata: { missingNames: missing },
    });
  }
  return makeResult({
    id,
    testType: 'deployment',
    category: DEPLOYMENT_CATEGORY,
    name,
    status: 'PASS',
    assertion: { expected: 'all requiredEnv names set', actual: 'all set' },
    metadata: { requiredEnvCount: requiredEnv!.length },
  });
}

function destructiveCatalogResult(id: string, name: string, authorized: boolean): TestResult {
  const message = authorized ? AUTH_NOT_IMPLEMENTED_MESSAGE : AUTH_BLOCKED_MESSAGE;
  return makeResult({
    id,
    testType: 'deployment',
    category: DEPLOYMENT_CATEGORY,
    name,
    status: authorized ? 'NOT_TESTED' : 'BLOCKED',
    error: { message },
    metadata: {
      destructive: true,
      authorized,
      reason: message,
    },
  });
}

function loadDeploymentConfig(): DeploymentTestsConfig {
  const loaded = loadConfig();
  const deployment = loaded.tests?.deployment;
  return {
    enabled: deployment?.enabled ?? false,
    healthUrl: deployment?.healthUrl,
    healthUrlEnv: deployment?.healthUrlEnv,
    readinessUrl: deployment?.readinessUrl,
    readinessUrlEnv: deployment?.readinessUrlEnv,
    versionUrl: deployment?.versionUrl,
    versionUrlEnv: deployment?.versionUrlEnv,
    requiredEnv: deployment?.requiredEnv,
  };
}

/**
 * Safe GET-only deployment probes + requiredEnv name checks.
 * Never deploys, migrates, or rolls back. Never prints secret values.
 * Disabled → one NOT_TESTED. Enabled → always emits seven check ids.
 */
export async function runDeployment(
  config: DeploymentTestsConfig = loadDeploymentConfig(),
  env: NodeJS.ProcessEnv = process.env,
  options?: RunDeploymentOptions
): Promise<TestResult[]> {
  const fetchImpl = options?.fetchImpl ?? (globalThis.fetch as FetchLike);
  const writeSummary = options?.writeSummary !== false;
  const argv = options?.argv ?? process.argv.slice(2);
  const results: TestResult[] = [];

  if (!config.enabled) {
    results.push(
      makeResult({
        id: 'deployment:disabled',
        testType: 'deployment',
        category: DEPLOYMENT_CATEGORY,
        name: 'Deployment engine',
        status: 'NOT_TESTED',
        error: { message: 'deployment engine disabled' },
        metadata: { reason: 'deployment engine disabled' },
      })
    );
    if (writeSummary) writeDeploymentSummary(results);
    return results;
  }

  const healthUrl = resolveOptionalUrl(config.healthUrl, config.healthUrlEnv, env);
  const readinessUrl = resolveOptionalUrl(config.readinessUrl, config.readinessUrlEnv, env);
  const versionUrl = resolveOptionalUrl(config.versionUrl, config.versionUrlEnv, env);
  const verificationUrl = versionUrl ?? healthUrl;

  results.push(
    await urlCheckResult({
      id: DEPLOYMENT_CHECK_IDS.health,
      name: 'Deployment health',
      target: healthUrl,
      missingMessage:
        'no health URL configured (set tests.deployment.healthUrl or healthUrlEnv)',
      fetchImpl,
      signal: options?.signal,
    })
  );

  results.push(
    await urlCheckResult({
      id: DEPLOYMENT_CHECK_IDS.readiness,
      name: 'Deployment readiness',
      target: readinessUrl,
      missingMessage:
        'no readiness URL configured (set tests.deployment.readinessUrl or readinessUrlEnv)',
      fetchImpl,
      signal: options?.signal,
    })
  );

  results.push(
    requiredEnvResult(
      DEPLOYMENT_CHECK_IDS.configuration,
      'Deployment configuration',
      config.requiredEnv,
      env
    )
  );

  results.push(
    requiredEnvResult(
      DEPLOYMENT_CHECK_IDS.environment,
      'Deployment environment',
      config.requiredEnv,
      env
    )
  );

  results.push(
    await urlCheckResult({
      id: DEPLOYMENT_CHECK_IDS.verification,
      name: 'Deployment verification',
      target: verificationUrl,
      missingMessage:
        'no verification URL configured (set tests.deployment.versionUrl, versionUrlEnv, healthUrl, or healthUrlEnv)',
      fetchImpl,
      signal: options?.signal,
    })
  );

  const authorized = deploymentAuthorized(argv, env);
  results.push(
    destructiveCatalogResult(DEPLOYMENT_CHECK_IDS.migration, 'Deployment migration', authorized)
  );
  results.push(
    destructiveCatalogResult(DEPLOYMENT_CHECK_IDS.rollback, 'Deployment rollback', authorized)
  );

  if (writeSummary) writeDeploymentSummary(results);
  return results;
}

export function writeDeploymentSummary(results: TestResult[]): string {
  const summary = buildEngineSummary({
    engine: 'deployment',
    testType: 'deployment',
    results,
    note: 'Safe GET-only deployment probes. Migration and rollback are catalogued, never executed.',
    limitations: [
      'Deploy, migrate, and rollback commands are not implemented and are never run.',
    ],
  });
  const out = path.join(PATHS.reports.deployment, 'summary.json');
  writeJson(out, summary);
  return out;
}

async function main(): Promise<void> {
  logStep('Deployment engine (GET probes only — no deploy / migrate / rollback)');
  const results = await runDeployment();
  const summary = buildEngineSummary({
    engine: 'deployment',
    testType: 'deployment',
    results,
  });
  for (const row of results) {
    console.log(`${row.status}\t${row.name}\t${row.error?.message ?? row.target ?? ''}`);
  }
  if (summary.failCount > 0) {
    logError(`${summary.failCount} deployment FAIL(s) — see reports/deployment/`);
    process.exit(1);
  }
  if (summary.requiresConfigurationCount > 0) {
    logWarn('Deployment REQUIRES_CONFIGURATION — see reports/deployment/');
    return;
  }
  if (summary.blockedCount > 0 && summary.passCount === 0) {
    logWarn('Deployment BLOCKED / NOT_TESTED — see reports/deployment/');
    return;
  }
  if (summary.notTestedCount > 0 && summary.passCount === 0) {
    logWarn('Deployment NOT_TESTED — engine disabled or destructive catalog only');
    return;
  }
  logSuccess('Deployment engine completed');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
