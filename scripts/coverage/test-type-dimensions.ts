/**
 * Test-type coverage dimensions (registry-aligned).
 * Coverage remains inventory/engine-item based — never pass rate.
 * Overall rollup = arithmetic mean of coveragePct across dimensions with
 * status MEASURED and a numeric coveragePct; null when none are measured.
 * NOT_MEASURED / REQUIRES_CONFIGURATION / NOT_IMPLEMENTED are excluded from
 * both the numerator and the denominator (never coerced to 100%).
 */
import fs from 'fs';
import path from 'path';
import { getTestType } from '../core/test-types/registry';
import type { EngineSummary } from '../core/engine-contract';
import type { TestTypeId } from '../core/test-types/types';
import { PATHS } from '../lib/paths';
import type { QaConfig } from '../types';
import {
  UI_ELEMENT_KINDS,
  type CoverageRecord,
  type InventoryItem,
  type InventoryKind,
  type TestTypeDimensionCoverage,
  type TestTypeDimensionStatus,
} from './types';
import { isCoveredStatus, isTestable, percent } from './status';

export type { TestTypeDimensionCoverage, TestTypeDimensionStatus };

export const TEST_TYPE_COVERAGE_DIMENSION_IDS = [
  'functional',
  'api',
  'ui',
  'e2e',
  'integration',
  'contract',
  'database',
  'security',
  'performance',
  'accessibility',
  'visual',
  'responsive',
  'compatibility',
  'localization',
  'reliability',
  'regression',
  'ai',
] as const;

export type TestTypeCoverageDimensionId = (typeof TEST_TYPE_COVERAGE_DIMENSION_IDS)[number];

/** Inventory kinds that feed each inventory-backed dimension. */
const INVENTORY_KINDS_BY_DIMENSION: Partial<
  Record<TestTypeCoverageDimensionId, readonly InventoryKind[]>
> = {
  // Functional surface only — not specialized a11y/visual/perf/security (those are separate dims).
  functional: ['page', 'route', 'workflow', ...UI_ELEMENT_KINDS],
  api: ['api'],
  ui: UI_ELEMENT_KINDS,
  e2e: ['page'],
  security: ['security'],
  performance: ['performance'],
  accessibility: ['accessibility'],
  visual: ['visual'],
  responsive: ['viewport'],
  compatibility: ['browser'],
};

/** Registry id used for implementation status / config gating. */
const REGISTRY_ID_BY_DIMENSION: Record<TestTypeCoverageDimensionId, TestTypeId> = {
  functional: 'functional',
  api: 'api',
  ui: 'ui',
  e2e: 'e2e',
  integration: 'integration',
  contract: 'contract',
  database: 'database',
  security: 'security',
  performance: 'performance',
  accessibility: 'accessibility',
  visual: 'visual',
  responsive: 'responsive',
  compatibility: 'compatibility',
  localization: 'localization',
  reliability: 'reliability',
  regression: 'regression',
  ai: 'ai',
};

/** Engines that write reports/<name>/summary.json via the engine contract. */
const ENGINE_REPORT_DIRS: Partial<Record<TestTypeCoverageDimensionId, string>> = {
  integration: PATHS.reports.integration,
  contract: PATHS.reports.contract,
  database: PATHS.reports.database,
  localization: PATHS.reports.localization,
  reliability: PATHS.reports.reliability,
  regression: PATHS.reports.regression,
  ai: PATHS.reports.ai,
  // compatibility uses inventory browser kinds + cross-browser evidence, not EngineSummary JSON
};

const NO_EVIDENCE = 'no coverage evidence for this dimension';

export interface TestTypeDimensionInput {
  items: InventoryItem[];
  records: CoverageRecord[];
  config?: QaConfig | null;
  /** Preloaded engine summaries; null means looked up and missing. Omit key to auto-load from disk. */
  engineSummaries?: Partial<Record<TestTypeCoverageDimensionId, EngineSummary | null>>;
  /** When true (default in runCoverage), read summary.json from reports/ for engine dims. */
  loadEngineSummariesFromDisk?: boolean;
  env?: NodeJS.ProcessEnv;
}

function row(
  dimension: TestTypeCoverageDimensionId,
  status: TestTypeDimensionStatus,
  counts: { testable: number; tested: number; failed: number },
  coveragePct: number | null,
  reason?: string
): TestTypeDimensionCoverage {
  return {
    dimension,
    status,
    testable: counts.testable,
    tested: counts.tested,
    failed: counts.failed,
    coveragePct,
    ...(reason ? { reason } : {}),
  };
}

function emptyCounts(): { testable: number; tested: number; failed: number } {
  return { testable: 0, tested: 0, failed: 0 };
}

