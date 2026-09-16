import path from 'path';
import { readJsonIfExists } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import type { StageResult } from './types';

export const SUITE_ROLLUP_LABELS = [
  'PLAYWRIGHT',
  'POSTMAN',
  'JMETER',
  'ACCESSIBILITY',
  'VISUAL',
  'RESPONSIVE',
  'SECURITY',
  'SEO',
  'COVERAGE',
  'OVERALL',
] as const;

export type SuiteRollupLabel = (typeof SUITE_ROLLUP_LABELS)[number];

/** Banner statuses: PASS / FAIL / WARNING / BLOCKED, plus honest extras and coverage %. */
export type SuiteRollupStatus =
  | 'PASS'
  | 'FAIL'
  | 'WARNING'
  | 'BLOCKED'
  | 'NOT_EXECUTED'
  | 'RECORDED'
  | 'PARTIAL';

export interface SuiteRollupLine {
  label: SuiteRollupLabel;
  status: SuiteRollupStatus;
  percent?: number;
  detail?: string;
}

export interface FindingTally {
  failCount: number;
  warningCount: number;
  blockedCount: number;
  passCount: number;
}

export interface SuiteRollupArtifacts {
  jmeterStatus?: string | null;
  uiStatus?: string | null;
  coveragePercent?: number | null;
  security?: FindingTally | null;
  seo?: FindingTally | null;
  content?: FindingTally | null;
  crossBrowserNote?: string | null;
}

export type OverallRollupStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'WARNING';

export interface SuiteRollup {
  lines: SuiteRollupLine[];
  overall: OverallRollupStatus;
  notes: string[];
  banner: string;
}

const FAILED = new Set(['FAIL', 'INVALID', 'PARTIAL', 'ERROR']);

function stageByKey(results: StageResult[], key: string): StageResult | undefined {
  return results.find((row) => row.key === key);
}

function fromStage(status: string | undefined): SuiteRollupStatus {
  const value = (status ?? 'NOT_EXECUTED').trim().toUpperCase();
  if (value === 'PASS') return 'PASS';
  if (value === 'WARNING') return 'WARNING';
  if (value === 'BLOCKED') return 'BLOCKED';
  if (value === 'RECORDED') return 'RECORDED';
  if (value === 'PARTIAL') return 'PARTIAL';
  if (FAILED.has(value)) return 'FAIL';
  return 'NOT_EXECUTED';
}

function applyFindingTally(base: SuiteRollupStatus, tally: FindingTally | null | undefined): SuiteRollupStatus {
  if (!tally) return base;
  if (tally.failCount > 0) return 'FAIL';
  if (base === 'FAIL' || base === 'PARTIAL') return base;
  if (tally.blockedCount > 0 && tally.passCount === 0 && tally.warningCount === 0) return 'BLOCKED';
  if (tally.warningCount > 0 && tally.failCount === 0) return 'WARNING';
  return base;
}

function worstSeo(seoStage: SuiteRollupStatus, contentStage: SuiteRollupStatus): SuiteRollupStatus {
  const rank = (status: SuiteRollupStatus): number => {
    if (status === 'FAIL' || status === 'PARTIAL') return 4;
    if (status === 'BLOCKED') return 3;
    if (status === 'NOT_EXECUTED') return 2;
    if (status === 'WARNING') return 1;
    return 0;
  };
  return rank(contentStage) > rank(seoStage) ? contentStage : seoStage;
}

function jmeterDisplay(stage: SuiteRollupStatus, artifactStatus: string | null | undefined): SuiteRollupStatus {
  const raw = (artifactStatus ?? '').trim();
  if (raw === 'breached') return 'FAIL';
  if (raw === 'BLOCKED') return 'BLOCKED';
  if (raw === 'RECORDED' || raw === 'met') return 'RECORDED';
  if (raw === 'NOT_EXECUTED' || raw === 'NOT_AVAILABLE') return 'NOT_EXECUTED';
  if (stage === 'FAIL' || stage === 'PARTIAL') return 'FAIL';
  if (stage === 'NOT_EXECUTED') return 'NOT_EXECUTED';
  if (stage === 'BLOCKED') return 'BLOCKED';
  // Liveness/smoke is never a product PASS.
  return stage === 'PASS' ? 'RECORDED' : stage;
}

