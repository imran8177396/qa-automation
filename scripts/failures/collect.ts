import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import {
  combinedErrorMessage,
  combinedErrorStack,
  loadPlaywrightJsonReport,
  walkPlaywrightSpecs,
  type PlaywrightJsonAttachment,
  type PlaywrightJsonReport,
} from '../lib/playwright-results';
import { PLAYWRIGHT_SUITE_OUTPUT_PATHS, toPosixRelative } from '../lib/playwright-suites';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import { collectFindingFailures, type FindingSourceSpec } from './collect-findings';
import {
  buildEvidenceRefs,
  extractBrowserLogs,
  extractNetworkExcerpt,
  nearbyErrorContext,
  resolveExistingArtifact,
  stripOrUnavailable,
} from './evidence';
import type { EvidenceSourceScan, FailureEvidence } from './types';

function isFailedStatus(status: string | undefined): boolean {
  const upper = (status ?? '').toUpperCase();
  return (
    upper === 'FAILED' ||
    upper === 'FAIL' ||
    upper === 'UNEXPECTED' ||
    upper === 'TIMEDOUT' ||
    upper === 'INTERRUPTED'
  );
}

function attachmentMatch(
  attachments: PlaywrightJsonAttachment[] | undefined,
  kind: 'screenshot' | 'trace' | 'video' | 'log'
): PlaywrightJsonAttachment | undefined {
  if (!attachments?.length) return undefined;
  return attachments.find((row) => {
    const name = (row.name ?? '').toLowerCase();
    const type = (row.contentType ?? '').toLowerCase();
    if (kind === 'screenshot') return type.startsWith('image/') || name.includes('screenshot');
    if (kind === 'trace') return name === 'trace' || type.includes('zip') || name.includes('trace');
    if (kind === 'video') return type.startsWith('video/') || name.includes('video');
    return (
      name === 'error-context' ||
      name.includes('error-context') ||
      name === 'stdout' ||
      name === 'stderr' ||
      type.includes('text/markdown') ||
      type.includes('text/plain')
    );
  });
}

function attachmentRecordedPath(row: PlaywrightJsonAttachment | undefined): string | null {
  return row?.path ? row.path : null;
}

interface PlaywrightSource {
  source: string;
  reportPath: string;
}

export function playwrightSources(): PlaywrightSource[] {
  const seen = new Set<string>();
  const rows: PlaywrightSource[] = [];

  const add = (source: string, reportPath: string): void => {
    const resolved = path.resolve(reportPath);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    rows.push({ source, reportPath });
  };

  for (const [suite, reportPath] of Object.entries(PLAYWRIGHT_SUITE_OUTPUT_PATHS)) {
    add(suite, reportPath);
  }

  add('playwright', path.join(PATHS.reports.playwright, 'results.json'));
  add('cross-browser', path.join(PATHS.reports.crossBrowser, 'results.json'));
  add('accessibility', path.join(PATHS.reports.accessibility, 'results.json'));
  add('workflows', path.join(PATHS.reports.workflows, 'results.json'));

  return rows;
}

