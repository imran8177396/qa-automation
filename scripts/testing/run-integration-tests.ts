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

export const INTEGRATION_CHECK_KINDS = [
  'service-to-service',
  'api-to-database',
  'api-to-redis',
  'api-to-queue',
  'service-to-external-api',
  'worker-to-database',
] as const;

export type IntegrationCheckKind = (typeof INTEGRATION_CHECK_KINDS)[number];

export interface IntegrationCheckConfig {
  name: string;
  kind: IntegrationCheckKind;
  /** Absolute http(s) URL — never invent a host. */
  url?: string;
  /** Env var name whose value is an http(s) URL. */
  urlEnv?: string;
}

export interface IntegrationEngineConfig {
  enabled: boolean;
  checks?: IntegrationCheckConfig[];
}

export type FetchLike = (
  input: string,
  init?: { method?: string; signal?: AbortSignal }
) => Promise<{ status: number; ok: boolean }>;

function resolveCheckUrl(
  check: IntegrationCheckConfig,
  env: NodeJS.ProcessEnv
): string | undefined {
  const direct = check.url?.trim();
  if (direct) return direct;
  const envName = check.urlEnv?.trim();
  if (envName) {
    const fromEnv = env[envName]?.trim();
    if (fromEnv) return fromEnv;
  }
  return undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Run integration checks. GET only — never POST/PUT/PATCH/DELETE.
 * Missing URL → REQUIRES_CONFIGURATION (no network). Disabled → NOT_TESTED.
 */
export async function runIntegrationTests(options?: {
  config?: IntegrationEngineConfig;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  writeSummary?: boolean;
}): Promise<TestResult[]> {
  const env = options?.env ?? process.env;
  const config =
    options?.config ??
    (() => {
      const loaded = loadConfig();
      return {
        enabled: loaded.tests?.integration?.enabled ?? false,
        checks: loaded.tests?.integration?.checks ?? [],
      };
    })();
  const fetchImpl = options?.fetchImpl ?? (globalThis.fetch as FetchLike);
  const writeSummary = options?.writeSummary !== false;

  const results: TestResult[] = [];

  if (!config.enabled) {
    results.push(
      makeResult({
        id: 'integration:disabled',
        testType: 'integration',
        category: 'functional',
        name: 'Integration engine',
        status: 'NOT_TESTED',
        error: { message: 'integration engine disabled' },
        metadata: { reason: 'integration engine disabled' },
      })
    );
    if (writeSummary) writeIntegrationSummary(results);
    return results;
  }

  const checks = config.checks ?? [];
  if (checks.length === 0) {
    results.push(
      makeResult({
        id: 'integration:no-checks',
        testType: 'integration',
        category: 'functional',
        name: 'Integration checks',
        status: 'REQUIRES_CONFIGURATION',
        error: { message: 'no integration checks configured' },
        metadata: { reason: 'no integration checks configured' },
      })
    );
    if (writeSummary) writeIntegrationSummary(results);
    return results;
  }

  for (const check of checks) {
    const id = `integration:${check.kind}:${check.name}`;
    const target = resolveCheckUrl(check, env);

    if (!target || !isHttpUrl(target)) {
      results.push(
        makeResult({
          id,
          testType: 'integration',
          category: 'functional',
          name: check.name,
          status: 'REQUIRES_CONFIGURATION',
          target: target || undefined,
          error: {
            message: `no resolvable http(s) URL for check "${check.name}" (set url or urlEnv)`,
          },
          metadata: {
            reason: 'no resolvable URL',
            kind: check.kind,
            urlEnv: check.urlEnv,
          },
        })
      );
      continue;
    }

    const started = Date.now();
    try {
      const response = await fetchImpl(target, { method: 'GET' });
      const durationMs = Date.now() - started;
      if (response.status >= 200 && response.status < 300) {
        results.push(
          makeResult({
            id,
            testType: 'integration',
            category: 'functional',
            name: check.name,
            status: 'PASS',
            durationMs,
            target,
            assertion: { expected: '2xx', actual: response.status },
            metadata: { kind: check.kind },
          })
        );
      } else {
        results.push(
          makeResult({
            id,
            testType: 'integration',
            category: 'functional',
            name: check.name,
            status: 'FAIL',
            durationMs,
            target,
            assertion: { expected: '2xx', actual: response.status },
            error: { message: `HTTP ${response.status}` },
            metadata: { kind: check.kind },
          })
        );
      }
    } catch (error: unknown) {
      const durationMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      results.push(
        makeResult({
          id,
          testType: 'integration',
          category: 'functional',
          name: check.name,
          status: 'FAIL',
          durationMs,
          target,
          error: { message: `connection error: ${message}` },
          metadata: { kind: check.kind },
        })
      );
    }
  }

  if (writeSummary) writeIntegrationSummary(results);
  return results;
}

export function writeIntegrationSummary(results: TestResult[]): string {
  const summary = buildEngineSummary({
    engine: 'integration',
    testType: 'integration',
    results,
  });
  const out = path.join(PATHS.reports.integration, 'summary.json');
  writeJson(out, summary);
  return out;
}

async function main(): Promise<void> {
  logStep('Integration engine (GET probes only)');
  const results = await runIntegrationTests();
  const summary = buildEngineSummary({
    engine: 'integration',
    testType: 'integration',
    results,
  });
  for (const row of results) {
    console.log(`${row.status}\t${row.name}\t${row.error?.message ?? row.target ?? ''}`);
  }
  if (summary.failCount > 0) {
    logError(`${summary.failCount} integration FAIL(s) — see reports/integration/`);
    process.exit(1);
  }
  if (summary.requiresConfigurationCount > 0) {
    logWarn('Integration REQUIRES_CONFIGURATION — see reports/integration/');
    return;
  }
  if (summary.notTestedCount > 0 && summary.passCount === 0) {
    logWarn('Integration NOT_TESTED — engine disabled');
    return;
  }
  logSuccess('Integration engine completed');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
