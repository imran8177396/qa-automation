import path from 'path';
import { PATHS } from '../lib/paths';
import { loadConfig } from '../lib/load-config';
import { writeJson } from '../discovery/write-json';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { readLastTargetUrl } from '../lib/last-target';
import { resolveApiUrl, resolveWebsiteTarget } from '../orchestrator/resolve-url';
import {
  buildEngineSummary,
  makeResult,
  type TestResult,
} from '../core/engine-contract';
import type { SmokeDependencyConfig, SmokeTestsConfig } from '../types';

const SMOKE_TIMEOUT_MS = 10_000;

export const SMOKE_CHECK_IDS = {
  homepage: 'smoke:homepage',
  criticalApi: 'smoke:critical-api',
  authentication: 'smoke:authentication',
  criticalWorkflow: 'smoke:critical-workflow',
  criticalPage: 'smoke:critical-page',
  criticalDependency: 'smoke:critical-dependency',
} as const;

export type FetchLike = (
  input: string,
  init?: { method?: string; signal?: AbortSignal }
) => Promise<{ status: number; ok: boolean }>;

/** Smoke config plus URL bases needed to resolve targets without inventing hosts. */
export interface SmokeRunConfig extends SmokeTestsConfig {
  websiteUrl?: string;
  apiUrl?: string;
  jmeterPath?: string;
  playwrightBaseUrl?: string;
}

export interface RunSmokeOptions {
  fetchImpl?: FetchLike;
  writeSummary?: boolean;
  /** When set (including null), skips reading qa.last-target.json. */
  lastTargetUrl?: string | null;
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
  if (fromDirect) return fromDirect;
  const key = envName?.trim();
  if (key) {
    const fromEnv = env[key]?.trim();
    if (fromEnv) return fromEnv;
  }
  return undefined;
}

function websiteOrigin(websiteUrl: string): string {
  try {
    return new URL(websiteUrl).origin;
  } catch {
    return '';
  }
}

function joinOriginPath(origin: string, pagePath: string): string {
  const normalized = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
  return `${origin.replace(/\/+$/, '')}${normalized}`;
}

