import fs from 'fs';
import path from 'path';
import { writeJson } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import { classifyFailures, summarizeByClass } from './classify';
import { summarizeByOwnerClass } from './owner';
import {
  FAILURE_ANALYSIS_DISCLAIMER,
  FAILURE_ANALYSIS_LIMITATIONS,
  FAILURE_ANALYSIS_METADATA,
  OWNER_FAILURE_CLASSES,
  toAnalysisFinding,
  type EvidenceSourceScan,
  type FailureAnalysisSection216,
  type FailureAnalysisSummary,
  type FailureEvidence,
} from './types';

function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function toSection216(summary: Omit<FailureAnalysisSummary, 'section216'>): FailureAnalysisSection216 {
  return {
    section: '2.16',
    title: 'Failure Analysis',
    metadata: summary.metadata,
    disclaimer: summary.disclaimer,
    byClass: summary.byClass,
    byOwnerClass: summary.byOwnerClass,
    rows: summary.failures.map((row) => ({
      testId: row.testId,
      classification: row.classification,
      ownerClassification: row.ownerClassification,
      evidenceExcerpt: row.evidenceExcerpt,
      ruleFired: row.ruleFired,
      title: row.title,
      source: row.source,
    })),
  };
}

export function buildFailureAnalysisSummary(
  evidence: FailureEvidence[],
  scans: EvidenceSourceScan[] = [],
  generatedAt = new Date().toISOString()
): FailureAnalysisSummary {
  const failures = classifyFailures(evidence);
  const byOwnerClass = summarizeByOwnerClass(failures);
  const outcome = failures.length === 0 ? 'NOTHING_TO_ANALYZE' : 'ANALYZED';
  const draft: Omit<FailureAnalysisSummary, 'section216'> = {
    generatedAt,
    outcome,
    analyzed: failures.length,
    totalFailures: failures.length,
    byClass: summarizeByClass(failures),
    byOwnerClass,
    failures,
    findings: failures.map(toAnalysisFinding),
    sourcesScanned: scans,
    metadata: { ...FAILURE_ANALYSIS_METADATA },
    disclaimer: FAILURE_ANALYSIS_DISCLAIMER,
    limitations: [...FAILURE_ANALYSIS_LIMITATIONS],
    integrity: {
      failuresConvertedToPass: 0,
      assertionsWeakened: 0,
      originalStatusPreserved: true,
    },
  };
  return {
    ...draft,
    section216: toSection216(draft),
  };
}

export function renderFailureAnalysisMarkdown(summary: FailureAnalysisSummary): string {
  const ownerCounts = summary.byOwnerClass ?? summarizeByOwnerClass(summary.failures);
  const ownerRows = OWNER_FAILURE_CLASSES.filter((key) => ownerCounts[key] > 0).map(
    (key) => `| ${key} | ${ownerCounts[key]} |`
  );
  const mechanismRows = Object.entries(summary.byClass)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `| ${label} | ${count} |`);

  const detailBlocks = summary.failures.map((row) => {
    const refs = row.evidence.evidenceRefs;
    const availability = refs
      ? Object.entries(refs.availability)
          .map(([kind, state]) => `${kind}=${state}`)
          .join(', ')
      : NOT_AVAILABLE;
    return [
      `### ${mdCell(row.id)} — ${row.ownerClassification ?? 'UNKNOWN'}`,
      '',
      `- Test ID: ${row.testId}`,
      `- Title: ${row.title}`,
      `- Source: ${row.source}`,
      `- Original status: FAIL (not converted to PASS)`,
      `- Classification: ${row.ownerClassification ?? 'UNKNOWN'}`,
      `- Owner rule: ${row.ownerRuleFired ?? 'INSUFFICIENT_EVIDENCE'}`,
      `- Mechanism: ${row.classification} (${row.ruleFired})`,
      `- Confidence: ${row.confidence}`,
      `- Reason: ${row.ownerRationale ?? row.rationale}`,
      `- Evidence excerpt: ${row.evidenceExcerpt}`,
      `- Evidence availability: ${availability}`,
      `- Screenshot: ${refs?.screenshot ?? NOT_AVAILABLE}`,
      `- Video: ${refs?.video ?? NOT_AVAILABLE}`,
      `- Playwright trace: ${refs?.trace ?? NOT_AVAILABLE}`,
      `- Console: ${refs?.availability.console === 'present' ? 'present' : 'unavailable'}`,
      `- Network: ${refs?.availability.network === 'present' ? 'present' : 'unavailable'}`,
      `- Logs: ${refs?.logs ?? NOT_AVAILABLE}`,
      '',
    ].join('\n');
  });

  const scanRows = (summary.sourcesScanned ?? []).map(
    (row) =>
      `| ${mdCell(row.source)} | ${mdCell(row.path)} | ${row.present ? 'present' : 'unavailable'} | ${row.failureCount} |`
  );

  return [
    '# Failure analysis',
    '',
    summary.disclaimer,
    '',
    `Outcome: ${summary.outcome ?? (summary.totalFailures === 0 ? 'NOTHING_TO_ANALYZE' : 'ANALYZED')}`,
    `Total failures: ${summary.totalFailures}`,
    'Integrity: failuresConvertedToPass=0, assertionsWeakened=0, originalStatus=FAIL preserved.',
    '',
    '## Owner classifications',
    '',
    '| Class | Count |',
    '| --- | --- |',
    ...(ownerRows.length ? ownerRows : ['| NOTHING_TO_ANALYZE | 0 |']),
    '',
    '## Mechanism classifications',
    '',
    '| Class | Count |',
    '| --- | --- |',
    ...(mechanismRows.length ? mechanismRows : ['| (none) | 0 |']),
    '',
    '## Classified failures',
    '',
    '| Test ID | Classification | Mechanism | Rule | Evidence excerpt |',
    '| --- | --- | --- | --- | --- |',
    ...summary.failures.map(
      (row) =>
        `| ${mdCell(row.testId)} | ${row.ownerClassification ?? 'UNKNOWN'} | ${row.classification} | ${mdCell(row.ownerRuleFired ?? row.ruleFired)} | ${mdCell(row.evidenceExcerpt)} |`
    ),
    ...(summary.failures.length === 0
      ? ['| — | NOTHING_TO_ANALYZE | — | — | No failed executions were present in scanned artifacts. |']
      : []),
    '',
    ...detailBlocks,
    '## Sources scanned',
    '',
    '| Source | Path | Artifact | Failures |',
    '| --- | --- | --- | --- |',
    ...(scanRows.length ? scanRows : ['| — | — | unavailable | 0 |']),
    '',
    'Classifications are evidence-based and are not defect tickets.',
    'Never modify a test merely to make it pass.',
    'Never convert a classified failure to PASS.',
    '',
  ].join('\n');
}

export function writeFailureAnalysisReports(
  summary: FailureAnalysisSummary,
  outDir = PATHS.reports.failures
): { summaryPath: string; sectionPath: string; findingsPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, 'summary.json');
  const sectionPath = path.join(outDir, 'section-2.16.json');
  const findingsPath = path.join(outDir, 'findings.md');
  writeJson(summaryPath, summary);
  writeJson(sectionPath, summary.section216);
  fs.writeFileSync(findingsPath, `${renderFailureAnalysisMarkdown(summary)}\n`, 'utf8');
  return { summaryPath, sectionPath, findingsPath };
}
