/**
 * Regression suite selector — picks which suites to run (selective/full).
 * Not retest: retest re-runs prior failures and keeps the original FAIL;
 * this module must not import scripts/retest.
 *
 * Extension: a future ChangeImpactProvider can narrow selective suites
 * (change-based / risk-based). Do not call a provider in v1.
 */
import path from 'path';
import { PATHS } from '../lib/paths';
import { loadConfig } from '../lib/load-config';
import { writeJson } from '../discovery/write-json';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { resolveNpmCommand, runCommand } from '../lib/run-command';
import { websiteTargetEnv } from '../lib/last-target';
import { resolveApiUrl, resolveWebsiteTarget } from '../orchestrator/resolve-url';
import {
  buildEngineSummary,
  makeResult,
  type TestResult,
} from '../core/engine-contract';
import { getTestType } from '../core/test-types/registry';

const REGRESSION_CATEGORY = getTestType('regression')?.category ?? 'functional';

export const REGRESSION_SUITE_IDS = ['unit', 'api', 'e2e'] as const;
export type RegressionSuiteId = (typeof REGRESSION_SUITE_IDS)[number];

export type RegressionMode = 'full' | 'selective' | 'change-based' | 'risk-based';

/** Future change-impact analysis input. Not used in v1. */
export interface ChangeImpact {
  files: string[];
}

/** Future provider that can narrow selective suites. Not called in v1. */
export type ChangeImpactProvider = () => Promise<ChangeImpact>;

const DEFAULT_INCLUDE: readonly RegressionSuiteId[] = ['unit'];

const OUTSIDE_MODE_MESSAGE =
  'outside this regression mode (selective v1 defaults to unit only; full v1 also defaults to unit unless --include adds api or e2e)';

const NOT_IMPLEMENTED_MESSAGE = 'change-impact analysis is not implemented';

export interface PlanRegressionOptions {
  mode?: RegressionMode;
  include?: RegressionSuiteId[];
  /**
   * When false (default), included suites are marked planned (NOT_TESTED + metadata.planned)
   * without spawning. When true, included suites are executed via npm scripts.
   */
  execute?: boolean;
  enabled?: boolean;
  websiteUrl?: string;
  apiUrl?: string;
  playwrightBaseUrl?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to resolveNpmCommand + runCommand. */
  runNpmScript?: (script: string, env: NodeJS.ProcessEnv) => { status: number | null };
}

function isRegressionSuiteId(value: string): value is RegressionSuiteId {
  return (REGRESSION_SUITE_IDS as readonly string[]).includes(value);
}

function isRegressionMode(value: string): value is RegressionMode {
  return (
    value === 'full' ||
    value === 'selective' ||
    value === 'change-based' ||
    value === 'risk-based'
  );
}

function normalizeInclude(raw: string[] | undefined): RegressionSuiteId[] {
  if (!raw || raw.length === 0) return [...DEFAULT_INCLUDE];
  const suites: RegressionSuiteId[] = [];
  for (const item of raw) {
    const trimmed = item.trim();
    if (isRegressionSuiteId(trimmed) && !suites.includes(trimmed)) {
      suites.push(trimmed);
    }
  }
  return suites.length > 0 ? suites : [...DEFAULT_INCLUDE];
}

function suiteRow(
  id: RegressionSuiteId,
  status: TestResult['status'],
  extras: Partial<Pick<TestResult, 'durationMs' | 'error' | 'metadata' | 'target'>> = {}
): TestResult {
  return makeResult({
    id,
    testType: 'regression',
    category: REGRESSION_CATEGORY,
    name: `Regression suite: ${id}`,
    status,
    ...(extras.durationMs !== undefined ? { durationMs: extras.durationMs } : {}),
    ...(extras.target !== undefined ? { target: extras.target } : {}),
    ...(extras.error !== undefined ? { error: extras.error } : {}),
    ...(extras.metadata !== undefined ? { metadata: extras.metadata } : {}),
  });
}

