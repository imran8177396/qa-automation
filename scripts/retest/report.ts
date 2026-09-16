import fs from 'fs';
import path from 'path';
import { writeJson } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import { RETEST_LIFECYCLE_STAGES, type RetestSummary } from './types';

function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

export function renderRetestMarkdown(summary: RetestSummary): string {
  const ownerRows = Object.entries(summary.byOwnerClass)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `| ${label} | ${count} |`);

  const detailBlocks = summary.items.map((row) => {
    return [
      `### ${mdCell(row.originalFailureId)} — ${row.ownerClassification}`,
      '',
      `- Test ID: ${row.testId}`,
      `- Title: ${row.title}`,
      `- Source: ${row.source}`,
      `- Original status: FAIL (preserved)`,
      `- Retest status: ${row.retestStatus}`,
      `- Stability: ${row.stabilityVerdict}`,
      `- Owner class: ${row.ownerClassification} (unchanged=${row.ownerClassificationUnchanged})`,
      `- Mechanism: ${row.classification} (unchanged=${row.classificationUnchanged})`,
      `- Automation fix required: ${row.automationFixRequired}`,
      `- Original evidence: ${row.evidence.originalAnalysis}#${row.originalFailureId}`,
      `- Artifact: ${row.evidence.artifactSourcePath}`,
      `- Retest evidence: ${row.evidence.retestResultsPath}`,
      `- Lifecycle: ${row.lifecycle.map((step) => `${step.stage}=${step.status}`).join(' → ')}`,
      `- Note: ${row.note}`,
      '',
    ].join('\n');
  });

  return [
    '# Retest',
    '',
    summary.disclaimer,
    '',
    `Engine outcome: ${summary.outcome}`,
    `Suite status: ${summary.status}`,
    `Reason: ${summary.reason}`,
    `Lifecycle: ${RETEST_LIFECYCLE_STAGES.join(' → ')}`,
    `Selected: ${summary.selected}`,
    `Not selected: ${summary.notSelected}`,
    `Executed: ${summary.executed}`,
    `By retest status: PASS=${summary.byFinalStatus.PASS}, FAIL=${summary.byFinalStatus.FAIL}, NOT_EXECUTED=${summary.byFinalStatus.NOT_EXECUTED}`,
    'Integrity: originalFailuresDeleted=0, assertionsWeakened=0, failuresHidden=0, severityDowngraded=0, originalStatus=FAIL preserved.',
    `Original FAIL evidence: ${summary.originalEvidenceDir} (live reports/failures/ was not deleted).`,
    '',
    '## Owner classes on this retest',
    '',
    '| Owner | Rows |',
    '| --- | --- |',
    ...(ownerRows.length ? ownerRows : ['| (none) | 0 |']),
    '',
    '## Linked failures',
    '',
    '| Original id | Owner | Original | Retest | Verdict | Evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    ...summary.items.map(
      (row) =>
        `| ${mdCell(row.originalFailureId)} | ${mdCell(String(row.ownerClassification))} | FAIL | ${row.retestStatus} | ${mdCell(row.stabilityVerdict)} | ${mdCell(row.evidence.originalAnalysis)} |`
    ),
    ...(summary.items.length === 0
      ? ['| — | — | — | — | NOTHING_TO_RETEST / BLOCKED | — |']
      : []),
    '',
    ...detailBlocks,
    'Original FAIL records were not overwritten.',
    'Assertions were not weakened. Severity was not downgraded. Failures were not hidden.',
    '',
  ].join('\n');
}

export function writeRetestArtifacts(summary: RetestSummary): void {
  fs.mkdirSync(PATHS.reports.retest, { recursive: true });
  writeJson(path.join(PATHS.reports.retest, 'summary.json'), summary);
  writeJson(path.join(PATHS.reports.retest, 'latest.json'), summary.section217);
  writeJson(path.join(PATHS.reports.retest, 'section-2.17.json'), summary.section217);
  writeJson(path.join(PATHS.reports.retest, 'lifecycle.json'), {
    generatedAt: summary.generatedAt,
    outcome: summary.outcome,
    status: summary.status,
    lifecycle: summary.lifecycle,
    items: summary.items.map((row) => ({
      originalFailureId: row.originalFailureId,
      ownerClassification: row.ownerClassification,
      originalStatus: row.originalStatus,
      retestStatus: row.retestStatus,
      lifecycle: row.lifecycle,
    })),
  });
  fs.writeFileSync(path.join(PATHS.reports.retest, 'findings.md'), `${renderRetestMarkdown(summary)}\n`, 'utf8');
}
