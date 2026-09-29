/**
 * Stable 11-phase orchestrator flow for qa:all.
 * Maps onto existing child stages — does not spawn a second pipeline or run-all.
 * Conceptual stage graph (does not replace this map): ./architecture.ts
 */
import fs from 'fs';
import path from 'path';
import {
  buildEngineSummary,
  type EngineSummary,
  type TestResult,
} from '../core/engine-contract';
import { PATHS } from '../lib/paths';
import type { TestsConfig } from '../types';
import type { QualityGateResult } from './quality-gate';

export const ORCHESTRATOR_PHASE_NAMES = [
  'DISCOVER',
  'INVENTORY',
  'PLAN',
  'SELECT ENABLED TEST ENGINES',
  'EXECUTE',
  'NORMALIZE RESULTS',
  'ASSERTIONS',
  'COVERAGE',
  'FAILURE ANALYSIS',
  'RETEST',
  'REPORT',
] as const;

export type OrchestratorPhaseName = (typeof ORCHESTRATOR_PHASE_NAMES)[number];

/** Default qa:all execute engines — stay selected; never turned off by this module. */
export const PIPELINE_EXECUTE_STAGE_KEYS = [
  'e2e',
  'visual',
  'responsive',
  'cross-browser',
  'accessibility',
  'api',
  'performance',
  'security',
  'seo',
  'content',
  'workflows',
] as const;

/**
 * Newer opt-in engines gated by qa.config.json tests.<id>.enabled.
 * Included in EXECUTE only when enabled === true and a runner script exists.
 */
export const OPT_IN_ENGINE_DEFS = [
  {
    id: 'integration',
    key: 'integration',
    name: 'Integration tests',
    script: 'scripts/testing/run-integration-tests.ts',
  },
  {
    id: 'contract',
    key: 'contract',
    name: 'Contract tests',
    script: 'scripts/testing/run-contract-tests.ts',
  },
  {
    id: 'database',
    key: 'database',
    name: 'Database tests',
    script: 'scripts/testing/run-database-tests.ts',
  },
  {
    id: 'smoke',
    key: 'smoke',
    name: 'Smoke tests',
    script: 'scripts/testing/run-smoke-tests.ts',
  },
  {
    id: 'sanity',
    key: 'sanity',
    name: 'Sanity tests',
    script: 'scripts/testing/run-sanity-tests.ts',
  },
  {
    id: 'regression',
    key: 'regression',
    name: 'Regression tests',
    script: 'scripts/testing/run-regression.ts',
  },
  {
    id: 'reliability',
    key: 'reliability',
    name: 'Reliability tests',
    script: 'scripts/testing/run-reliability.ts',
  },
  {
    id: 'resilience',
    key: 'resilience',
    name: 'Resilience tests',
    script: 'scripts/testing/run-resilience.ts',
  },
  {
    id: 'deployment',
    key: 'deployment',
    name: 'Deployment tests',
    script: 'scripts/testing/run-deployment.ts',
  },
  {
    id: 'localization',
    key: 'localization',
    name: 'Localization tests',
    script: 'scripts/testing/run-localization.ts',
  },
  {
    id: 'ai',
    key: 'ai',
    name: 'AI tests',
    script: 'scripts/testing/ai/run-ai-tests.ts',
  },
  {
    id: 'productionVerification',
    key: 'productionVerification',
    name: 'Production verification',
    script: 'scripts/testing/run-production-verification.ts',
  },
] as const;

export type OptInEngineId = (typeof OPT_IN_ENGINE_DEFS)[number]['id'];

export const OPT_IN_EXECUTION_STAGE_KEYS = OPT_IN_ENGINE_DEFS.map((row) => row.key);

export interface EngineSelectionEntry {
  engineId: string;
  stageKey: string;
  selected: boolean;
  reason: string;
  script: string | null;
  source: 'pipeline' | 'opt-in';
}

export interface EngineSelectionRecord {
  generatedAt: string;
  engines: EngineSelectionEntry[];
  selectedStageKeys: string[];
  notSelectedStageKeys: string[];
}

export interface OrchestratorPhaseDescriptor {
  name: OrchestratorPhaseName;
  stageKeys: string[];
  realization: 'child-stages' | 'in-process' | 'mixed';
  notes: string;
}