function measureInventory(
  dimension: TestTypeCoverageDimensionId,
  items: InventoryItem[],
  records: CoverageRecord[]
): TestTypeDimensionCoverage | null {
  const kinds = INVENTORY_KINDS_BY_DIMENSION[dimension];
  if (!kinds) return null;

  const dimItems = items.filter((item) => kinds.includes(item.kind));
  const ids = new Set(dimItems.map((item) => item.id));
  const dimRecords = records.filter((rec) => ids.has(rec.id));
  const testable = dimItems.filter(isTestable);
  if (testable.length === 0) return null;

  const testedIds = new Set(testable.map((item) => item.id));
  const testableRecords = dimRecords.filter((rec) => testedIds.has(rec.id));
  const failed = testableRecords.filter((rec) => rec.status === 'FAILED').length;
  const exercised = testableRecords.filter((rec) => isCoveredStatus(rec.status)).length;

  return row(
    dimension,
    'MEASURED',
    { testable: testable.length, tested: exercised, failed },
    percent(exercised, testable.length)
  );
}

function isDisabledEngineResult(summary: EngineSummary): boolean {
  if (summary.results.length === 0) return false;
  return summary.results.every(
    (r) =>
      r.status === 'NOT_TESTED' &&
      /disabled/i.test(`${r.error?.message ?? ''} ${r.metadata?.reason ?? ''} ${r.name}`)
  );
}

function measureEngineSummary(
  dimension: TestTypeCoverageDimensionId,
  summary: EngineSummary
): TestTypeDimensionCoverage {
  if (isDisabledEngineResult(summary)) {
    return row(dimension, 'NOT_MEASURED', emptyCounts(), null, `${dimension} engine disabled`);
  }

  const pass = summary.passCount;
  const fail = summary.failCount;
  const notTested = summary.notTestedCount;
  const exercised = pass + fail;
  // Denominator: runnable / planned executable surface (PASS+FAIL+NOT_TESTED).
  // BLOCKED / REQUIRES_CONFIGURATION / NOT_APPLICABLE stay out of the inventory-style denominator.
  const testable = pass + fail + notTested;

  if (testable === 0) {
    if (summary.status === 'REQUIRES_CONFIGURATION' || summary.requiresConfigurationCount > 0) {
      return row(
        dimension,
        'REQUIRES_CONFIGURATION',
        emptyCounts(),
        null,
        summary.note ?? `${dimension} requires configuration`
      );
    }
    return row(dimension, 'NOT_MEASURED', emptyCounts(), null, NO_EVIDENCE);
  }

  return row(
    dimension,
    'MEASURED',
    { testable, tested: exercised, failed: fail },
    percent(exercised, testable)
  );
}

function isEngineSummary(value: unknown): value is EngineSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as EngineSummary;
  return (
    Array.isArray(row.results) &&
    typeof row.passCount === 'number' &&
    typeof row.failCount === 'number' &&
    typeof row.notTestedCount === 'number'
  );
}

