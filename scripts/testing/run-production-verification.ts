import path from 'path';
import { PATHS } from '../lib/paths';
import { loadConfig } from '../lib/load-config';
import { writeJson } from '../discovery/write-json';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { readLastTargetUrl } from '../lib/last-target';
import {
  parseOrchestratorCli,
  resolveApiUrl,
  resolveWebsiteTarget,
} from '../orchestrator/resolve-url';
import {
  buildEngineSummary,
  makeResult,
  type TestResult,
} from '../core/engine-contract';
import type { ProductionVerificationConfig } from '../types';

const PROBE_TIMEOUT_MS = 10_000;

/** Engine label for summaries — not a TestTypeId registry entry. */
const ENGINE_ID = 'production-verification';
const ENGINE_CATEGORY = 'functional';

export const PRODUCTION_VERIFICATION_DISCLAIMER =
  'Production verification does not authorize heavy, security, or destructive testing.';

export const PRODUCTION_CHECK_IDS = {
  health: 'production:health',
  smoke: 'production:smoke',
  criticalApi: 'production:critical-api',
  criticalUi: 'production:critical-ui',
  criticalWorkflow: 'production:critical-workflow',
} as const;

const DISALLOWED_KINDS = new Set([
  'heavy',
  'security',
  'destructive',
  'load',
  'stress',
  'spike',
  'soak',
  'chaos',
  'fault-injection',
]);

/**
 * Production verification never authorizes heavy / security / destructive work.
 * Unknown kinds that are not in the deny list are not interpreted as permission
 * to run those suites from this script.
 */
export function productionVerificationAllows(kind: string): boolean {
  const normalized = kind.trim().toLowerCase();
  if (!normalized) return false;
  return !DISALLOWED_KINDS.has(normalized);
}

/** Alias of {@link productionVerificationAllows} for call-site clarity. */
export function assertProductionSafeProfile(kind: string): boolean {
  return productionVerificationAllows(kind);
}

export type FetchLike = (
  input: string,
  init?: { method?: string; signal?: AbortSignal }
) => Promise<{ status: number; ok: boolean }>;

/** Production-verification config plus URL bases — never invent hosts. */
export interface ProductionVerificationRunConfig extends ProductionVerificationConfig {
  websiteUrl?: string;
  apiUrl?: string;
  playwrightBaseUrl?: string;
}

export interface RunProductionVerificationOptions {
  fetchImpl?: FetchLike;
  writeSummary?: boolean;
  /** When set (including null), skips reading qa.last-target.json. */
  lastTargetUrl?: string | null;
  /** CLI argv for `--url=`. Defaults to process.argv.slice(2). */
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

function websiteOrigin(websiteUrl: string): string {
  try {
    return new URL(websiteUrl).origin;
  } catch {
    return '';
  }
}

async function getWithTimeout(
  fetchImpl: FetchLike,
  target: string
): Promise<{ status: number } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(target, { method: 'GET', signal: controller.signal });
    return { status: response.status };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  } finally {
    clearTimeout(timer);
  }
}

function disabledResult(id: string, name: string): TestResult {
  return makeResult({
    id,
    testType: ENGINE_ID,
    category: ENGINE_CATEGORY,
    name,
    status: 'NOT_TESTED',
    error: { message: 'production verification is disabled' },
    metadata: { reason: 'production verification is disabled' },
  });
}

function checkNotAllowedResult(id: string, name: string, checkKey: string): TestResult {
  const message = `production ${checkKey} check is not enabled`;
  return makeResult({
    id,
    testType: ENGINE_ID,
    category: ENGINE_CATEGORY,
    name,
    status: 'NOT_TESTED',
    error: { message },
    metadata: { reason: message },
  });
}

function missingUrlResult(id: string, name: string, message: string): TestResult {
  return makeResult({
    id,
    testType: ENGINE_ID,
    category: ENGINE_CATEGORY,
    name,
    status: 'REQUIRES_CONFIGURATION',
    error: { message },
    metadata: { reason: message },
  });
}

/** Shared 2xx/3xx GET classification (mirrors smoke homepage; not an import of runSmoke). */
async function classifySafeGet(input: {
  id: string;
  name: string;
  target: string;
  fetchImpl: FetchLike;
}): Promise<TestResult> {
  const started = Date.now();
  const outcome = await getWithTimeout(input.fetchImpl, input.target);
  const durationMs = Date.now() - started;
  if ('error' in outcome) {
    return makeResult({
      id: input.id,
      testType: ENGINE_ID,
      category: ENGINE_CATEGORY,
      name: input.name,
      status: 'FAIL',
      durationMs,
      target: input.target,
      error: { message: `connection error: ${outcome.error}` },
    });
  }
  if (outcome.status >= 200 && outcome.status < 400) {
    return makeResult({
      id: input.id,
      testType: ENGINE_ID,
      category: ENGINE_CATEGORY,
      name: input.name,
      status: 'PASS',
      durationMs,
      target: input.target,
      assertion: { expected: '2xx/3xx', actual: outcome.status },
    });
  }
  return makeResult({
    id: input.id,
    testType: ENGINE_ID,
    category: ENGINE_CATEGORY,
    name: input.name,
    status: 'FAIL',
    durationMs,
    target: input.target,
    assertion: { expected: '2xx/3xx', actual: outcome.status },
    error: { message: `HTTP ${outcome.status}` },
  });
}