export interface InventoryPhaseRecord {
  phase: 'INVENTORY';
  artifactPath: string | null;
  status: 'RECORDED' | 'NOT_TESTED';
  reason: string;
}

export interface NormalizeResultsRecord {
  phase: 'NORMALIZE RESULTS';
  summaries: EngineSummary[];
  missing: Array<{ engine: string; path: string; reason: string }>;
  note: string;
}

export interface AssertionsPhaseRecord {
  phase: 'ASSERTIONS';
  note: string;
  enginesWithResults: number;
  failCount: number;
  qualityGateStatus: QualityGateResult['status'] | 'NOT_EVALUATED_YET';
  qualityGateReasons: Array<{ code: string; detail: string }>;
}

export interface OrchestratorPhasePlan {
  generatedAt: string;
  command: 'qa:all';
  phases: OrchestratorPhaseDescriptor[];
  phaseNames: OrchestratorPhaseName[];
  selection: EngineSelectionRecord;
  inventory: InventoryPhaseRecord;
  /** Child-stage keys that belong in the EXECUTE spawn list (pipeline + selected opt-ins). */
  executeStageKeys: string[];
  executeCommands: Array<{ key: string; script: string; name: string }>;
}

function isOptInEnabled(tests: TestsConfig | undefined, id: OptInEngineId): boolean {
  if (!tests) return false;
  const slice = tests[id as keyof TestsConfig] as { enabled?: boolean } | undefined;
  return slice?.enabled === true;
}

export function orchestratorPhaseForStageKey(key: string): OrchestratorPhaseName {
  if (key === 'preflight' || key === 'dependencies' || key === 'discovery') return 'DISCOVER';
  if (key === 'inventory') return 'INVENTORY';
  if (key === 'coverage-planning') return 'PLAN';
  if (key === 'select-engines') return 'SELECT ENABLED TEST ENGINES';
  if (
    (PIPELINE_EXECUTE_STAGE_KEYS as readonly string[]).includes(key) ||
    (OPT_IN_EXECUTION_STAGE_KEYS as readonly string[]).includes(key)
  ) {
    return 'EXECUTE';
  }
  if (key === 'collect' || key === 'normalize-results') return 'NORMALIZE RESULTS';
  if (key === 'assertions') return 'ASSERTIONS';
  if (key === 'coverage') return 'COVERAGE';
  if (key === 'analyze') return 'FAILURE ANALYSIS';
  if (key === 'retest') return 'RETEST';
  if (key === 'allure' || key === 'playwright-reports' || key === 'report') return 'REPORT';
  return 'REPORT';
}

export function selectEnabledTestEngines(tests?: TestsConfig): EngineSelectionRecord {
  const engines: EngineSelectionEntry[] = [];

  for (const key of PIPELINE_EXECUTE_STAGE_KEYS) {
    engines.push({
      engineId: key,
      stageKey: key,
      selected: true,
      reason: 'default qa:all pipeline stage',
      script: null,
      source: 'pipeline',
    });
  }

  for (const def of OPT_IN_ENGINE_DEFS) {
    const enabled = isOptInEnabled(tests, def.id);
    engines.push({
      engineId: def.id,
      stageKey: def.key,
      selected: enabled,
      reason: enabled
        ? `tests.${def.id}.enabled is true`
        : `tests.${def.id}.enabled is false — not selected`,
      script: enabled ? def.script : null,
      source: 'opt-in',
    });
  }

  const selectedStageKeys = engines.filter((row) => row.selected).map((row) => row.stageKey);
  const notSelectedStageKeys = engines.filter((row) => !row.selected).map((row) => row.stageKey);

  return {
    generatedAt: new Date().toISOString(),
    engines,
    selectedStageKeys,
    notSelectedStageKeys,
  };
}

export function selectedOptInEngineDefs(tests?: TestsConfig): Array<(typeof OPT_IN_ENGINE_DEFS)[number]> {
  return OPT_IN_ENGINE_DEFS.filter((def) => isOptInEnabled(tests, def.id));
}