function coverageLine(
  stage: SuiteRollupStatus,
  percent: number | null | undefined
): Pick<SuiteRollupLine, 'status' | 'percent' | 'detail'> {
  if (stage === 'FAIL' || stage === 'PARTIAL') {
    return { status: 'FAIL', detail: 'Coverage stage failed' };
  }
  if (stage === 'NOT_EXECUTED' || stage === 'BLOCKED') {
    return { status: stage === 'BLOCKED' ? 'BLOCKED' : 'NOT_EXECUTED' };
  }
  if (typeof percent === 'number' && Number.isFinite(percent)) {
    return {
      status: 'PASS',
      percent,
      detail: 'item coverage (covered ÷ testable — not pass rate)',
    };
  }
  return { status: stage === 'PASS' ? 'PASS' : 'NOT_EXECUTED' };
}

/**
 * OVERALL is PASS only when every required banner suite passed (or JMeter
 * RECORDED / coverage %). Application FAIL on a11y/security/SEO is OVERALL FAIL.
 * Config/env that prevented required work is BLOCKED — never disguised as PASS.
 */
export function resolveOverallStatus(required: SuiteRollupLine[]): OverallRollupStatus {
  let sawWarning = false;
  let sawBlocked = false;

  for (const line of required) {
    if (line.status === 'FAIL' || line.status === 'PARTIAL') return 'FAIL';
    if (line.status === 'WARNING') sawWarning = true;
    if (line.label === 'JMETER' && line.status === 'RECORDED') continue;
    if (line.label === 'COVERAGE' && typeof line.percent === 'number') continue;
    if (line.status === 'BLOCKED' || line.status === 'NOT_EXECUTED') sawBlocked = true;
  }

  if (sawBlocked) return 'BLOCKED';
  if (sawWarning) return 'WARNING';
  return 'PASS';
}

/**
 * Process exit for qa:all. Required-suite FAIL (including findings tallies
 * that the child recorded while exiting 0) must still be non-zero.
 * Stage FAIL/INVALID/PARTIAL already yield 1 via overallExitCode.
 */
export function orchestratorProcessExitCode(overall: OverallRollupStatus, stageExitCode: number): number {
  if (overall === 'FAIL') return 1;
  return stageExitCode;
}

export function formatSuiteRollupBanner(lines: SuiteRollupLine[], notes: string[] = []): string {
  const width = Math.max(...SUITE_ROLLUP_LABELS.map((label) => label.length));
  const body = lines.map((line) => {
    const shown =
      line.label === 'COVERAGE' && typeof line.percent === 'number' && line.status !== 'FAIL'
        ? `${line.percent}%`
        : line.status;
    const extra = line.detail ? `  ${line.detail}` : '';
    return `${line.label.padEnd(width)}  ${shown}${extra}`;
  });
  const noteLines = notes.length > 0 ? ['', ...notes.map((note) => note)] : [];
  return [
    '',
    '============================================================',
    'PLAYWRIGHT / POSTMAN / JMETER / ACCESSIBILITY / VISUAL / RESPONSIVE / SECURITY / SEO / COVERAGE / OVERALL',
    '============================================================',
    ...body,
    '============================================================',
    ...noteLines,
  ].join('\n');
}

