import path from 'path';
import { PATHS } from '../lib/paths';
import { loadConfig } from '../lib/load-config';
import { writeJson } from '../discovery/write-json';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { readLastTargetUrl } from '../lib/last-target';
import { resolveWebsiteTarget } from '../orchestrator/resolve-url';
import {
  buildEngineSummary,
  makeResult,
  type TestResult,
} from '../core/engine-contract';
import { getTestType } from '../core/test-types/registry';
import type { SanityCheckConfig, SanityTestsConfig } from '../types';

const SANITY_TIMEOUT_MS = 10_000;
const SANITY_CATEGORY = getTestType('sanity')?.category ?? 'functional';

export type FetchLike = (
  input: string,
  init?: { method?: string; signal?: AbortSignal }
) => Promise<{ status: number; ok: boolean }>;

/** Sanity config plus URL bases needed to resolve path checks without inventing hosts. */
export interface SanityRunConfig extends SanityTestsConfig {
  websiteUrl?: string;
  playwrightBaseUrl?: string;
}

export interface RunSanityOptions {
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

/**
 * Resolve a sanity check target:
 * 1. `url` when it is http(s)
 * 2. else env var named by `urlEnv`
 * 3. else if `path` is set, join to `resolveWebsiteTarget()`
 * 4. else missing
 */
function resolveCheckTarget(
  check: SanityCheckConfig,
  env: NodeJS.ProcessEnv,
  website: string
): string | undefined {
  const direct = check.url?.trim();
  if (direct && isHttpUrl(direct)) return direct;

  const envName = check.urlEnv?.trim();
  if (envName) {
    const fromEnv = env[envName]?.trim();
    if (fromEnv && isHttpUrl(fromEnv)) return fromEnv;
  }

  const pagePath = check.path?.trim();
  if (pagePath) {
    const origin = website && isHttpUrl(website) ? websiteOrigin(website) : '';
    if (origin) return joinOriginPath(origin, pagePath);
  }

  return undefined;
}

async function getWithTimeout(
  fetchImpl: FetchLike,
  target: string
): Promise<{ status: number } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SANITY_TIMEOUT_MS);
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

function loadSanityRunConfig(): SanityRunConfig {
  const loaded = loadConfig();
  const sanity = loaded.tests?.sanity;
  return {
    enabled: sanity?.enabled ?? false,
    checks: sanity?.checks ?? [],
    websiteUrl: loaded.urls?.website ?? '',
    playwrightBaseUrl: loaded.playwright?.baseURL,
  };
}

/**
 * Scoped GET-only sanity probes for a user-listed change/fix scope.
 * Not discovery, not regression, and not retest of prior failures.
 * Disabled → one NOT_TESTED. Empty checks → one REQUIRES_CONFIGURATION.
 */
export async function runSanity(
  config: SanityRunConfig = loadSanityRunConfig(),
  env: NodeJS.ProcessEnv = process.env,
  options?: RunSanityOptions
): Promise<TestResult[]> {
  const fetchImpl = options?.fetchImpl ?? (globalThis.fetch as FetchLike);
  const writeSummary = options?.writeSummary !== false;
  const results: TestResult[] = [];

  if (!config.enabled) {
    results.push(
      makeResult({
        id: 'sanity:disabled',
        testType: 'sanity',
        category: SANITY_CATEGORY,
        name: 'Sanity engine',
        status: 'NOT_TESTED',
        error: { message: 'sanity engine disabled' },
        metadata: { reason: 'sanity engine disabled' },
      })
    );
    if (writeSummary) writeSanitySummary(results);
    return results;
  }

  const checks = config.checks ?? [];
  if (checks.length === 0) {
    results.push(
      makeResult({
        id: 'sanity:no-scope',
        testType: 'sanity',
        category: SANITY_CATEGORY,
        name: 'Sanity scope',
        status: 'REQUIRES_CONFIGURATION',
        error: {
          message: 'no sanity scope configured; sanity is not regression or retest',
        },
        metadata: {
          reason: 'no sanity scope configured; sanity is not regression or retest',
        },
      })
    );
    if (writeSummary) writeSanitySummary(results);
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

  for (const check of checks) {
    const id = check.id;
    const name = check.name?.trim() || check.id;
    const target = resolveCheckTarget(check, env, website);

    if (!target || !isHttpUrl(target)) {
      results.push(
        makeResult({
          id,
          testType: 'sanity',
          category: SANITY_CATEGORY,
          name,
          status: 'REQUIRES_CONFIGURATION',
          target: target || undefined,
          error: {
            message: `no resolvable http(s) URL for sanity check "${id}" (set url, urlEnv, or path with a website URL)`,
          },
          metadata: {
            reason: 'no resolvable URL',
            urlEnv: check.urlEnv,
            path: check.path,
          },
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
          testType: 'sanity',
          category: SANITY_CATEGORY,
          name,
          status: 'FAIL',
          durationMs,
          target,
          assertion: { expected: '2xx/3xx', actual: outcome.error },
          error: { message: `connection error: ${outcome.error}` },
        })
      );
    } else if (outcome.status >= 200 && outcome.status < 400) {
      results.push(
        makeResult({
          id,
          testType: 'sanity',
          category: SANITY_CATEGORY,
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
          testType: 'sanity',
          category: SANITY_CATEGORY,
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

  if (writeSummary) writeSanitySummary(results);
  return results;
}

export function writeSanitySummary(results: TestResult[]): string {
  const summary = buildEngineSummary({
    engine: 'sanity',
    testType: 'sanity',
    results,
  });
  const out = path.join(PATHS.reports.sanity, 'summary.json');
  writeJson(out, summary);
  return out;
}

async function main(): Promise<void> {
  logStep('Sanity engine (GET probes only — scoped checks, not regression/retest)');
  const results = await runSanity();
  const summary = buildEngineSummary({
    engine: 'sanity',
    testType: 'sanity',
    results,
  });
  for (const row of results) {
    console.log(`${row.status}\t${row.name}\t${row.error?.message ?? row.target ?? ''}`);
  }
  if (summary.failCount > 0) {
    logError(`${summary.failCount} sanity FAIL(s) — see reports/sanity/`);
    process.exit(1);
  }
  if (summary.requiresConfigurationCount > 0) {
    logWarn('Sanity REQUIRES_CONFIGURATION — see reports/sanity/');
    return;
  }
  if (summary.notTestedCount > 0 && summary.passCount === 0) {
    logWarn('Sanity NOT_TESTED — engine disabled');
    return;
  }
  logSuccess('Sanity engine completed');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
