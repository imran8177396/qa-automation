/**
 * Conceptual QA Engine architecture stage graph.
 *
 * Ordered map of existing modules — does not spawn stages, replace run-all.ts,
 * or change the live 11-phase flow in phases.ts / buildStages().
 */
export const ARCHITECTURE_STATUS = 'PARTIAL' as const;

export type ArchitectureStageStatus =
  | 'IMPLEMENTED'
  | 'PARTIAL'
  | 'NOT_IMPLEMENTED'
  | 'NOT_WIRED';

export type ArchitectureStageId =
  | 'project-context'
  | 'environment-manager'
  | 'discovery'
  | 'planning'
  | 'change-risk-analysis'
  | 'test-selection'
  | 'dependency-resolver'
  | 'test-orchestrator'
  | 'engines-ui-api'
  | 'engines-db-contract'
  | 'engines-ai'
  | 'engines-security'
  | 'engines-performance'
  | 'engines-reliability'
  | 'result-normalizer'
  | 'retry-flaky'
  | 'coverage'
  | 'quality-gates'
  | 'failure-analysis'
  | 'retest'
  | 'reporting'
  | 'history-analytics';

export interface ArchitectureStage {
  id: ArchitectureStageId;
  title: string;
  /** Repo-relative path that exists on disk. */
  module: string;
  wiredIntoQaAll: boolean;
  status: ArchitectureStageStatus;
  note: string;
}

/** Exact id order for the conceptual QA ENGINE diagram (top → bottom). */
export const QA_ARCHITECTURE_STAGE_IDS = [
  'project-context',
  'environment-manager',
  'discovery',
  'planning',
  'change-risk-analysis',
  'test-selection',
  'dependency-resolver',
  'test-orchestrator',
  'engines-ui-api',
  'engines-db-contract',
  'engines-ai',
  'engines-security',
  'engines-performance',
  'engines-reliability',
  'result-normalizer',
  'retry-flaky',
  'coverage',
  'quality-gates',
  'failure-analysis',
  'retest',
  'reporting',
  'history-analytics',
] as const satisfies readonly ArchitectureStageId[];

