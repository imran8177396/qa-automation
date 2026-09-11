import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { logStep, logSuccess, logWarn } from './lib/logger';
import { writeJson } from './discovery/write-json';
import { collectFailures } from './failures/collect';
import { classifyFailures, summarizeByClass } from './failures/classify';
import {
  FAILURE_ANALYSIS_DISCLAIMER,
  FAILURE_ANALYSIS_LIMITATIONS,
  FAILURE_ANALYSIS_METADATA,
  toAnalysisFinding,
  type FailureAnalysisSection216,
  type FailureAnalysisSummary,
} from './failures/types';

function toSection216(summary: Omit<FailureAnalysisSummary, 'section216'>): FailureAnalysisSection216 {
  return {
    section: '2.16',
    title: 'Failure Analysis',
    metadata: summary.metadata,
    disclaimer: summary.disclaimer,
    byClass: summary.byClass,
    rows: summary.failures.map((row) => ({
      testId: row.testId,
      classification: row.classification,
      evidenceExcerpt: row.evidenceExcerpt,
      ruleFired: row.ruleFired,
      title: row.title,
      source: row.source,
    })),
  };
}

export function analyzeFailures(): FailureAnalysisSummary {
  const evidence = collectFailures();
  const failures = classifyFailures(evidence);
  const draft: Omit<FailureAnalysisSummary, 'section216'> = {
    generatedAt: new Date().toISOString(),
    analyzed: failures.length,
    totalFailures: failures.length,
    byClass: summarizeByClass(failures),
    failures,
    findings: failures.map(toAnalysisFinding),
    metadata: { ...FAILURE_ANALYSIS_METADATA },
    disclaimer: FAILURE_ANALYSIS_DISCLAIMER,
    limitations: [...FAILURE_ANALYSIS_LIMITATIONS],
  };
  const summary: FailureAnalysisSummary = {
    ...draft,
    section216: toSection216(draft),
  };

  fs.mkdirSync(PATHS.reports.failures, { recursive: true });
  writeJson(path.join(PATHS.reports.failures, 'summary.json'), summary);
  writeJson(path.join(PATHS.reports.failures, 'section-2.16.json'), summary.section216);

  const lines = [
    '# Failure analysis',
    '',
    summary.disclaimer,
    '',
    `Total failures: ${summary.totalFailures}`,
    '',
    '| Class | Count |',
    '| --- | --- |',
    ...Object.entries(summary.byClass)
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `| ${label} | ${count} |`),
    '',
    '| Test ID | Classification | Rule | Evidence excerpt |',
    '| --- | --- | --- | --- |',
    ...summary.failures.map(
      (row) => `| ${row.testId} | ${row.classification} | ${row.ruleFired} | ${row.evidenceExcerpt} |`
    ),
    '',
    'Classifications are evidence-based and are not defect tickets.',
    'Never modify a test merely to make it pass.',
    '',
  ];
  fs.writeFileSync(path.join(PATHS.reports.failures, 'findings.md'), `${lines.join('\n')}\n`, 'utf8');
  return summary;
}

function main(): void {
  logStep('Failure analysis');
  const summary = analyzeFailures();
  if (summary.totalFailures === 0) {
    logSuccess('No failed executions to classify.');
    return;
  }
  logWarn(`${summary.totalFailures} failure(s) classified — see reports/failures/`);
}

if (require.main === module) {
  main();
}
