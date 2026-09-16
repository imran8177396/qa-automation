import { PATHS } from './lib/paths';
import { logStep, logSuccess, logWarn } from './lib/logger';
import { collectFailuresWithScans } from './failures/collect';
import { buildFailureAnalysisSummary, writeFailureAnalysisReports } from './failures/report';
import { emptyOwnerCounts } from './failures/owner';
import type { FailureAnalysisSummary, OwnerFailureClass } from './failures/types';

export function analyzeFailures(): FailureAnalysisSummary {
  const { evidence, scans } = collectFailuresWithScans();
  const summary = buildFailureAnalysisSummary(evidence, scans);
  writeFailureAnalysisReports(summary, PATHS.reports.failures);
  return summary;
}

function main(): void {
  logStep('Failure analysis');
  const summary = analyzeFailures();
  if (summary.totalFailures === 0) {
    logSuccess('No failed executions to classify (NOTHING_TO_ANALYZE).');
    return;
  }
  const byOwner = summary.byOwnerClass ?? emptyOwnerCounts();
  const ownerSummary = (Object.entries(byOwner) as Array<[OwnerFailureClass, number]>)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label}=${count}`)
    .join(', ');
  logWarn(
    `${summary.totalFailures} failure(s) classified (${ownerSummary || 'see report'}) — original FAIL preserved. See reports/failures/`
  );
}

if (require.main === module) {
  main();
}
