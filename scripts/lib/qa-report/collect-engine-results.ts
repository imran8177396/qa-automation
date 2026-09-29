/**
 * Collects normalized engine summary JSON (buildEngineSummary) into the same
 * enterprise report row shape HTML / Word / PDF already render.
 * Missing summary files are skipped — never treated as PASS.
 * Also attaches discovery gated-check-outcomes.json rows (BLOCKED / NOT_TESTED /
 * REQUIRES_CONFIGURATION / NOT_APPLICABLE) when that evidence file exists —
 * missing file adds no row and is not PASS.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  ENGINE_RESULT_STATUSES,
  isEngineResultStatus,
  makeResult,
  type EngineResultStatus,
  type EngineSummary,
  type TestResult,
  type TestResultEvidence,
} from '../../core/engine-contract';
import { summarizeTrends, type TrendSummary } from '../../core/platform/history';
import { PATHS } from '../paths';
import { NOT_AVAILABLE } from '../suite-origin';

/** Exact human-readable column labels for enterprise / Allure-adjacent tables. */
export const ENGINE_RESULT_COLUMN_LABELS = [
  'Test Type',
  'Category',
  'Target',
  'Status',
  'Severity',
  'Duration',
  'Expected',
  'Actual',
  'Error',
  'Evidence',
  'Configuration',
] as const;

/**
 * Status filter vocabulary for engine result tables.
 * FLAKY stays literal `FLAKY` — never remapped to PASS.
 */
export const ENGINE_REPORT_STATUS_FILTER = [
  'PASS',
  'FAIL',
  'BLOCKED',
  'NOT_TESTED',
  'FLAKY',
] as const;

export type EngineResultColumnLabel = (typeof ENGINE_RESULT_COLUMN_LABELS)[number];

/** Empty cell when a field was not recorded — never invent expected/actual/evidence. */
export const ENGINE_RESULT_EMPTY = '—';

export interface EngineSummarySource {
  engineId: string;
  /** Absolute path to reports/<engine>/summary.json */
  summaryPath: string;
  /** Posix-relative path for report notes */
  relativePath: string;
}

export interface EngineReportRow {
  testType: string;
  category: string;
  target: string;
  /** Preserved engine status — never remapped to PASS. */
  status: string;
  severity: string;
  duration: string;
  expected: string;
  actual: string;
  error: string;
  evidence: string;
  configuration: string;
}

export interface CollectEngineResultsOptions {
  /** Override summary sources (tests). Defaults to PATHS.reports engine dirs. */
  sources?: EngineSummarySource[];
  /** When false, skip reading disk (tests). Default true. */
  readFromDisk?: boolean;
  /**
   * Attach reports/discovery/gated-check-outcomes.json when present.
   * Defaults to true only when using default summary sources; custom `sources`
   * (unit tests) skip the gated file unless this is set true. Missing file → no rows.
   */
  includeGatedCheckOutcomes?: boolean;
}

export interface CollectEngineResultsOutput {
  results: TestResult[];
  rows: EngineReportRow[];
  sourcesRead: string[];
  missing: Array<{ engineId: string; path: string }>;
  available: boolean;
  sourceNote: string;
  /**
   * Single-run trend snapshot from current rows only.
   * coverageDeltaPct is null and recurringDefects empty until a second run exists.
   */
  trends: TrendSummary;
}

/** Report dirs that write EngineSummary via buildEngineSummary. */
export function defaultEngineSummarySources(reportsRoot = PATHS.reports): EngineSummarySource[] {
  const entries: Array<{ engineId: string; dir: string }> = [
    { engineId: 'integration', dir: reportsRoot.integration },
    { engineId: 'contract', dir: reportsRoot.contract },
    { engineId: 'database', dir: reportsRoot.database },
    { engineId: 'smoke', dir: reportsRoot.smoke },
    { engineId: 'sanity', dir: reportsRoot.sanity },
    { engineId: 'regression', dir: reportsRoot.regression },
    { engineId: 'reliability', dir: reportsRoot.reliability },
    { engineId: 'resilience', dir: reportsRoot.resilience },
    { engineId: 'deployment', dir: reportsRoot.deployment },
    { engineId: 'localization', dir: reportsRoot.localization },
    { engineId: 'ai', dir: reportsRoot.ai },
    { engineId: 'productionVerification', dir: reportsRoot.productionVerification },
  ];
  return entries.map(({ engineId, dir }) => {
    const summaryPath = path.join(dir, 'summary.json');
    return {
      engineId,
      summaryPath,
      relativePath: path.relative(PATHS.root, summaryPath).replace(/\\/g, '/'),
    };
  });
}