/**
 * Critical API expects 2xx like smoke:critical-api; 4xx/5xx and network errors are FAIL.
 */
async function classifyCriticalApiGet(input: {
  id: string;
  name: string;
  target: string;
  fetchImpl: FetchLike;
}): Promise<TestResult> {
  const started = Date.now();
  const outcome = await getWithTimeout(input.fetchImpl, input.target);
  const durationMs = Date.now() - started;
  if ('error' in outcome) {
    return makeResult({
      id: input.id,
      testType: ENGINE_ID,
      category: ENGINE_CATEGORY,
      name: input.name,
      status: 'FAIL',
      durationMs,
      target: input.target,
      error: { message: `connection error: ${outcome.error}` },
    });
  }
  if (outcome.status >= 200 && outcome.status < 300) {
    return makeResult({
      id: input.id,
      testType: ENGINE_ID,
      category: ENGINE_CATEGORY,
      name: input.name,
      status: 'PASS',
      durationMs,
      target: input.target,
      assertion: { expected: '2xx', actual: outcome.status },
    });
  }
  return makeResult({
    id: input.id,
    testType: ENGINE_ID,
    category: ENGINE_CATEGORY,
    name: input.name,
    status: 'FAIL',
    durationMs,
    target: input.target,
    assertion: { expected: '2xx', actual: outcome.status },
    error: { message: `HTTP ${outcome.status}` },
  });
}

function loadProductionVerificationRunConfig(): ProductionVerificationRunConfig {
  const loaded = loadConfig();
  const block = loaded.tests?.productionVerification;
  return {
    enabled: block?.enabled ?? false,
    health: block?.health ?? false,
    smoke: block?.smoke ?? false,
    criticalApi: block?.criticalApi ?? false,
    criticalUi: block?.criticalUi ?? false,
    criticalWorkflow: block?.criticalWorkflow ?? false,
    websiteUrl: loaded.urls?.website ?? '',
    apiUrl: loaded.urls?.api ?? '',
    playwrightBaseUrl: loaded.playwright?.baseURL,
  };
}

/**
 * Explicit production verification — GET-only health/smoke/critical-API probes.
 * Never runs JMeter, security, destructive resilience, deployment migrate/rollback, or AI attacks.
 * Does not start Playwright. Disabled → five NOT_TESTED rows. Unknown config keys are ignored.
 */
