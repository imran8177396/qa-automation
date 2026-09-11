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
import { PLAYWRIGHT_SUITE_OUTPUT_PATHS } from '../lib/playwright-suites';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import type { FailureEvidence } from './types';

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

function attachmentPath(
  attachments: PlaywrightJsonAttachment[] | undefined,
  kind: 'screenshot' | 'trace' | 'video'
): string | null {
  if (!attachments?.length) return null;
  const match = attachments.find((row) => {
    const name = (row.name ?? '').toLowerCase();
    const type = (row.contentType ?? '').toLowerCase();
    if (kind === 'screenshot') return type.startsWith('image/') || name.includes('screenshot');
    if (kind === 'trace') return name === 'trace' || type.includes('zip') || name.includes('trace');
    return type.startsWith('video/') || name.includes('video');
  });
  return match?.path ?? null;
}

function textOrUnavailable(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed : NOT_AVAILABLE;
}

interface PlaywrightSource {
  source: string;
  reportPath: string;
}

function playwrightSources(): PlaywrightSource[] {
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
        const errorMessage = textOrUnavailable(combinedErrorMessage(result));
        const stackTrace = textOrUnavailable(combinedErrorStack(result));
        const screenshot = attachmentPath(result.attachments, 'screenshot');
        const durationMs =
          typeof result.duration === 'number' && Number.isFinite(result.duration)
            ? result.duration
            : NOT_AVAILABLE;

        rows.push({
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
          screenshotPath: screenshot,
          screenshotPresent: Boolean(screenshot && fs.existsSync(screenshot)),
          tracePath: attachmentPath(result.attachments, 'trace'),
          videoPath: attachmentPath(result.attachments, 'video'),
        });
      }
    }
  }
  return rows;
}

function collectPostman(): FailureEvidence[] {
  const postmanPath = path.join(PATHS.reports.postman, 'report.json');
  if (!fs.existsSync(postmanPath)) return [];
  const postman = JSON.parse(fs.readFileSync(postmanPath, 'utf8')) as {
    run?: { failures?: Array<{ error?: { message?: string }; source?: { name?: string } }> };
  };
  const rows: FailureEvidence[] = [];
  let seq = 1;
  for (const failure of postman.run?.failures ?? []) {
    const title = failure.source?.name ?? NOT_AVAILABLE;
    const errorMessage = textOrUnavailable(failure.error?.message ?? '');
    rows.push({
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
    });
  }
  return rows;
}

export function collectFailures(): FailureEvidence[] {
  const rows: FailureEvidence[] = [];
  for (const { source, reportPath } of playwrightSources()) {
    rows.push(...collectPlaywright(reportPath, source));
  }
  rows.push(...collectPostman());
  return rows;
}