function joinApiPath(apiBase: string, apiPath: string): string {
  const base = apiBase.replace(/\/+$/, '');
  const suffix = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}${suffix}`;
}

function resolveDependencyUrl(
  dep: SmokeDependencyConfig,
  env: NodeJS.ProcessEnv
): string | undefined {
  return resolveOptionalUrl(dep.url, dep.urlEnv, env);
}

async function getWithTimeout(
  fetchImpl: FetchLike,
  target: string
): Promise<{ status: number } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMOKE_TIMEOUT_MS);
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

function loadSmokeRunConfig(): SmokeRunConfig {
  const loaded = loadConfig();
  const smoke = loaded.tests?.smoke;
  return {
    enabled: smoke?.enabled ?? true,
    criticalPagePath: smoke?.criticalPagePath,
    authUrl: smoke?.authUrl,
    authUrlEnv: smoke?.authUrlEnv,
    workflowUrl: smoke?.workflowUrl,
    workflowUrlEnv: smoke?.workflowUrlEnv,
    dependencies: smoke?.dependencies ?? [],
    apiPath: smoke?.apiPath,
    websiteUrl: loaded.urls?.website ?? '',
    apiUrl: loaded.urls?.api ?? '',
    jmeterPath: loaded.jmeter?.path ?? '',
    playwrightBaseUrl: loaded.playwright?.baseURL,
  };
}

/**
 * Fast GET-only smoke probes. Never submits forms, never logs in, never POST/PUT/DELETE.
 * Disabled → one NOT_TESTED. Enabled → always emits the six check categories.
 */
export async function runSmoke(
  config: SmokeRunConfig = loadSmokeRunConfig(),
  env: NodeJS.ProcessEnv = process.env,
  options?: RunSmokeOptions
): Promise<TestResult[]> {
  const fetchImpl = options?.fetchImpl ?? (globalThis.fetch as FetchLike);
  const writeSummary = options?.writeSummary !== false;
  const results: TestResult[] = [];

  if (!config.enabled) {
    results.push(
      makeResult({
        id: 'smoke:disabled',
        testType: 'smoke',
        category: 'functional',
        name: 'Smoke engine',
        status: 'NOT_TESTED',
        error: { message: 'smoke engine disabled' },
        metadata: { reason: 'smoke engine disabled' },
      })
    );
    if (writeSummary) writeSmokeSummary(results);
    return results;
  }

  const lastTarget =
    options?.lastTargetUrl !== undefined ? options.lastTargetUrl : readLastTargetUrl();
  const website = resolveWebsiteTarget({
    playwrightEnvUrl: env.QA_PLAYWRIGHT_BASE_URL,
    websiteEnvUrl: env.QA_WEBSITE_URL,
    lastTargetUrl: lastTarget,
    playwrightBaseUrl: config.playwrightBaseUrl,
    websiteUrl: config.websiteUrl ?? '',
  }).trim();
  const origin = website && isHttpUrl(website) ? websiteOrigin(website) : '';

  // 1. homepage loads
  {
    const id = SMOKE_CHECK_IDS.homepage;
    const name = 'Homepage loads';
    if (!origin) {
      results.push(
        makeResult({
          id,
          testType: 'smoke',
          category: 'functional',
          name,
          status: 'REQUIRES_CONFIGURATION',
          error: { message: 'no website URL configured' },
          metadata: { reason: 'no website URL configured' },
        })
      );
    } else {
      const target = origin;
      const started = Date.now();
      const outcome = await getWithTimeout(fetchImpl, target);
      const durationMs = Date.now() - started;
      if ('error' in outcome) {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'FAIL',
            durationMs,
            target,
            error: { message: `connection error: ${outcome.error}` },
          })
        );
      } else if (outcome.status >= 200 && outcome.status < 400) {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'PASS',
            durationMs,
            target,
            assertion: { expected: '2xx/3xx', actual: outcome.status },
          })
        );
      } else {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'FAIL',
            durationMs,
            target,
            assertion: { expected: '2xx/3xx', actual: outcome.status },
            error: { message: `HTTP ${outcome.status}` },
          })
        );
      }
    }
  }

  // 2. critical API responds
  {
    const id = SMOKE_CHECK_IDS.criticalApi;
    const name = 'Critical API responds';
    const apiBase = resolveApiUrl({
      envUrl: env.QA_API_URL,
      apiUrl: config.apiUrl,
    }).trim();
    const configuredPath = config.apiPath?.trim() || '';
    const jmeterPath = config.jmeterPath?.trim() || '';
    const apiPath = configuredPath || jmeterPath;

    if (!apiBase || !isHttpUrl(apiBase) || !apiPath) {
      results.push(
        makeResult({
          id,
          testType: 'smoke',
          category: 'functional',
          name,
          status: 'REQUIRES_CONFIGURATION',
          target: apiBase || undefined,
          error: {
            message: !apiBase
              ? 'no API URL configured'
              : 'no API path configured (set tests.smoke.apiPath or jmeter.path)',
          },
          metadata: { reason: 'API URL or path missing' },
        })
      );
    } else {
      const target = joinApiPath(apiBase, apiPath);
      const started = Date.now();
      const outcome = await getWithTimeout(fetchImpl, target);
      const durationMs = Date.now() - started;
      if ('error' in outcome) {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'FAIL',
            durationMs,
            target,
            error: { message: `connection error: ${outcome.error}` },
          })
        );
      } else if (outcome.status >= 200 && outcome.status < 300) {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'PASS',
            durationMs,
            target,
            assertion: { expected: '2xx', actual: outcome.status },
          })
        );
      } else {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'FAIL',
            durationMs,
            target,
            assertion: { expected: '2xx', actual: outcome.status },
            error: { message: `HTTP ${outcome.status}` },
          })
        );
      }
    }
  }

  // 3. authentication works (surface reachable — no credentials)
  {
    const id = SMOKE_CHECK_IDS.authentication;
    const name = 'Authentication works';
    const authTarget = resolveOptionalUrl(config.authUrl, config.authUrlEnv, env);
    if (!authTarget || !isHttpUrl(authTarget)) {
      results.push(
        makeResult({
          id,
          testType: 'smoke',
          category: 'functional',
          name,
          status: 'REQUIRES_CONFIGURATION',
          error: {
            message: 'no auth URL configured; smoke does not submit credentials',
          },
          metadata: { reason: 'no auth URL configured; smoke does not submit credentials' },
        })
      );
    } else {
      const started = Date.now();
      const outcome = await getWithTimeout(fetchImpl, authTarget);
      const durationMs = Date.now() - started;
      if ('error' in outcome) {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'FAIL',
            durationMs,
            target: authTarget,
            error: { message: `connection error: ${outcome.error}` },
          })
        );
      } else {
        const status = outcome.status;
        const serviceUp =
          (status >= 200 && status < 300) || status === 401 || status === 403;
        if (serviceUp) {
          results.push(
            makeResult({
              id,
              testType: 'smoke',
              category: 'functional',
              name,
              status: 'PASS',
              durationMs,
              target: authTarget,
              assertion: { expected: '2xx|401|403', actual: status },
            })
          );
        } else {
          results.push(
            makeResult({
              id,
              testType: 'smoke',
              category: 'functional',
              name,
              status: 'FAIL',
              durationMs,
              target: authTarget,
              assertion: { expected: '2xx|401|403', actual: status },
              error: { message: `HTTP ${status}` },
            })
          );
        }
      }
    }
  }

  // 4. critical workflow starts
  {
    const id = SMOKE_CHECK_IDS.criticalWorkflow;
    const name = 'Critical workflow starts';
    const workflowTarget = resolveOptionalUrl(config.workflowUrl, config.workflowUrlEnv, env);
    if (!workflowTarget || !isHttpUrl(workflowTarget)) {
      results.push(
        makeResult({
          id,
          testType: 'smoke',
          category: 'functional',
          name,
          status: 'REQUIRES_CONFIGURATION',
          error: { message: 'no workflow URL configured' },
          metadata: { reason: 'no workflow URL configured' },
        })
      );
    } else {
      const started = Date.now();
      const outcome = await getWithTimeout(fetchImpl, workflowTarget);
      const durationMs = Date.now() - started;
      if ('error' in outcome) {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'FAIL',
            durationMs,
            target: workflowTarget,
            error: { message: `connection error: ${outcome.error}` },
          })
        );
      } else if (outcome.status >= 200 && outcome.status < 400) {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'PASS',
            durationMs,
            target: workflowTarget,
            assertion: { expected: '2xx/3xx', actual: outcome.status },
          })
        );
      } else {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'FAIL',
            durationMs,
            target: workflowTarget,
            assertion: { expected: '2xx/3xx', actual: outcome.status },
            error: { message: `HTTP ${outcome.status}` },
          })
        );
      }
    }
  }

  // 5. critical page is accessible
  {
    const id = SMOKE_CHECK_IDS.criticalPage;
    const name = 'Critical page is accessible';
    const pagePath = config.criticalPagePath?.trim() || '/';
    if (!origin) {
      results.push(
        makeResult({
          id,
          testType: 'smoke',
          category: 'functional',
          name,
          status: 'REQUIRES_CONFIGURATION',
          error: { message: 'no website URL configured' },
          metadata: { reason: 'no website URL configured' },
        })
      );
    } else {
      const target = joinOriginPath(origin, pagePath);
      const started = Date.now();
      const outcome = await getWithTimeout(fetchImpl, target);
      const durationMs = Date.now() - started;
      if ('error' in outcome) {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'FAIL',
            durationMs,
            target,
            error: { message: `connection error: ${outcome.error}` },
          })
        );
      } else if (outcome.status >= 200 && outcome.status < 400) {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'PASS',
            durationMs,
            target,
            assertion: { expected: '2xx/3xx', actual: outcome.status },
          })
        );
      } else {
        results.push(
          makeResult({
            id,
            testType: 'smoke',
            category: 'functional',
            name,
            status: 'FAIL',
            durationMs,
            target,
            assertion: { expected: '2xx/3xx', actual: outcome.status },
            error: { message: `HTTP ${outcome.status}` },
          })
        );
      }
    }
  }

  // 6. critical dependency is available
  {
    const dependencies = config.dependencies ?? [];
    if (dependencies.length === 0) {
      results.push(
        makeResult({
          id: SMOKE_CHECK_IDS.criticalDependency,
          testType: 'smoke',
          category: 'functional',
          name: 'Critical dependency is available',
          status: 'REQUIRES_CONFIGURATION',
          error: { message: 'no smoke dependencies configured' },
          metadata: { reason: 'no smoke dependencies configured' },
        })
      );
    } else {
      for (const dep of dependencies) {
        const id = `smoke:dependency:${dep.name}`;
        const name = `Dependency: ${dep.name}`;
        const target = resolveDependencyUrl(dep, env);
        if (!target || !isHttpUrl(target)) {
          results.push(
            makeResult({
              id,
              testType: 'smoke',
              category: 'functional',
              name,
              status: 'REQUIRES_CONFIGURATION',
              target: target || undefined,
              error: {
                message: `no resolvable http(s) URL for dependency "${dep.name}" (set url or urlEnv)`,
              },
              metadata: { reason: 'no resolvable URL', urlEnv: dep.urlEnv },
            })
          );
          continue;
        }
        const started = Date.now();
        const outcome = await getWithTimeout(fetchImpl, target);
        const durationMs = Date.now() - started;
        if ('error' in outcome) {
          results.push(
            makeResult({
              id,
              testType: 'smoke',
              category: 'functional',
              name,
              status: 'FAIL',
              durationMs,
              target,
              error: { message: `connection error: ${outcome.error}` },
            })
          );
        } else if (outcome.status >= 200 && outcome.status < 400) {
          results.push(
            makeResult({
              id,
              testType: 'smoke',
              category: 'functional',
              name,
              status: 'PASS',
              durationMs,
              target,
              assertion: { expected: '2xx/3xx', actual: outcome.status },
            })
          );
        } else {
          results.push(
            makeResult({
              id,
              testType: 'smoke',
              category: 'functional',
              name,
              status: 'FAIL',
              durationMs,
              target,
              assertion: { expected: '2xx/3xx', actual: outcome.status },
              error: { message: `HTTP ${outcome.status}` },
            })
          );
        }
      }
    }
  }

  if (writeSummary) writeSmokeSummary(results);
  return results;
}

export function writeSmokeSummary(results: TestResult[]): string {
  const summary = buildEngineSummary({
    engine: 'smoke',
    testType: 'smoke',
    results,
  });
  const out = path.join(PATHS.reports.smoke, 'summary.json');
  writeJson(out, summary);
  return out;
}

async function main(): Promise<void> {
  logStep('Smoke engine (GET probes only)');
  const results = await runSmoke();
  const summary = buildEngineSummary({
    engine: 'smoke',
    testType: 'smoke',
    results,
  });
  for (const row of results) {
    console.log(`${row.status}\t${row.name}\t${row.error?.message ?? row.target ?? ''}`);
  }
  if (summary.failCount > 0) {
    logError(`${summary.failCount} smoke FAIL(s) — see reports/smoke/`);
    process.exit(1);
  }
  if (summary.requiresConfigurationCount > 0) {
    logWarn('Smoke REQUIRES_CONFIGURATION — see reports/smoke/');
    return;
  }
  if (summary.notTestedCount > 0 && summary.passCount === 0) {
    logWarn('Smoke NOT_TESTED — engine disabled');
    return;
  }
  logSuccess('Smoke engine completed');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