function isEngineSummaryShape(value: unknown): value is EngineSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as EngineSummary;
  return typeof row.engine === 'string' && Array.isArray(row.results);
}

function readSummaryFile(summaryPath: string): EngineSummary | null {
  if (!fs.existsSync(summaryPath)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    return isEngineSummaryShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function cell(value: unknown): string {
  if (value === undefined || value === null || value === '') return ENGINE_RESULT_EMPTY;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return ENGINE_RESULT_EMPTY;
  }
}

/** Short path / label from evidence — never invent screenshots or payloads. */
export function formatEngineEvidence(evidence?: TestResultEvidence): string {
  if (!evidence) return 'none';
  const parts: string[] = [];
  if (typeof evidence.screenshot === 'string' && evidence.screenshot.trim()) {
    parts.push(evidence.screenshot.replace(/\\/g, '/'));
  }
  if (typeof evidence.log === 'string' && evidence.log.trim()) {
    parts.push(evidence.log.replace(/\\/g, '/'));
  }
  if (evidence.request !== undefined) parts.push('request');
  if (evidence.response !== undefined) parts.push('response');
  // Captured / existing-PATHS pointers only — written:false declarations stay off the column.
  if (Array.isArray(evidence.artifacts)) {
    for (const ref of evidence.artifacts) {
      if (ref.written === true || ref.source === 'existing') {
        const rel = typeof ref.relativePath === 'string' ? ref.relativePath.replace(/\\/g, '/') : '';
        if (rel && !parts.includes(rel)) parts.push(rel);
      }
    }
  }
  return parts.length > 0 ? parts.join('; ') : 'none';
}

/**
 * Configuration note from metadata.configuration / metadata.reason, or error.message
 * when assertion expected/actual are empty. Never dumps env / secrets bags.
 */
export function formatEngineConfiguration(result: TestResult): string {
  const meta = result.metadata;
  const fromMetaConfiguration =
    meta && typeof meta.configuration === 'string' ? meta.configuration.trim() : '';
  const fromMetaReason = meta && typeof meta.reason === 'string' ? meta.reason.trim() : '';
  const hasAssertionValue =
    result.assertion?.expected !== undefined || result.assertion?.actual !== undefined;
  if (fromMetaConfiguration) return fromMetaConfiguration;
  if (fromMetaReason) return fromMetaReason;
  if (!hasAssertionValue && result.error?.message?.trim()) return result.error.message.trim();
  return ENGINE_RESULT_EMPTY;
}

export function preserveEngineStatus(status: string): string {
  const upper = status.trim().toUpperCase();
  if (isEngineResultStatus(upper)) return upper;
  if ((ENGINE_RESULT_STATUSES as readonly string[]).includes(upper)) return upper;
  return upper || NOT_AVAILABLE;
}

export function mapTestResultToReportRow(result: TestResult): EngineReportRow {
  return {
    testType: cell(result.testType),
    category: cell(result.category),
    target: cell(result.target),
    status: preserveEngineStatus(String(result.status ?? '')),
    severity: cell(result.severity),
    duration:
      result.durationMs === undefined || result.durationMs === null
        ? ENGINE_RESULT_EMPTY
        : `${result.durationMs} ms`,
    expected: cell(result.assertion?.expected),
    actual: cell(result.assertion?.actual),
    error: cell(result.error?.message),
    evidence: formatEngineEvidence(result.evidence),
    configuration: formatEngineConfiguration(result),
  };
}

export function engineReportRowToCells(row: EngineReportRow): string[] {
  return [
    row.testType,
    row.category,
    row.target,
    row.status,
    row.severity,
    row.duration,
    row.expected,
    row.actual,
    row.error,
    row.evidence,
    row.configuration,
  ];
}

/** HTML table fragment using the same 11 labels the enterprise report renders. */
export function renderEngineResultsTableHtml(rows: EngineReportRow[]): string {
  const head = ENGINE_RESULT_COLUMN_LABELS.map((label) => `<th>${escapeHtml(label)}</th>`).join('');
  const body =
    rows.length === 0
      ? `<tr><td colspan="${ENGINE_RESULT_COLUMN_LABELS.length}">${escapeHtml(`${NOT_AVAILABLE} — no engine summary results were present`)}</td></tr>`
      : rows
          .map(
            (row) =>
              `<tr>${engineReportRowToCells(row)
                .map((cellValue) => `<td>${escapeHtml(cellValue)}</td>`)
                .join('')}</tr>`
          )
          .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const GATED_OUTCOME_STATUSES = new Set<EngineResultStatus>([
  'BLOCKED',
  'NOT_TESTED',
  'REQUIRES_CONFIGURATION',
  'NOT_APPLICABLE',
]);

interface GatedCheckOutcomeRow {
  id?: unknown;
  kind?: unknown;
  title?: unknown;
  status?: unknown;
  reason?: unknown;
  targetUrl?: unknown;
}

/**
 * Map discovery-harness gated planned-check outcomes into engine TestResult rows.
 * Missing or empty file → no rows (never PASS).
 */
export function gatedCheckOutcomesToTestResults(
  raw: unknown,
  evidencePath = 'reports/discovery/gated-check-outcomes.json'
): TestResult[] {
  if (!raw || typeof raw !== 'object') return [];
  const rows = (raw as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const results: TestResult[] = [];
  for (const entry of rows) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as GatedCheckOutcomeRow;
    if (typeof row.id !== 'string' || typeof row.title !== 'string') continue;
    if (typeof row.status !== 'string') continue;
    const statusUpper = row.status.trim().toUpperCase() as EngineResultStatus;
    if (!GATED_OUTCOME_STATUSES.has(statusUpper)) continue;

    const reason =
      typeof row.reason === 'string' && row.reason.trim()
        ? row.reason.trim()
        : `${statusUpper}: no reason recorded`;
    const kind = typeof row.kind === 'string' ? row.kind : 'gated';
    const target = typeof row.targetUrl === 'string' ? row.targetUrl : '';

    results.push(
      makeResult({
        id: `gated-${row.id}`,
        testType: 'ui',
        category: 'functional',
        name: row.title,
        status: statusUpper,
        target,
        error: { message: reason },
        evidence: { log: evidencePath },
        metadata: {
          reason,
          kind,
          source: 'gated-check-outcomes',
          engine: 'ui',
        },
      })
    );
  }
  return results;
}

function readGatedCheckOutcomes(): TestResult[] {
  const filePath = PATHS.gatedCheckOutcomesFile;
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const relative = path.relative(PATHS.root, filePath).replace(/\\/g, '/');
    return gatedCheckOutcomesToTestResults(parsed, relative);
  } catch {
    return [];
  }
}

export function collectEngineResults(
  options: CollectEngineResultsOptions = {}
): CollectEngineResultsOutput {
  const sources = options.sources ?? defaultEngineSummarySources();
  const readFromDisk = options.readFromDisk !== false;
  const results: TestResult[] = [];
  const sourcesRead: string[] = [];
  const missing: Array<{ engineId: string; path: string }> = [];

  for (const source of sources) {
    if (!readFromDisk) {
      missing.push({ engineId: source.engineId, path: source.relativePath });
      continue;
    }
    const summary = readSummaryFile(source.summaryPath);
    if (!summary) {
      missing.push({ engineId: source.engineId, path: source.relativePath });
      continue;
    }
    sourcesRead.push(source.relativePath);
    for (const row of summary.results) {
      if (!row || typeof row !== 'object') continue;
      results.push(row);
    }
  }

  if (readFromDisk) {
    const includeGated =
      options.includeGatedCheckOutcomes ?? options.sources === undefined;
    if (includeGated) {
      const gated = readGatedCheckOutcomes();
      if (gated.length > 0) {
        results.push(...gated);
        const gatedRel = path.relative(PATHS.root, PATHS.gatedCheckOutcomesFile).replace(/\\/g, '/');
        if (!sourcesRead.includes(gatedRel)) sourcesRead.push(gatedRel);
      }
    }
  }

  const rows = results.map(mapTestResultToReportRow);
  const available = rows.length > 0;
  const sourceNote = available
    ? `Engine results loaded from ${sourcesRead.length} summary file(s). Missing summaries were not treated as PASS.`
    : 'No engine summary.json files with results were present. Missing files were skipped and not counted as PASS.';

  const trendRows = results
    .filter((row) => row.status === 'PASS' || row.status === 'FAIL')
    .map((row) => ({
      id: row.id,
      status: row.status as 'PASS' | 'FAIL',
      ...(typeof row.durationMs === 'number' ? { durationMs: row.durationMs } : {}),
    }));
  const trends = summarizeTrends([trendRows]);

  return {
    results,
    rows,
    sourcesRead,
    missing,
    available,
    sourceNote,
    trends,
  };
}

/** Allure 2 status vocabulary already consumed by `allure generate`. Never map gated statuses to passed. */
export type AllureResultStatus = 'passed' | 'failed' | 'skipped' | 'broken' | 'unknown';

export function mapEngineStatusToAllure(status: string): AllureResultStatus {
  const normalized = preserveEngineStatus(status) as EngineResultStatus | string;
  switch (normalized) {
    case 'PASS':
      return 'passed';
    case 'FAIL':
      return 'failed';
    case 'SKIPPED':
    case 'CANCELLED':
      return 'skipped';
    case 'BLOCKED':
    case 'NOT_TESTED':
    case 'REQUIRES_CONFIGURATION':
    case 'NOT_APPLICABLE':
    case 'TIMEOUT':
    case 'FLAKY':
      return 'broken';
    default:
      return 'unknown';
  }
}

export interface AllureResultDocument {
  uuid: string;
  historyId: string;
  name: string;
  fullName: string;
  status: AllureResultStatus;
  statusDetails?: { message?: string };
  stage: 'finished';
  start?: number;
  stop?: number;
  labels: Array<{ name: string; value: string }>;
}

/** Converts one TestResult into the same Allure `-result.json` shape Playwright reporters emit. */
export function testResultToAllureDocument(result: TestResult, now = Date.now()): AllureResultDocument {
  const uuid = crypto.randomUUID();
  const historyId = crypto
    .createHash('md5')
    .update(`${result.testType}:${result.id}:${result.name}`)
    .digest('hex');
  const duration = typeof result.durationMs === 'number' ? result.durationMs : 0;
  const stop = now;
  const start = stop - Math.max(0, duration);
  const message =
    result.error?.message ||
    (typeof result.metadata?.reason === 'string' ? result.metadata.reason : undefined);
  return {
    uuid,
    historyId,
    name: result.name,
    fullName: `${result.testType}.${result.id}`,
    status: mapEngineStatusToAllure(String(result.status)),
    ...(message ? { statusDetails: { message } } : {}),
    stage: 'finished',
    start,
    stop,
    labels: [
      { name: 'suite', value: String(result.testType) },
      { name: 'package', value: String(result.category) },
      { name: 'framework', value: 'qa-engine-contract' },
      ...(result.severity ? [{ name: 'severity', value: String(result.severity) }] : []),
      ...(result.target ? [{ name: 'tag', value: String(result.target) }] : []),
    ],
  };
}

/**
 * Writes Allure result files for collected engine TestResults into reports/allure/results.
 * Same directory / filename convention allure-playwright already uses.
 */
export function writeEngineAllureResults(
  results: TestResult[],
  resultsDir = PATHS.allureResults
): string[] {
  if (results.length === 0) return [];
  fs.mkdirSync(resultsDir, { recursive: true });
  const written: string[] = [];
  const now = Date.now();
  for (const result of results) {
    const doc = testResultToAllureDocument(result, now);
    const filePath = path.join(resultsDir, `${doc.uuid}-result.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(doc)}\n`, 'utf8');
    written.push(filePath);
  }
  return written;
}