export function loadSuiteRollupArtifacts(): SuiteRollupArtifacts {
  const jmeter = readJsonIfExists<{ status?: string }>(PATHS.jmeterSummary);
  const ui = readJsonIfExists<{ status?: string }>(PATHS.uiPerformanceSummary);
  const coverage = readJsonIfExists<{ totals?: { itemCoveragePercent?: number } }>(PATHS.coverageJsonFile);
  const security = readJsonIfExists<FindingTally>(path.join(PATHS.reports.security, 'summary.json'));
  const seo = readJsonIfExists<FindingTally>(path.join(PATHS.reports.seo, 'summary.json'));
  const content = readJsonIfExists<FindingTally>(path.join(PATHS.reports.content, 'summary.json'));
  const cross = readJsonIfExists<{
    executedBrowsers?: string[];
    qaAllBrowsers?: string[];
    browsers?: string[];
  }>(path.join(PATHS.reports.crossBrowser, 'summary.json'));

  let crossBrowserNote: string | null = null;
  if (cross) {
    const dedicated = (cross.executedBrowsers ?? cross.browsers ?? []).join(', ') || 'not recorded';
    const qaAll = (cross.qaAllBrowsers ?? []).join(', ') || 'not recorded';
    crossBrowserNote =
      `Cross-browser stage: dedicated 3-engine runner executed [${dedicated}]. ` +
      `qa:all / e2e playwright.browsers was [${qaAll}]. WebKit ≠ iOS Safari; Chromium ≠ Android Chrome.`;
  }

  return {
    jmeterStatus: jmeter?.status ?? null,
    uiStatus: ui?.status ?? null,
    coveragePercent: coverage?.totals?.itemCoveragePercent ?? null,
    security: security ?? null,
    seo: seo ?? null,
    content: content ?? null,
    crossBrowserNote,
  };
}

export function buildSuiteRollup(results: StageResult[], artifacts: SuiteRollupArtifacts = {}): SuiteRollup {
  const playwright = fromStage(stageByKey(results, 'e2e')?.status);
  const postman = fromStage(stageByKey(results, 'api')?.status);
  const performance = fromStage(stageByKey(results, 'performance')?.status);
  const accessibility = fromStage(stageByKey(results, 'accessibility')?.status);
  const visual = fromStage(stageByKey(results, 'visual')?.status);
  const responsive = fromStage(stageByKey(results, 'responsive')?.status);
  const security = applyFindingTally(fromStage(stageByKey(results, 'security')?.status), artifacts.security);
  const seo = applyFindingTally(
    worstSeo(fromStage(stageByKey(results, 'seo')?.status), fromStage(stageByKey(results, 'content')?.status)),
    artifacts.seo
  );
  const seoWithContent = applyFindingTally(seo, artifacts.content);
  const jmeter = jmeterDisplay(performance, artifacts.jmeterStatus);
  const coverage = coverageLine(fromStage(stageByKey(results, 'coverage')?.status), artifacts.coveragePercent);

  const required: SuiteRollupLine[] = [
    { label: 'PLAYWRIGHT', status: playwright },
    { label: 'POSTMAN', status: postman },
    { label: 'JMETER', status: jmeter, detail: 'liveness/smoke only — never PASS; no --authorize-heavy' },
    { label: 'ACCESSIBILITY', status: accessibility },
    { label: 'VISUAL', status: visual },
    { label: 'RESPONSIVE', status: responsive },
    { label: 'SECURITY', status: security },
    { label: 'SEO', status: seoWithContent, detail: 'SEO + content stages' },
    { label: 'COVERAGE', ...coverage },
  ];

  const overall = resolveOverallStatus(required);
  const lines: SuiteRollupLine[] = [...required, { label: 'OVERALL', status: overall }];

  const notes: string[] = [
    `UI performance: ${artifacts.uiStatus ?? performance} (same child process as JMeter smoke; liveness only)`,
  ];
  if (artifacts.crossBrowserNote) notes.push(artifacts.crossBrowserNote);

  return {
    lines,
    overall,
    notes,
    banner: formatSuiteRollupBanner(lines, notes),
  };
}

export function collectSuiteRollup(results: StageResult[]): SuiteRollup {
  return buildSuiteRollup(results, loadSuiteRollupArtifacts());
}