function collectPlaywright(reportPath: string, source: string): FailureEvidence[] {
  const report: PlaywrightJsonReport | null = loadPlaywrightJsonReport(reportPath);
  if (!report) return [];
  const specs = walkPlaywrightSpecs(report.suites);
  const rows: FailureEvidence[] = [];
  let seq = 1;

  for (const spec of specs) {
    const specFile = spec.file ? spec.file : NOT_AVAILABLE;
    for (const test of spec.tests ?? []) {
      const results = test.results ?? [];
      const attemptStatuses = results.map((result) => result.status ?? NOT_AVAILABLE);
      const projectName = test.projectName ?? test.projectId ?? NOT_AVAILABLE;
      const title = spec.title ?? NOT_AVAILABLE;
      const testId =
        specFile !== NOT_AVAILABLE || title !== NOT_AVAILABLE
          ? `${specFile}::${title}::${projectName}`
          : NOT_AVAILABLE;

      for (const result of results) {
        if (!isFailedStatus(result.status)) continue;
        const errorMessage = stripOrUnavailable(combinedErrorMessage(result));
        const stackTrace = stripOrUnavailable(combinedErrorStack(result));
        const screenshotRaw = attachmentRecordedPath(attachmentMatch(result.attachments, 'screenshot'));
        const traceRaw = attachmentRecordedPath(attachmentMatch(result.attachments, 'trace'));
        const videoRaw = attachmentRecordedPath(attachmentMatch(result.attachments, 'video'));
        const logRaw = attachmentRecordedPath(attachmentMatch(result.attachments, 'log'));
        const screenshot = resolveExistingArtifact(screenshotRaw);
        const trace = resolveExistingArtifact(traceRaw);
        const video = resolveExistingArtifact(videoRaw);
        const logAttach = resolveExistingArtifact(logRaw);
        const nearbyLog = nearbyErrorContext(screenshot.recordedPath ?? trace.recordedPath);
        const logPath = logAttach.present ? logAttach.recordedPath : nearbyLog;
        const consoleLog = extractBrowserLogs(errorMessage);
        const networkLog = extractNetworkExcerpt(`${errorMessage}\n${stackTrace}`);
        const durationMs =
          typeof result.duration === 'number' && Number.isFinite(result.duration)
            ? result.duration
            : NOT_AVAILABLE;

        const row: FailureEvidence = {
          id: `${source.toUpperCase()}-${String(seq++).padStart(4, '0')}`,
          source,
          title,
          testId,
          specFile,
          projectName,
          errorMessage,
          stackTrace,
          durationMs,
          retryCount: result.retry ?? 0,
          attemptStatuses,
          screenshotPath: screenshot.recordedPath,
          screenshotPresent: screenshot.present,
          tracePath: trace.recordedPath,
          videoPath: video.recordedPath,
          videoPresent: video.present,
          tracePresent: trace.present,
          consoleLog,
          networkLog,
          logPath,
          consolePresent: consoleLog !== NOT_AVAILABLE,
          networkPresent: networkLog !== NOT_AVAILABLE,
          logPresent: Boolean(logPath),
          artifactSourcePath: toPosixRelative(path.resolve(reportPath)),
        };
        row.evidenceRefs = buildEvidenceRefs(row);
        rows.push(row);
      }
    }
  }
  return rows;
}

function collectPostman(postmanPath = path.join(PATHS.reports.postman, 'report.json')): {
  evidence: FailureEvidence[];
  scan: EvidenceSourceScan;
} {
  const resolved = path.resolve(postmanPath);
  const present = fs.existsSync(resolved);
  const scan: EvidenceSourceScan = {
    source: 'postman',
    path: toPosixRelative(resolved),
    present,
    failureCount: 0,
  };
  if (!present) return { evidence: [], scan };

  const postman = JSON.parse(fs.readFileSync(resolved, 'utf8')) as {
    run?: { failures?: Array<{ error?: { message?: string }; source?: { name?: string } }> };
  };
  const evidence: FailureEvidence[] = [];
  let seq = 1;
  for (const failure of postman.run?.failures ?? []) {
    const title = failure.source?.name ?? NOT_AVAILABLE;
    const errorMessage = stripOrUnavailable(failure.error?.message ?? '');
    const row: FailureEvidence = {
      id: `POSTMAN-${String(seq++).padStart(4, '0')}`,
      source: 'postman',
      title,
      testId: `postman::${title}`,
      specFile: NOT_AVAILABLE,
      projectName: NOT_AVAILABLE,
      errorMessage,
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
      logPath: toPosixRelative(resolved),
      consolePresent: false,
      networkPresent: false,
      logPresent: true,
      artifactSourcePath: toPosixRelative(resolved),
    };
    row.evidenceRefs = buildEvidenceRefs(row);
    evidence.push(row);
  }
  scan.failureCount = evidence.length;
  return { evidence, scan };
}

export interface CollectFailuresResult {
  evidence: FailureEvidence[];
  scans: EvidenceSourceScan[];
}

export interface CollectFailuresOptions {
  playwrightReports?: Array<{ source: string; reportPath: string }>;
  postmanReportPath?: string;
  findingSources?: FindingSourceSpec[];
}

export function collectFailuresWithScans(options: CollectFailuresOptions = {}): CollectFailuresResult {
  const evidence: FailureEvidence[] = [];
  const scans: EvidenceSourceScan[] = [];
  const playwright = options.playwrightReports ?? playwrightSources();

  for (const { source, reportPath } of playwright) {
    const resolved = path.resolve(reportPath);
    const present = fs.existsSync(resolved);
    const rows = present ? collectPlaywright(reportPath, source) : [];
    scans.push({
      source,
      path: toPosixRelative(resolved),
      present,
      failureCount: rows.length,
    });
    evidence.push(...rows);
  }

  const postman = collectPostman(options.postmanReportPath);
  scans.push(postman.scan);
  evidence.push(...postman.evidence);

  const findings = collectFindingFailures(options.findingSources);
  scans.push(...findings.scans);
  evidence.push(...findings.evidence);

  return { evidence, scans };
}

export function collectFailures(options: CollectFailuresOptions = {}): FailureEvidence[] {
  return collectFailuresWithScans(options).evidence;
}