function defaultRunNpmScript(
  script: string,
  env: NodeJS.ProcessEnv
): { status: number | null } {
  const npm = resolveNpmCommand();
  if (!npm) {
    return { status: 1 };
  }
  const result = runCommand(npm, ['run', script], { env });
  return { status: result.status };
}

function executeSuite(
  id: RegressionSuiteId,
  options: PlanRegressionOptions,
  env: NodeJS.ProcessEnv
): TestResult {
  const runNpm = options.runNpmScript ?? defaultRunNpmScript;
  const websiteUrl = options.websiteUrl ?? '';
  const apiUrl = options.apiUrl ?? '';
  const playwrightBaseUrl = options.playwrightBaseUrl;

  if (id === 'unit') {
    const started = Date.now();
    const outcome = runNpm('test:unit', env);
    const durationMs = Date.now() - started;
    if (outcome.status === 0) {
      return suiteRow('unit', 'PASS', { durationMs });
    }
    return suiteRow('unit', 'FAIL', {
      durationMs,
      error: { message: `npm run test:unit exited with status ${outcome.status ?? 'null'}` },
    });
  }

  if (id === 'api') {
    const resolvedApi = resolveApiUrl({
      envUrl: env.QA_API_URL,
      apiUrl,
    }).trim();
    if (!resolvedApi) {
      return suiteRow('api', 'REQUIRES_CONFIGURATION', {
        error: { message: 'API URL missing' },
        metadata: { reason: 'API URL missing' },
      });
    }
    const started = Date.now();
    const outcome = runNpm('test:api', env);
    const durationMs = Date.now() - started;
    if (outcome.status === 0) {
      return suiteRow('api', 'PASS', { durationMs, target: resolvedApi });
    }
    return suiteRow('api', 'FAIL', {
      durationMs,
      target: resolvedApi,
      error: { message: `npm run test:api exited with status ${outcome.status ?? 'null'}` },
    });
  }

  // e2e — never pass lastTarget; never invent a demo host
  const resolvedWebsite = resolveWebsiteTarget({
    playwrightEnvUrl: env.QA_PLAYWRIGHT_BASE_URL,
    websiteEnvUrl: env.QA_WEBSITE_URL,
    lastTargetUrl: null,
    playwrightBaseUrl,
    websiteUrl,
  }).trim();
  if (!resolvedWebsite) {
    return suiteRow('e2e', 'REQUIRES_CONFIGURATION', {
      error: { message: 'website URL missing' },
      metadata: { reason: 'website URL missing' },
    });
  }
  const e2eEnv = { ...env, ...websiteTargetEnv(resolvedWebsite) };
  const started = Date.now();
  const outcome = runNpm('test:e2e', e2eEnv);
  const durationMs = Date.now() - started;
  if (outcome.status === 0) {
    return suiteRow('e2e', 'PASS', { durationMs, target: resolvedWebsite });
  }
  return suiteRow('e2e', 'FAIL', {
    durationMs,
    target: resolvedWebsite,
    error: { message: `npm run test:e2e exited with status ${outcome.status ?? 'null'}` },
  });
}

/**
 * Plan (and optionally execute) regression suite rows.
 * Always returns one row per known suite id: unit, api, e2e.
 * Does not import or invoke retest.
 */
