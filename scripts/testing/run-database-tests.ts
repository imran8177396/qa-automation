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

/** Fixed catalog of database checks — always visible when enabled but unconfigured. */
export const DATABASE_CHECK_IDS = [
  'connection',
  'schema',
  'tables',
  'columns',
  'constraints',
  'primary-keys',
  'foreign-keys',
  'crud',
  'data-integrity',
] as const;

export type DatabaseCheckId = (typeof DATABASE_CHECK_IDS)[number];

export interface DatabaseEngineConfig {
  enabled: boolean;
  /** Env var holding the connection string. Default DATABASE_URL. */
  urlEnv?: string;
}

function hasDbDriverInstalled(): boolean {
  for (const pkg of ['pg', 'mysql', 'mysql2']) {
    try {
      require.resolve(pkg);
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

/**
 * Database engine. Never invents credentials. Does not npm-install drivers.
 * When enabled but DATABASE_URL (or urlEnv) is missing → 9 REQUIRES_CONFIGURATION rows.
 * When a URL is set but no driver is installed → connection BLOCKED, rest REQUIRES_CONFIGURATION.
 */
export async function runDatabaseTests(options?: {
  config?: DatabaseEngineConfig;
  env?: NodeJS.ProcessEnv;
  /** Inject driver detection for tests. */
  hasDriver?: boolean;
  writeSummary?: boolean;
}): Promise<TestResult[]> {
  const env = options?.env ?? process.env;
  const config: DatabaseEngineConfig =
    options?.config ??
    (() => {
      const loaded = loadConfig();
      return {
        enabled: loaded.tests?.database?.enabled ?? false,
        urlEnv: loaded.tests?.database?.urlEnv ?? 'DATABASE_URL',
      };
    })();

  const writeSummary = options?.writeSummary !== false;
  const results: TestResult[] = [];

  if (!config.enabled) {
    results.push(
      makeResult({
        id: 'database:disabled',
        testType: 'database',
        category: 'functional',
        name: 'Database engine',
        status: 'NOT_TESTED',
        error: { message: 'database engine disabled' },
        metadata: { reason: 'database engine disabled' },
      })
    );
    if (writeSummary) writeDatabaseSummary(results);
    return results;
  }

  const urlEnv = (config.urlEnv ?? 'DATABASE_URL').trim() || 'DATABASE_URL';
  const connectionUrl = env[urlEnv]?.trim() ?? '';

  if (!connectionUrl) {
    for (const checkId of DATABASE_CHECK_IDS) {
      results.push(
        makeResult({
          id: `database:${checkId}`,
          testType: 'database',
          category: 'functional',
          name: `Database ${checkId}`,
          status: 'REQUIRES_CONFIGURATION',
          error: {
            message: `${urlEnv} is not set — cannot run database ${checkId} check (no credentials invented)`,
          },
          metadata: { reason: `${urlEnv} missing`, checkId },
        })
      );
    }
    if (writeSummary) writeDatabaseSummary(results);
    return results;
  }

  const hasDriver = options?.hasDriver ?? hasDbDriverInstalled();
  if (!hasDriver) {
    results.push(
      makeResult({
        id: 'database:connection',
        testType: 'database',
        category: 'functional',
        name: 'Database connection',
        status: 'BLOCKED',
        error: { message: 'no database driver installed' },
        metadata: { reason: 'no database driver installed', urlEnv },
      })
    );
    for (const checkId of DATABASE_CHECK_IDS) {
      if (checkId === 'connection') continue;
      results.push(
        makeResult({
          id: `database:${checkId}`,
          testType: 'database',
          category: 'functional',
          name: `Database ${checkId}`,
          status: 'REQUIRES_CONFIGURATION',
          error: {
            message: `database ${checkId} requires an installed driver (pg or mysql) — none present; not connecting`,
          },
          metadata: { reason: 'no database driver installed', checkId },
        })
      );
    }
    if (writeSummary) writeDatabaseSummary(results);
    return results;
  }

  // Driver present: still do not auto-connect in this phase without an explicit
  // safe adapter. Record connection as REQUIRES_CONFIGURATION so we never invent
  // a connection attempt protocol here.
  for (const checkId of DATABASE_CHECK_IDS) {
    results.push(
      makeResult({
        id: `database:${checkId}`,
        testType: 'database',
        category: 'functional',
        name: `Database ${checkId}`,
        status: 'REQUIRES_CONFIGURATION',
        error: {
          message: `database driver detected but ${checkId} adapter is not wired — refusing to invent SQL`,
        },
        metadata: { reason: 'adapter not wired', checkId },
      })
    );
  }

  if (writeSummary) writeDatabaseSummary(results);
  return results;
}

export function writeDatabaseSummary(results: TestResult[]): string {
  const summary = buildEngineSummary({
    engine: 'database',
    testType: 'database',
    results,
  });
  const out = path.join(PATHS.reports.database, 'summary.json');
  writeJson(out, summary);
  return out;
}

async function main(): Promise<void> {
  logStep('Database engine');
  const results = await runDatabaseTests();
  const summary = buildEngineSummary({
    engine: 'database',
    testType: 'database',
    results,
  });
  for (const row of results) {
    console.log(`${row.status}\t${row.name}\t${row.error?.message ?? ''}`);
  }
  if (summary.failCount > 0) {
    logError(`${summary.failCount} database FAIL(s) — see reports/database/`);
    process.exit(1);
  }
  if (summary.blockedCount > 0) {
    logWarn('Database BLOCKED — see reports/database/');
    return;
  }
  if (summary.requiresConfigurationCount > 0) {
    logWarn('Database REQUIRES_CONFIGURATION — see reports/database/');
    return;
  }
  if (summary.notTestedCount > 0) {
    logWarn('Database NOT_TESTED — engine disabled');
    return;
  }
  logSuccess('Database engine completed');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
