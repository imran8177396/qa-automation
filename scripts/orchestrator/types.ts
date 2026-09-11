import { SUITE_STATUSES, type SuiteStatus } from '../lib/suite-status';
import type { StagePhase } from '../lib/stage-timeline';

export const STAGE_STATUSES = SUITE_STATUSES;
export type StageStatus = SuiteStatus;

export interface StageDefinition {
  id: number;
  key: string;
  name: string;
  script: string | null;
  phase: StagePhase;
  args?: string[];
  skip?: (ctx: OrchestratorContext) => string | null;
  /**
   * Stages sharing the same parallelGroup value, when adjacent in the stage
   * list, are launched concurrently instead of one-after-another. Only set
   * this on stages that are read-only against the target and don't consume
   * a shared browser/JVM resource — see run-all.ts's batching logic.
   */
  parallelGroup?: string;
}

export interface StageResult {
  id: number;
  key: string;
  name: string;
  status: StageStatus;
  exitCode: number | null;
  startedAt: string;
  /** @deprecated Use completedAt — kept in sync for existing readers. */
  finishedAt: string;
  completedAt: string;
  durationMs: number;
  reason?: string;
  command?: string;
  executedCount?: number;
}

export interface OrchestratorContext {
  url: string;
  failFast: boolean;
  extraArgs: string[];
  playwrightEnabled: boolean;
  postmanEnabled: boolean;
  jmeterEnabled: boolean;
  discoveryEnabled: boolean;
  dependenciesEnabled: boolean;
  securityEnabled: boolean;
  seoEnabled: boolean;
  contentEnabled: boolean;
  failureAnalysisEnabled: boolean;
  retestEnabled: boolean;
  reportEnabled: boolean;
  exhaustiveExecution: boolean;
}

export interface OrchestratorSummary {
  generatedAt: string;
  command: string;
  url: string;
  failFast: boolean;
  stages: StageResult[];
  failed: string[];
  skipped: string[];
  passed: string[];
  notExecuted: string[];
  overallStatus: 'PASS' | 'FAIL';
  exitCode: number;
  orderingValid: boolean;
  orderingViolations: string[];
}

export const ORCHESTRATOR_DISCLAIMER =
  'qa:all runs every stage as a child process and records every exit code. A failed stage does not stop later stages unless --fail-fast is set. The professional SQA report stage still runs at the end after --fail-fast. Passing generated tests alone does not mean complete testing — see coverage and uncovered-test-items.md. Exhaustive execution: runnable tests, scenarios, and UI checks are not silently skipped; safety-blocked or unconfigurable items are recorded as BLOCKED / NOT_TESTED / REQUIRES_CONFIGURATION.';

export const COMPLETE_TESTING_NOTE =
  'Complete testing means every testable discovered item has execution evidence or an explicit BLOCKED / NOT_TESTED / REQUIRES_CONFIGURATION / UNTESTABLE reason. Pass rate alone is not coverage. qa:all must not silently skip runnable tests, scenarios, or UI execution.';