export function recordInventoryPhase(options?: {
  inventoryPath?: string;
  discoveryRan?: boolean;
}): InventoryPhaseRecord {
  const artifactPath = options?.inventoryPath ?? PATHS.inventoryFile;
  const exists = fs.existsSync(artifactPath);
  if (exists) {
    return {
      phase: 'INVENTORY',
      artifactPath: path.relative(PATHS.root, artifactPath).replace(/\\/g, '/'),
      status: 'RECORDED',
      reason: 'Inventory artifact present on disk',
    };
  }
  return {
    phase: 'INVENTORY',
    artifactPath: null,
    status: 'NOT_TESTED',
    reason:
      options?.discoveryRan === false
        ? 'inventory artifact not produced'
        : 'inventory artifact not produced',
  };
}

function optInReportDir(engineId: string): string | null {
  const reports = PATHS.reports as Record<string, string>;
  if (engineId === 'productionVerification') return PATHS.reports.productionVerification;
  return reports[engineId] ?? null;
}

/**
 * NORMALIZE RESULTS — rebuild EngineSummary from on-disk results via engine-contract.
 * Does not re-run tests. Missing artifacts are listed, never fabricated.
 */
export function normalizeExistingEngineResults(selection?: EngineSelectionRecord): NormalizeResultsRecord {
  const missing: NormalizeResultsRecord['missing'] = [];
  const summaries: EngineSummary[] = [];
  const candidates =
    selection?.engines.filter((row) => row.selected && row.source === 'opt-in').map((row) => row.engineId) ??
    OPT_IN_ENGINE_DEFS.map((row) => row.id);

  for (const engineId of candidates) {
    const dir = optInReportDir(engineId);
    if (!dir) {
      missing.push({
        engine: engineId,
        path: `reports/${engineId}/summary.json`,
        reason: 'No report directory mapped for engine',
      });
      continue;
    }
    const summaryPath = path.join(dir, 'summary.json');
    if (!fs.existsSync(summaryPath)) {
      missing.push({
        engine: engineId,
        path: path.relative(PATHS.root, summaryPath).replace(/\\/g, '/'),
        reason: 'Engine summary not present — not fabricated',
      });
      continue;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as {
        engine?: string;
        testType?: string;
        results?: TestResult[];
        note?: string;
        limitations?: string[];
      };
      const results = Array.isArray(raw.results) ? raw.results : [];
      summaries.push(
        buildEngineSummary({
          engine: raw.engine ?? engineId,
          testType: raw.testType ?? engineId,
          results,
          ...(raw.note ? { note: raw.note } : {}),
          ...(raw.limitations ? { limitations: raw.limitations } : {}),
        })
      );
    } catch {
      missing.push({
        engine: engineId,
        path: path.relative(PATHS.root, summaryPath).replace(/\\/g, '/'),
        reason: 'Engine summary unreadable — left unnormalized',
      });
    }
  }

  return {
    phase: 'NORMALIZE RESULTS',
    summaries,
    missing,
    note: 'Normalized via scripts/core/engine-contract buildEngineSummary — no re-execution',
  };
}

/**
 * ASSERTIONS — records that engines already evaluated assertions.
 * Maps the existing quality gate when provided; never flips FAIL → PASS.
 */
export function recordAssertionsPhase(input: {
  normalized?: NormalizeResultsRecord | null;
  qualityGate?: QualityGateResult | null;
}): AssertionsPhaseRecord {
  const summaries = input.normalized?.summaries ?? [];
  const failCount = summaries.reduce((sum, row) => sum + row.failCount, 0);
  return {
    phase: 'ASSERTIONS',
    note: 'Assertion evaluation already happened inside engines; this phase records that fact. Quality gate is mapped, not re-authored.',
    enginesWithResults: summaries.length,
    failCount,
    qualityGateStatus: input.qualityGate?.status ?? 'NOT_EVALUATED_YET',
    qualityGateReasons: input.qualityGate?.reasons ?? [],
  };
}