export function planRegression(options: PlanRegressionOptions = {}): TestResult[] {
  const env = options.env ?? process.env;
  const mode: RegressionMode = options.mode ?? 'selective';
  const execute = options.execute === true;

  if (options.enabled === false) {
    return REGRESSION_SUITE_IDS.map((id) =>
      suiteRow(id, 'NOT_TESTED', {
        error: { message: 'regression engine disabled' },
        metadata: { reason: 'regression engine disabled', mode },
      })
    );
  }

  if (mode === 'change-based' || mode === 'risk-based') {
    return REGRESSION_SUITE_IDS.map((id) =>
      suiteRow(id, 'NOT_TESTED', {
        error: { message: NOT_IMPLEMENTED_MESSAGE },
        metadata: { reason: NOT_IMPLEMENTED_MESSAGE, mode },
      })
    );
  }

  const include = new Set(normalizeInclude(options.include));
  const results: TestResult[] = [];

  for (const id of REGRESSION_SUITE_IDS) {
    if (!include.has(id)) {
      results.push(
        suiteRow(id, 'NOT_TESTED', {
          error: { message: OUTSIDE_MODE_MESSAGE },
          metadata: { reason: OUTSIDE_MODE_MESSAGE, mode, included: false },
        })
      );
      continue;
    }

    if (!execute) {
      results.push(
        suiteRow(id, 'NOT_TESTED', {
          error: { message: 'planned for execution' },
          metadata: { planned: true, mode, included: true },
        })
      );
      continue;
    }

    results.push(executeSuite(id, options, env));
  }

  return results;
}

export function writeRegressionSummary(results: TestResult[]): string {
  const summary = buildEngineSummary({
    engine: 'regression',
    testType: 'regression',
    results,
  });
  const out = path.join(PATHS.reports.regression, 'summary.json');
  writeJson(out, summary);
  return out;
}

export function parseRegressionCliArgs(argv: string[]): {
  mode?: RegressionMode;
  include?: RegressionSuiteId[];
} {
  let mode: RegressionMode | undefined;
  let include: RegressionSuiteId[] | undefined;

  for (const arg of argv) {
    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length).trim();
      if (isRegressionMode(value)) mode = value;
    } else if (arg.startsWith('--include=')) {
      include = normalizeInclude(
        arg
          .slice('--include='.length)
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      );
    }
  }

  return { mode, include };
}

function loadRegressionDefaults(): {
  enabled: boolean;
  mode: RegressionMode;
  include?: RegressionSuiteId[];
  websiteUrl: string;
  apiUrl: string;
  playwrightBaseUrl?: string;
} {
  const loaded = loadConfig();
  const regression = loaded.tests?.regression;
  const configMode = regression?.mode;
  const mode: RegressionMode =
    configMode === 'full' || configMode === 'selective' ? configMode : 'selective';
  const includeRaw = regression?.include;
  return {
    enabled: regression?.enabled ?? true,
    mode,
    include: includeRaw ? normalizeInclude([...includeRaw]) : undefined,
    websiteUrl: loaded.urls?.website ?? '',
    apiUrl: loaded.urls?.api ?? '',
    playwrightBaseUrl: loaded.playwright?.baseURL,
  };
}

async function main(): Promise<void> {
  logStep('Regression engine (suite selector — not retest)');
  const defaults = loadRegressionDefaults();
  const cli = parseRegressionCliArgs(process.argv.slice(2));
  const mode = cli.mode ?? defaults.mode;
  const include = cli.include ?? defaults.include;

  const results = planRegression({
    mode,
    include,
    execute: true,
    enabled: defaults.enabled,
    websiteUrl: defaults.websiteUrl,
    apiUrl: defaults.apiUrl,
    playwrightBaseUrl: defaults.playwrightBaseUrl,
  });

  writeRegressionSummary(results);
  const summary = buildEngineSummary({
    engine: 'regression',
    testType: 'regression',
    results,
  });

  for (const row of results) {
    console.log(`${row.status}\t${row.name}\t${row.error?.message ?? row.target ?? ''}`);
  }

  if (mode === 'change-based' || mode === 'risk-based') {
    logWarn(`Regression ${mode}: ${NOT_IMPLEMENTED_MESSAGE}`);
    return;
  }

  if (summary.failCount > 0) {
    logError(`${summary.failCount} regression FAIL(s) — see reports/regression/`);
    process.exit(1);
  }
  if (summary.requiresConfigurationCount > 0) {
    logWarn('Regression REQUIRES_CONFIGURATION — see reports/regression/');
    return;
  }
  if (summary.notTestedCount > 0 && summary.passCount === 0) {
    logWarn('Regression NOT_TESTED — see reports/regression/');
    return;
  }
  logSuccess('Regression engine completed');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