export const QA_ARCHITECTURE_STAGES: readonly ArchitectureStage[] = [
  {
    id: 'project-context',
    title: 'Project Context',
    module: 'scripts/core/platform/project-context.ts',
    wiredIntoQaAll: false,
    status: 'PARTIAL',
    note: 'library only; qa:all does not call setCurrentExecutionContext / createExecutionContext',
  },
  {
    id: 'environment-manager',
    title: 'Environment Manager',
    module: 'scripts/core/platform/environment.ts',
    wiredIntoQaAll: false,
    status: 'PARTIAL',
    note: 'ENVIRONMENT_MANAGEMENT_STATUS PARTIAL; library only; qa:all does not call it as a stage (resolve-url may use resolveEnvironmentEndpoints)',
  },
  {
    id: 'discovery',
    title: 'Discovery',
    module: 'scripts/discovery/',
    wiredIntoQaAll: true,
    status: 'IMPLEMENTED',
    note: 'qa:all runs discovery via scripts/discover.ts → scripts/discovery/',
  },
  {
    id: 'planning',
    title: 'Planning',
    module: 'scripts/orchestrator/phases.ts',
    wiredIntoQaAll: true,
    status: 'IMPLEMENTED',
    note: '11 phase names in phases.ts; coverage-planning child writes planned checks — conceptual graph does not replace them',
  },
  {
    id: 'change-risk-analysis',
    title: 'Change / Risk Analysis',
    module: 'scripts/core/platform/risk.ts',
    wiredIntoQaAll: false,
    status: 'PARTIAL',
    note: 'RISK_PRIORITIZATION_STATUS PARTIAL (analyzeChangeImpact, priority profiles); library only; qa:all does not call it',
  },
  {
    id: 'test-selection',
    title: 'Test Selection',
    module: 'scripts/cli/execution-mode.ts',
    wiredIntoQaAll: false,
    status: 'PARTIAL',
    note: 'execution-mode plans npm run qa modes; qa:all uses fixed stages + phases selectedOptInEngineDefs — library only; qa:all does not call resolveExecutionMode',
  },
  {
    id: 'dependency-resolver',
    title: 'Dependency Resolver',
    module: 'scripts/orchestrator/test-dependencies.ts',
    wiredIntoQaAll: false,
    status: 'PARTIAL',
    note: 'executeDependentPlan + platform dependencies graph; library only; qa:all does not call it (npm audit stage is unrelated)',
  },
  {
    id: 'test-orchestrator',
    title: 'Test Orchestrator',
    module: 'scripts/run-all.ts',
    wiredIntoQaAll: true,
    status: 'IMPLEMENTED',
    note: 'the orchestrator IS run-all; this graph does not replace it — live pipeline remains the existing 11 phases in phases.ts',
  },
  {
    id: 'engines-ui-api',
    title: 'Engines: UI / API',
    module: 'scripts/core/platform/adapters.ts',
    wiredIntoQaAll: true,
    status: 'IMPLEMENTED',
    note: 'Playwright (test:e2e) + Postman (test:api) via run-playwright-e2e / run-api; desktop Chromium/Firefox/WebKit only; no fake results',
  },
  {
    id: 'engines-db-contract',
    title: 'Engines: DB / Contract',
    module: 'scripts/core/platform/adapters.ts',
    wiredIntoQaAll: false,
    status: 'PARTIAL',
    note: 'tests.database / tests.contract disabled by default; database adapter does not open a DB connection; library only; qa:all does not call them unless enabled',
  },
  {
    id: 'engines-ai',
    title: 'Engines: AI',
    module: 'scripts/testing/ai/run-ai-tests.ts',
    wiredIntoQaAll: false,
    status: 'PARTIAL',
    note: 'registry AI status PARTIAL; tests.ai.enabled false; adapter probes BLOCKED (not implemented); library only; qa:all does not call it',
  },
  {
    id: 'engines-security',
    title: 'Engines: Security',
    module: 'scripts/run-security.ts',
    wiredIntoQaAll: true,
    status: 'IMPLEMENTED',
    note: 'qa:all runs security child stage (scripts/run-security.ts); QA-level checks, not a pentest',
  },
  {
    id: 'engines-performance',
    title: 'Engines: Performance',
    module: 'scripts/run-performance.ts',
    wiredIntoQaAll: true,
    status: 'IMPLEMENTED',
    note: 'qa:all runs performance liveness/smoke only; heavy JMeter profiles are NOT part of the default run (authorize-heavy gated)',
  },
  {
    id: 'engines-reliability',
    title: 'Engines: Reliability',
    module: 'scripts/testing/run-reliability.ts',
    wiredIntoQaAll: false,
    status: 'PARTIAL',
    note: 'registry reliability PARTIAL; tests.reliability.enabled false; safe GET probes only; library only; qa:all does not call it',
  },
  {
    id: 'result-normalizer',
    title: 'Result Normalizer',
    module: 'scripts/core/engine-contract.ts',
    wiredIntoQaAll: true,
    status: 'IMPLEMENTED',
    note: 'makeResult + collect-engine-results.ts feed reports; executionLog and reports/evidence artifacts attach here — not separate graph stages',
  },
  {
    id: 'retry-flaky',
    title: 'Retry / Flaky',
    module: 'scripts/core/platform/flaky.ts',
    wiredIntoQaAll: false,
    status: 'PARTIAL',
    note: 'FLAKY_DETECTION_STATUS PARTIAL; retry defaults disabled; library only; qa:all does not call it (retest.ts is a separate stage)',
  },
  {
    id: 'coverage',
    title: 'Coverage',
    module: 'scripts/coverage/',
    wiredIntoQaAll: true,
    status: 'IMPLEMENTED',
    note: 'qa:all runs coverage child (scripts/coverage.ts → scripts/coverage/)',
  },
  {
    id: 'quality-gates',
    title: 'Quality Gates',
    module: 'scripts/orchestrator/quality-gate.ts',
    wiredIntoQaAll: true,
    status: 'PARTIAL',
    note: 'QUALITY_GATE_PLATFORM_STATUS PARTIAL; qualityGates.enabled false — gate is computed in run-all but does not block releases by itself',
  },
  {
    id: 'failure-analysis',
    title: 'Failure Analysis',
    module: 'scripts/analyze-failures.ts',
    wiredIntoQaAll: true,
    status: 'IMPLEMENTED',
    note: 'qa:all runs analyze-failures child stage',
  },
  {
    id: 'retest',
    title: 'Retest',
    module: 'scripts/retest.ts',
    wiredIntoQaAll: true,
    status: 'IMPLEMENTED',
    note: 'qa:all runs retest child (--automation-only); preserves original FAIL records',
  },
  {
    id: 'reporting',
    title: 'Reporting',
    module: 'scripts/reporting/',
    wiredIntoQaAll: true,
    status: 'IMPLEMENTED',
    note: 'qa:all runs allure / playwright-reports / final report; enterprise model under scripts/lib/qa-report/',
  },
  {
    id: 'history-analytics',
    title: 'History / Analytics',
    module: 'scripts/core/platform/history.ts',
    wiredIntoQaAll: false,
    status: 'PARTIAL',
    note: 'EXECUTION_HISTORY_STATUS PARTIAL; file history via execution-history.ts, no external database; library only; qa:all does not call appendRunRecord (PKT pack archive is execution-archive, not this module)',
  },
] as const;

/**
 * Throws if `stages` ids are not exactly QA_ARCHITECTURE_STAGE_IDS in order
 * (no missing, extra, or duplicate ids).
 */
export function assertArchitectureOrder(
  stages: readonly { id: string }[] = QA_ARCHITECTURE_STAGES
): void {
  const expected = QA_ARCHITECTURE_STAGE_IDS as readonly string[];
  if (stages.length !== expected.length) {
    throw new Error(
      `architecture order length ${stages.length} !== expected ${expected.length}`
    );
  }
  const seen = new Set<string>();
  for (let i = 0; i < expected.length; i += 1) {
    const id = stages[i]?.id;
    if (id !== expected[i]) {
      throw new Error(
        `architecture order mismatch at index ${i}: got ${JSON.stringify(id)}, expected ${JSON.stringify(expected[i])}`
      );
    }
    if (seen.has(id)) {
      throw new Error(`architecture duplicate id: ${JSON.stringify(id)}`);
    }
    seen.add(id);
  }
}

export function architectureSummary(): {
  status: typeof ARCHITECTURE_STATUS;
  stageCount: number;
  wiredCount: number;
  notWiredOrPartialCount: number;
} {
  const stageCount = QA_ARCHITECTURE_STAGES.length;
  /** Fully wired into qa:all today (exists + called + IMPLEMENTED). */
  const wiredCount = QA_ARCHITECTURE_STAGES.filter(
    (s) => s.wiredIntoQaAll && s.status === 'IMPLEMENTED'
  ).length;
  /** Not called by qa:all, or still PARTIAL / NOT_WIRED / NOT_IMPLEMENTED. */
  const notWiredOrPartialCount = QA_ARCHITECTURE_STAGES.filter(
    (s) => !s.wiredIntoQaAll || s.status !== 'IMPLEMENTED'
  ).length;
  return {
    status: ARCHITECTURE_STATUS,
    stageCount,
    wiredCount,
    notWiredOrPartialCount,
  };
}
