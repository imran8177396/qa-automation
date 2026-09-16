import { readJsonIfExists } from '../discovery/write-json';
import type { ClassifiedFailure } from '../failures/types';
import type { RetestOutcomeStatus, StageFinding } from './types';

export function loadStageFindings(summaryPath: string): StageFinding[] {
  const raw = readJsonIfExists<{ findings?: StageFinding[] }>(summaryPath);
  return raw?.findings ?? [];
}

export function composeStageTestId(source: string, finding: StageFinding): string {
  return `${source}::${finding.rule ?? finding.id ?? ''}::${finding.page ?? ''}`;
}

export function matchStageFinding(row: ClassifiedFailure, findings: StageFinding[]): StageFinding | null {
  for (const finding of findings) {
    if (finding.id && finding.id === row.testId) return finding;
  }
  for (const finding of findings) {
    if (finding.rule && finding.rule === row.title) return finding;
    if (composeStageTestId(row.source, finding) === row.testId) return finding;
  }
  // Collector sequential ids (SEO-0002) can collide with a different finding's id.
  // Only use row.id when it is the same identity as testId or the rule title matches.
  for (const finding of findings) {
    if (!finding.id || finding.id !== row.id) continue;
    if (row.testId === row.id || finding.rule === row.title) return finding;
  }
  return null;
}

export function stageFindingStatus(finding: StageFinding | null): {
  status: RetestOutcomeStatus;
  reason: string;
} {
  if (!finding) {
    return {
      status: 'NOT_EXECUTED',
      reason: 'Retest stage ran but the original finding id/rule was not in the new report. Original FAIL preserved.',
    };
  }
  const raw = (finding.status ?? '').toUpperCase();
  if (raw === 'FAIL' || raw === 'FAILED') {
    return { status: 'FAIL', reason: 'Retest failed. Original FAIL is preserved.' };
  }
  if (raw === 'PASS' || raw === 'PASSED') {
    return {
      status: 'PASS',
      reason: 'Retest passed. Original FAIL is preserved as FAIL → PASS (unstable).',
    };
  }
  return {
    status: 'NOT_EXECUTED',
    reason: `Retest finding status is ${finding.status ?? 'NOT_AVAILABLE'} (not PASS/FAIL). Original FAIL preserved — not converted.`,
  };
}
