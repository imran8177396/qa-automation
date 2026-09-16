import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import { playwrightSuiteResultsPath, toPosixRelative } from '../lib/playwright-suites';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import { buildEvidenceRefs, resolveExistingArtifact, stripOrUnavailable } from './evidence';
import type { EvidenceSourceScan, FailureEvidence } from './types';

interface GenericFinding {
  id?: string;
  status?: string;
  rule?: string;
  detail?: string;
  page?: string;
  expected?: string;
  actual?: string;
}

interface GenericFindingReport {
  findings?: GenericFinding[];
}

export interface FindingSourceSpec {
  source: string;
  reportPath: string;
  /** Skip this source when the matching Playwright suite JSON exists. */
  skipIfPlaywrightPresent?: boolean;
}

export function defaultFindingSources(): FindingSourceSpec[] {
  return [
    { source: 'security', reportPath: path.join(PATHS.reports.security, 'summary.json') },
    { source: 'seo', reportPath: path.join(PATHS.reports.seo, 'summary.json') },
    { source: 'content', reportPath: path.join(PATHS.reports.content, 'summary.json') },
    { source: 'dependencies', reportPath: path.join(PATHS.reports.dependencies, 'summary.json') },
    {
      source: 'accessibility-findings',
      reportPath: path.join(PATHS.reports.accessibility, 'summary.json'),
      skipIfPlaywrightPresent: true,
    },
  ];
}

function isFailStatus(status: string | undefined): boolean {
  const upper = (status ?? '').toUpperCase();
  return upper === 'FAIL' || upper === 'FAILED';
}

function readFindingReport(reportPath: string): GenericFindingReport | null {
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8')) as GenericFindingReport;
  } catch {
    return null;
  }
}

function playwrightSuitePresentFor(source: string): boolean {
  if (source === 'accessibility-findings') {
    return fs.existsSync(playwrightSuiteResultsPath('accessibility'));
  }
  return false;
}

function findingErrorMessage(finding: GenericFinding): string {
  const parts = [
    finding.detail,
    finding.expected ? `Expected: ${finding.expected}` : '',
    finding.actual ? `Actual: ${finding.actual}` : '',
  ].filter((part) => part && part.trim());
  return stripOrUnavailable(parts.join('\n'));
}

export function collectFindingFailures(
  sources: FindingSourceSpec[] = defaultFindingSources()
): { evidence: FailureEvidence[]; scans: EvidenceSourceScan[] } {
  const evidence: FailureEvidence[] = [];
  const scans: EvidenceSourceScan[] = [];

  for (const spec of sources) {
    const resolved = path.resolve(spec.reportPath);
    const present = fs.existsSync(resolved);
    if (spec.skipIfPlaywrightPresent && playwrightSuitePresentFor(spec.source)) {
      scans.push({
        source: spec.source,
        path: toPosixRelative(resolved),
        present,
        failureCount: 0,
      });
      continue;
    }

    const report = present ? readFindingReport(resolved) : null;
    const fails = (report?.findings ?? []).filter((row) => isFailStatus(row.status));
    scans.push({
      source: spec.source,
      path: toPosixRelative(resolved),
      present,
      failureCount: fails.length,
    });

    let seq = 1;
    for (const finding of fails) {
      const title = finding.rule ?? finding.id ?? NOT_AVAILABLE;
      const page = finding.page ?? NOT_AVAILABLE;
      const testId =
        finding.id ??
        `${spec.source}::${title}::${page}`;
      const artifact = resolveExistingArtifact(resolved);
      const row: FailureEvidence = {
        id: `${spec.source.toUpperCase()}-${String(seq++).padStart(4, '0')}`,
        source: spec.source === 'accessibility-findings' ? 'accessibility' : spec.source,
        title,
        testId,
        specFile: toPosixRelative(resolved),
        projectName: NOT_AVAILABLE,
        errorMessage: findingErrorMessage(finding),
        stackTrace: NOT_AVAILABLE,
        durationMs: NOT_AVAILABLE,
        retryCount: 0,
        attemptStatuses: ['failed'],
        screenshotPath: null,
        screenshotPresent: false,
        tracePath: null,
        videoPath: null,
        videoPresent: false,
        tracePresent: false,
        consoleLog: NOT_AVAILABLE,
        networkLog: NOT_AVAILABLE,
        logPath: artifact.present ? artifact.recordedPath : null,
        consolePresent: false,
        networkPresent: false,
        logPresent: artifact.present,
        artifactSourcePath: artifact.recordedPath ?? undefined,
      };
      row.evidenceRefs = buildEvidenceRefs(row);
      evidence.push(row);
    }
  }

  return { evidence, scans };
}