export async function runProductionVerification(
  config: ProductionVerificationRunConfig = loadProductionVerificationRunConfig(),
  env: NodeJS.ProcessEnv = process.env,
  options?: RunProductionVerificationOptions
): Promise<TestResult[]> {
  const fetchImpl = options?.fetchImpl ?? (globalThis.fetch as FetchLike);
  const writeSummary = options?.writeSummary !== false;
  const argv = options?.argv ?? process.argv.slice(2);
  const results: TestResult[] = [];

  if (!config.enabled) {
    results.push(
      disabledResult(PRODUCTION_CHECK_IDS.health, 'Production health'),
      disabledResult(PRODUCTION_CHECK_IDS.smoke, 'Production smoke'),
      disabledResult(PRODUCTION_CHECK_IDS.criticalApi, 'Production critical API'),
      disabledResult(PRODUCTION_CHECK_IDS.criticalUi, 'Production critical UI'),
      disabledResult(PRODUCTION_CHECK_IDS.criticalWorkflow, 'Production critical workflow')
    );
    if (writeSummary) writeProductionVerificationSummary(results);
    return results;
  }

  const { url: cliUrl } = parseOrchestratorCli(argv);
  const lastTarget =
    options?.lastTargetUrl !== undefined ? options.lastTargetUrl : readLastTargetUrl();
  const website = resolveWebsiteTarget({
    cliUrl,
    playwrightEnvUrl: env.QA_PLAYWRIGHT_BASE_URL,
    websiteEnvUrl: env.QA_WEBSITE_URL,
    lastTargetUrl: lastTarget,
    playwrightBaseUrl: config.playwrightBaseUrl,
    websiteUrl: config.websiteUrl ?? '',
  }).trim();
  const origin = website && isHttpUrl(website) ? websiteOrigin(website) : '';

  const apiBase = resolveApiUrl({
    envUrl: env.QA_API_URL,
    apiUrl: config.apiUrl,
  }).trim();

  // health
  {
    const id = PRODUCTION_CHECK_IDS.health;
    const name = 'Production health';
    if (!config.health) {
      results.push(checkNotAllowedResult(id, name, 'health'));
    } else if (!origin) {
      results.push(missingUrlResult(id, name, 'no website URL configured'));
    } else {
      results.push(await classifySafeGet({ id, name, target: origin, fetchImpl }));
    }
  }

  // smoke (homepage GET only — does not invoke the full smoke engine)
  {
    const id = PRODUCTION_CHECK_IDS.smoke;
    const name = 'Production smoke';
    if (!config.smoke) {
      results.push(checkNotAllowedResult(id, name, 'smoke'));
    } else if (!origin) {
      results.push(missingUrlResult(id, name, 'no website URL configured'));
    } else {
      results.push(await classifySafeGet({ id, name, target: origin, fetchImpl }));
    }
  }

  // critical API
  {
    const id = PRODUCTION_CHECK_IDS.criticalApi;
    const name = 'Production critical API';
    if (!config.criticalApi) {
      results.push(checkNotAllowedResult(id, name, 'criticalApi'));
    } else if (!apiBase || !isHttpUrl(apiBase)) {
      results.push(missingUrlResult(id, name, 'no API URL configured'));
    } else {
      results.push(
        await classifyCriticalApiGet({ id, name, target: apiBase, fetchImpl })
      );
    }
  }

  // critical UI — safe GET of resolved origin only; never starts Playwright
  {
    const id = PRODUCTION_CHECK_IDS.criticalUi;
    const name = 'Production critical UI';
    if (!config.criticalUi) {
      results.push(checkNotAllowedResult(id, name, 'criticalUi'));
    } else if (!origin) {
      results.push(missingUrlResult(id, name, 'no website URL configured'));
    } else {
      results.push(await classifySafeGet({ id, name, target: origin, fetchImpl }));
    }
  }

  // critical workflow — no Playwright suite from this verifier
  {
    const id = PRODUCTION_CHECK_IDS.criticalWorkflow;
    const name = 'Production critical workflow';
    if (!config.criticalWorkflow) {
      results.push(checkNotAllowedResult(id, name, 'criticalWorkflow'));
    } else if (!origin) {
      results.push(missingUrlResult(id, name, 'no website URL configured'));
    } else {
      const message = 'production UI/workflow execution is not run from this verifier';
      results.push(
        makeResult({
          id,
          testType: ENGINE_ID,
          category: ENGINE_CATEGORY,
          name,
          status: 'NOT_TESTED',
          target: origin,
          error: { message },
          metadata: { reason: message },
        })
      );
    }
  }

  if (writeSummary) writeProductionVerificationSummary(results);
  return results;
}

export function writeProductionVerificationSummary(results: TestResult[]): string {
  const summary = buildEngineSummary({
    engine: ENGINE_ID,
    testType: ENGINE_ID,
    results,
    note: PRODUCTION_VERIFICATION_DISCLAIMER,
    limitations: [
      PRODUCTION_VERIFICATION_DISCLAIMER,
      'Does not run JMeter, security, destructive resilience, deployment migrate/rollback, or AI attack checks.',
      'Does not start Playwright browser projects.',
    ],
  });
  const out = path.join(PATHS.reports.productionVerification, 'summary.json');
  writeJson(out, summary);
  return out;
}

async function main(): Promise<void> {
  logStep('Production verification (GET probes only)');
  console.log(PRODUCTION_VERIFICATION_DISCLAIMER);
  const results = await runProductionVerification();
  const summary = buildEngineSummary({
    engine: ENGINE_ID,
    testType: ENGINE_ID,
    results,
    note: PRODUCTION_VERIFICATION_DISCLAIMER,
  });
  for (const row of results) {
    console.log(`${row.status}\t${row.name}\t${row.error?.message ?? row.target ?? ''}`);
  }
  if (summary.failCount > 0) {
    logError(
      `${summary.failCount} production-verification FAIL(s) — see reports/production-verification/`
    );
    process.exit(1);
  }
  if (summary.requiresConfigurationCount > 0) {
    logWarn('Production verification REQUIRES_CONFIGURATION — see reports/production-verification/');
    return;
  }
  if (summary.notTestedCount > 0 && summary.passCount === 0) {
    logWarn('Production verification NOT_TESTED — disabled or checks not enabled');
    return;
  }
  logSuccess('Production verification completed');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
