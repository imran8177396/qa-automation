import type { CoverageReport } from '../coverage/types';

export type FinalVerdict = 'PASS' | 'PASS WITH OBSERVATIONS' | 'FAIL' | 'BLOCKED';

export interface OrchestratorSummaryLite {
  exitCode?: number;
  failed?: string[];
  passed?: string[];
  skipped?: string[];
  notExecuted?: string[];
}

export function computeFinalVerdict(input: {
  coverage: CoverageReport;
  orchestrator: OrchestratorSummaryLite | null;
  releaseBlockers: Array<'P0' | 'P1' | 'P2' | 'P3'>;
}): FinalVerdict {
  const blockers = input.releaseBlockers.filter((severity) => severity === 'P0' || severity === 'P1');
  if (blockers.length > 0) return 'FAIL';
  if (input.orchestrator?.failed && input.orchestrator.failed.length > 0) return 'FAIL';
  if (input.coverage.totals.testableItems > 0 && input.coverage.totals.itemCoveragePercent < 100) {
    return input.orchestrator?.exitCode === 0 ? 'BLOCKED' : 'FAIL';
  }
  if (input.coverage.totals.byStatus.FAILED > 0) return 'FAIL';
  const observations =
    input.coverage.totals.byStatus.BLOCKED > 0 ||
    input.coverage.totals.byStatus.SKIPPED > 0 ||
    input.coverage.totals.byStatus.UNTESTABLE > 0;
  return observations ? 'PASS WITH OBSERVATIONS' : 'PASS';
}
