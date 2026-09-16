import fs from 'fs';
import path from 'path';
import { writeJson } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import type { UiPerformanceSummary, UiTimingMeasurement } from './types';

export function uiPerformanceWorkDir(): string {
  return path.join(PATHS.root, 'test-results', 'performance');
}

export function uiTimingEvidencePath(): string {
  return path.join(uiPerformanceWorkDir(), 'evidence', 'ui-timing.json');
}

export function writeUiTimingEvidence(measurement: UiTimingMeasurement): string {
  const filePath = uiTimingEvidencePath();
  writeJson(filePath, measurement);
  return filePath;
}

export function loadUiTimingEvidence(): UiTimingMeasurement | null {
  const filePath = uiTimingEvidencePath();
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as UiTimingMeasurement;
}

function formatMs(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? 'NOT_AVAILABLE' : String(Math.round(value));
}

export function renderUiFindings(summary: UiPerformanceSummary): string {
  const measurement = summary.measurement;
  const lines = [
    '# Playwright UI performance findings',
    '',
    'Separate from JMeter and from Lighthouse. This artifact records page-load, navigation, and resource timing.',
    'Values are RECORDED. No SLA / PASS verdict is invented. Official CWV scores are not fabricated here.',
    '',
    `- Status: ${summary.status}`,
    `- Target: ${summary.target ?? 'NOT_AVAILABLE'}`,
    `- Page source: ${summary.pageSource ?? 'NOT_AVAILABLE'}`,
    `- HTTP status: ${summary.httpStatus ?? 'NOT_AVAILABLE'}`,
    `- Threshold status: ${summary.thresholds.status}`,
    '',
    summary.thresholds.note,
    '',
  ];

  if (summary.skipReason) {
    lines.push(`NOT_EXECUTED: ${summary.skipReason}`, '');
  }

  if (measurement) {
    lines.push(
      '| Metric | Value |',
      '| --- | --- |',
      `| URL | ${measurement.url} |`,
      `| Page | ${measurement.pageName} |`,
      `| TTFB (ms) | ${formatMs(measurement.navigation?.ttfbMs)} |`,
      `| DOMContentLoaded (ms) | ${formatMs(measurement.navigation?.domContentLoadedMs)} |`,
      `| Load event (ms) | ${formatMs(measurement.navigation?.loadEventMs)} |`,
      `| Navigation duration (ms) | ${formatMs(measurement.navigation?.durationMs)} |`,
      `| First paint (ms) | ${formatMs(measurement.paint.firstPaintMs)} |`,
      `| FCP (ms) | ${formatMs(measurement.paint.firstContentfulPaintMs)} |`,
      `| LCP (ms) | ${formatMs(measurement.lcpMs)} |`,
      `| CLS | ${measurement.cls == null ? 'NOT_AVAILABLE' : String(measurement.cls)} |`,
      `| INP (ms) | NOT_AVAILABLE |`,
      `| Resource entries | ${measurement.resourceCount} |`,
      `| XHR / fetch | ${measurement.xhrOrFetchCount} |`,
      ''
    );
  }

  if (summary.applicability.length > 0) {
    lines.push('| Check | Status | Reason |', '| --- | --- | --- |');
    for (const row of summary.applicability) {
      lines.push(`| ${row.name} | ${row.status} | ${row.reason} |`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function writeUiPerformanceSummary(summary: UiPerformanceSummary): void {
  fs.mkdirSync(PATHS.reports.performance, { recursive: true });
  writeJson(PATHS.uiPerformanceSummary, summary);
  fs.writeFileSync(PATHS.uiPerformanceFindings, renderUiFindings(summary), 'utf8');
}
