/** Shared suite / stage statuses. Zero executed items must never resolve to PASS. */
export const SUITE_STATUSES = [
  'PASS',
  'FAIL',
  'PARTIAL',
  'NOT_EXECUTED',
  'INVALID',
  'RECORDED',
  'DRY_RUN',
  'BLOCKED',
] as const;

export type SuiteStatus = (typeof SUITE_STATUSES)[number];

export interface ResolveSuiteStatusInput {
  executedCount: number;
  failedCount?: number;
  passedCount?: number;
  /** Retest documented candidates without running them. */
  dryRun?: boolean;
  selectedCount?: number;
  /** Analysis/retest recorded items without executing tests. */
  recorded?: boolean;
  /** Stage could not launch or produced unusable artifacts. */
  invalid?: boolean;
  /** Child process exited non-zero. */
  processFailed?: boolean;
  /** Required tool or configuration prevented the stage (not an application FAIL). */
  blocked?: boolean;
}

/**
 * Single rule for orchestrator stages and report-generator suites.
 * `executedCount === 0` is never PASS — including dry-run with nothing selected.
 */
export function resolveSuiteStatus(input: ResolveSuiteStatusInput): SuiteStatus {
  if (input.invalid) return 'INVALID';
  if (input.blocked) return 'BLOCKED';

  const executedCount = Number.isFinite(input.executedCount) ? input.executedCount : 0;
  if (executedCount <= 0) {
    if (input.processFailed) return 'FAIL';
    if (input.dryRun && (input.selectedCount ?? 0) > 0) return 'DRY_RUN';
    if (input.recorded && (input.selectedCount ?? 0) > 0) return 'RECORDED';
    return 'NOT_EXECUTED';
  }

  const failedCount = input.failedCount ?? 0;
  const passedCount = input.passedCount ?? Math.max(0, executedCount - failedCount);
  if (failedCount > 0 && passedCount > 0) return 'PARTIAL';
  if (failedCount > 0 || input.processFailed) return 'FAIL';
  return 'PASS';
}

export interface StageGroupInput {
  name: string;
  status: string;
}

export interface StageGroupRollup {
  passed: string[];
  failed: string[];
  notExecuted: string[];
}

const FAILED_GROUP = new Set(['FAIL', 'INVALID', 'PARTIAL', 'ERROR']);
const PASSED_GROUP = new Set(['PASS']);

/**
 * Layer 1 stage rollup: three groups. NOT_EXECUTED / DRY_RUN / RECORDED / BLOCKED never count as passed.
 */
export function rollupStageGroups(stages: StageGroupInput[]): StageGroupRollup {
  const passed: string[] = [];
  const failed: string[] = [];
  const notExecuted: string[] = [];

  for (const stage of stages) {
    const status = stage.status.trim().toUpperCase();
    if (PASSED_GROUP.has(status)) passed.push(stage.name);
    else if (FAILED_GROUP.has(status)) failed.push(stage.name);
    else notExecuted.push(stage.name);
  }

  return { passed, failed, notExecuted };
}

export function isSuiteStatus(value: string): value is SuiteStatus {
  return (SUITE_STATUSES as readonly string[]).includes(value);
}