export function buildOrchestratorPhasePlan(input?: {
  tests?: TestsConfig;
  discoveryRan?: boolean;
}): OrchestratorPhasePlan {
  const selection = selectEnabledTestEngines(input?.tests);
  const inventory = recordInventoryPhase({ discoveryRan: input?.discoveryRan });
  const selectedOptIns = selectedOptInEngineDefs(input?.tests);

  const executeStageKeys = [
    ...PIPELINE_EXECUTE_STAGE_KEYS,
    ...selectedOptIns.map((row) => row.key),
  ];

  const pipelineScripts: Record<(typeof PIPELINE_EXECUTE_STAGE_KEYS)[number], string> = {
    e2e: 'scripts/run-playwright-e2e.ts',
    visual: 'scripts/run-visual.ts',
    responsive: 'scripts/run-responsive.ts',
    'cross-browser': 'scripts/run-cross-browser.ts',
    accessibility: 'scripts/run-accessibility.ts',
    api: 'scripts/run-api.ts',
    performance: 'scripts/run-performance.ts',
    security: 'scripts/run-security.ts',
    seo: 'scripts/run-seo.ts',
    content: 'scripts/run-content.ts',
    workflows: 'scripts/run-workflows.ts',
  };

  const executeCommands = [
    ...PIPELINE_EXECUTE_STAGE_KEYS.map((key) => ({
      key,
      script: pipelineScripts[key],
      name: key,
    })),
    ...selectedOptIns.map((row) => ({
      key: row.key,
      script: row.script,
      name: row.name,
    })),
  ];

  const phases: OrchestratorPhaseDescriptor[] = [
    {
      name: 'DISCOVER',
      stageKeys: ['preflight', 'dependencies', 'discovery'],
      realization: 'child-stages',
      notes: 'Preflight + dependencies + discovery child stages.',
    },
    {
      name: 'INVENTORY',
      stageKeys: ['inventory'],
      realization: 'child-stages',
      notes: inventory.reason,
    },
    {
      name: 'PLAN',
      stageKeys: ['coverage-planning'],
      realization: 'child-stages',
      notes: 'Coverage planning / classify+generate via write-planned-checks.',
    },
    {
      name: 'SELECT ENABLED TEST ENGINES',
      stageKeys: [],
      realization: 'in-process',
      notes: 'Pure selection from pipeline defaults + tests.*.enabled — no execution.',
    },
    {
      name: 'EXECUTE',
      stageKeys: executeStageKeys,
      realization: 'child-stages',
      notes: 'Selected pipeline + opt-in engines only.',
    },
    {
      name: 'NORMALIZE RESULTS',
      stageKeys: ['collect'],
      realization: 'mixed',
      notes: 'In-process collect + engine-contract summary normalization.',
    },
    {
      name: 'ASSERTIONS',
      stageKeys: [],
      realization: 'in-process',
      notes: 'Records engine assertions + maps existing quality gate; never flips FAIL to PASS.',
    },
    {
      name: 'COVERAGE',
      stageKeys: ['coverage'],
      realization: 'child-stages',
      notes: 'Existing coverage command — inventory formula, not pass rate.',
    },
    {
      name: 'FAILURE ANALYSIS',
      stageKeys: ['analyze'],
      realization: 'child-stages',
      notes: 'scripts/analyze-failures.ts',
    },
    {
      name: 'RETEST',
      stageKeys: ['retest'],
      realization: 'child-stages',
      notes: 'Existing retest — preserves original FAIL; not regression.',
    },
    {
      name: 'REPORT',
      stageKeys: ['allure', 'playwright-reports', 'report'],
      realization: 'child-stages',
      notes: 'Allure, Playwright HTML index, final QA summary.',
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    command: 'qa:all',
    phases,
    phaseNames: [...ORCHESTRATOR_PHASE_NAMES],
    selection,
    inventory,
    executeStageKeys: [...executeStageKeys],
    executeCommands,
  };
}

export function formatOrchestratorPhasesHeader(plan?: OrchestratorPhasePlan): string {
  const resolved = plan ?? buildOrchestratorPhasePlan();
  const width = Math.max(...ORCHESTRATOR_PHASE_NAMES.map((name) => name.length));
  const lines = resolved.phases.map((phase, index) => {
    const label = `${index + 1}. ${phase.name}`.padEnd(width + 4);
    const target =
      phase.stageKeys.length > 0
        ? `${phase.realization} → ${phase.stageKeys.join(', ')}`
        : `${phase.realization}`;
    return `  ${label}  ${target}`;
  });
  return [
    'Orchestrator phases (11) → existing qa:all stages (no second runner)',
    ...lines,
    '',
    'Opt-in engines with enabled:false stay in the selection record as not selected.',
  ].join('\n');
}