function readEngineSummary(dir: string): EngineSummary | null {
  const filePath = path.join(dir, 'summary.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isEngineSummary(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveEngineSummary(
  dimension: TestTypeCoverageDimensionId,
  input: TestTypeDimensionInput
): EngineSummary | null | undefined {
  if (input.engineSummaries && Object.prototype.hasOwnProperty.call(input.engineSummaries, dimension)) {
    return input.engineSummaries[dimension] ?? null;
  }
  if (input.loadEngineSummariesFromDisk === false) return undefined;
  const dir = ENGINE_REPORT_DIRS[dimension];
  if (!dir) return undefined;
  return readEngineSummary(dir);
}

function isConfigEnabled(dimension: TestTypeCoverageDimensionId, config: QaConfig | null | undefined): boolean | null {
  if (!config) return null;
  const tests = config.tests;
  switch (dimension) {
    case 'integration':
      return tests?.integration?.enabled ?? false;
    case 'contract':
      return tests?.contract?.enabled ?? false;
    case 'database':
      return tests?.database?.enabled ?? false;
    case 'ai':
      return tests?.ai?.enabled ?? false;
    case 'reliability':
      return tests?.reliability?.enabled ?? false;
    case 'localization':
      return tests?.localization?.enabled ?? true;
    case 'regression':
      return tests?.regression?.enabled ?? true;
    case 'performance':
      return tests?.performance?.enabled ?? config.jmeter?.enabled ?? null;
    case 'api':
      return config.postman?.enabled ?? null;
    case 'ui':
    case 'e2e':
    case 'accessibility':
    case 'visual':
    case 'responsive':
    case 'compatibility':
    case 'functional':
      return config.playwright?.enabled ?? null;
    case 'security':
      return null;
    default:
      return null;
  }
}

function requiresConfigurationWithoutRun(
  dimension: TestTypeCoverageDimensionId,
  config: QaConfig | null | undefined,
  env: NodeJS.ProcessEnv
): string | null {
  if (!config) return null;
  if (dimension === 'database' && (config.tests?.database?.enabled ?? false)) {
    const urlEnv = (config.tests?.database?.urlEnv ?? 'DATABASE_URL').trim() || 'DATABASE_URL';
    if (!env[urlEnv]?.trim()) {
      return `${urlEnv} is not set — database coverage cannot be measured`;
    }
  }
  if (dimension === 'integration' && (config.tests?.integration?.enabled ?? false)) {
    const checks = config.tests?.integration?.checks ?? [];
    if (checks.length === 0) {
      return 'no integration checks configured';
    }
  }
  if (dimension === 'ai' && (config.tests?.ai?.enabled ?? false)) {
    const endpointEnv = (config.tests?.ai?.endpointEnv ?? 'QA_AI_ENDPOINT').trim() || 'QA_AI_ENDPOINT';
    if (!env[endpointEnv]?.trim()) {
      return `${endpointEnv} is not set — AI coverage cannot be measured`;
    }
  }
  return null;
}

function resolveDimension(
  dimension: TestTypeCoverageDimensionId,
  input: TestTypeDimensionInput
): TestTypeDimensionCoverage {
  const registryId = REGISTRY_ID_BY_DIMENSION[dimension];
  const registry = getTestType(registryId);

  // Registry NOT_IMPLEMENTED → dimension NOT_IMPLEMENTED (ai is PARTIAL — never this path).
  if (registry?.status === 'NOT_IMPLEMENTED') {
    return row(
      dimension,
      'NOT_IMPLEMENTED',
      emptyCounts(),
      null,
      registry.note ?? `${dimension} is not implemented`
    );
  }

  const summary = resolveEngineSummary(dimension, input);
  if (summary && isEngineSummary(summary)) {
    return measureEngineSummary(dimension, summary);
  }

  const fromInventory = measureInventory(dimension, input.items, input.records);
  if (fromInventory) return fromInventory;

  const enabled = isConfigEnabled(dimension, input.config);
  if (enabled === false) {
    return row(
      dimension,
      'NOT_MEASURED',
      emptyCounts(),
      null,
      `${dimension} engine disabled in qa.config.json`
    );
  }

  const needsConfig = requiresConfigurationWithoutRun(dimension, input.config, input.env ?? process.env);
  if (needsConfig) {
    return row(dimension, 'REQUIRES_CONFIGURATION', emptyCounts(), null, needsConfig);
  }

  return row(dimension, 'NOT_MEASURED', emptyCounts(), null, NO_EVIDENCE);
}

/**
 * Build the 17 registry-aligned coverage dimensions.
 * Does not invent counts; missing evidence → NOT_MEASURED / REQUIRES_CONFIGURATION / NOT_IMPLEMENTED.
 */
export function calculateTestTypeDimensions(input: TestTypeDimensionInput): TestTypeDimensionCoverage[] {
  return TEST_TYPE_COVERAGE_DIMENSION_IDS.map((dimension) => resolveDimension(dimension, input));
}

/**
 * Overall = arithmetic mean of coveragePct for MEASURED dimensions with a numeric pct.
 * Unmeasured / incomplete dimensions are excluded — never treated as 100.
 */
export function rollupTestTypeCoveragePct(dimensions: TestTypeDimensionCoverage[]): number | null {
  const measured = dimensions.filter(
    (dim) => dim.status === 'MEASURED' && dim.coveragePct != null && dim.testable > 0
  );
  if (measured.length === 0) return null;
  const sum = measured.reduce((acc, dim) => acc + (dim.coveragePct as number), 0);
  const raw = sum / measured.length;
  return Math.round(raw * 10) / 10;
}

/**
 * Build a MEASURED row from inventory-style counts.
 * `testedExercised` = TESTED + FAILED (covered); formula = testedExercised ÷ testable.
 */
export function measureDimensionFromCounts(
  dimension: string,
  testable: number,
  testedExercised: number,
  failed: number
): TestTypeDimensionCoverage {
  if (testable <= 0) {
    return {
      dimension,
      status: 'NOT_MEASURED',
      testable: 0,
      tested: 0,
      failed: 0,
      coveragePct: null,
      reason: NO_EVIDENCE,
    };
  }
  return {
    dimension,
    status: 'MEASURED',
    testable,
    tested: testedExercised,
    failed,
    coveragePct: percent(testedExercised, testable),
  };
}

/** Exported for tests that need to force a NOT_IMPLEMENTED status path. */
export function notImplementedDimension(dimension: string, reason?: string): TestTypeDimensionCoverage {
  return {
    dimension,
    status: 'NOT_IMPLEMENTED',
    testable: 0,
    tested: 0,
    failed: 0,
    coveragePct: null,
    reason: reason ?? `${dimension} is not implemented`,
  };
}
