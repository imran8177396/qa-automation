import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths';
import { readJsonIfExists } from '../../discovery/write-json';
import { A11Y_DISCLAIMER, A11Y_LIMITATIONS, type AccessibilitySummary } from '../../accessibility/types';
import { SECURITY_DISCLAIMER, SECURITY_LIMITATIONS, type SecurityFinding, type SecuritySummary } from '../../security/types';
import { CONTENT_DISCLAIMER, CONTENT_LIMITATIONS, type ContentFinding, type ContentSummary } from '../../content/types';
import type { LighthousePageMetrics, LighthouseSummary } from '../../lighthouse/types';
import { NOT_AVAILABLE } from '../suite-origin';
import type {
  FailureAnalysisFinding,
  FailureAnalysisSection216,
  FailureAnalysisSummary,
} from '../../failures/types';
import { FAILURE_ANALYSIS_DISCLAIMER, FAILURE_ANALYSIS_LIMITATIONS } from '../../failures/types';
import type { RetestSection217, RetestSection217Row, RetestSummary } from '../../retest/types';
import { RETEST_DISCLAIMER, RETEST_LIMITATIONS } from '../../retest/types';

export { NOT_AVAILABLE };

export interface AxeViolationRow {
  ruleId: string;
  impact: string;
  wcag: string;
  selector: string;
  html: string;
  nodeCount: string;
  helpUrl: string;
  page: string;
}

export interface AccessibilitySectionModel {
  available: boolean;
  status: string;
  source: string;
  pagesAnalyzed: number;
  uniquePageCount: number;
  violationCount: number;
  incompleteCount: number;
  suitePassed: boolean;
  byImpact: { critical: number; serious: number; moderate: number; minor: number; info: number };
  byPage: Array<{ page: string; violations: number }>;
  violations: AxeViolationRow[];
  findings: Array<{ status: string; rule: string; impact: string; page: string; detail: string }>;
  disclaimer: string;
  limitations: string[];
  missingReason: string;
}

export interface SecurityControlRow {
  page: string;
  control: string;
  status: string;
  observed: string;
}

export interface SecuritySectionModel {
  available: boolean;
  status: string;
  source: string;
  suitePassed: boolean;
  pagesAnalyzed: number;
  originsAnalyzed: number;
  failCount: number;
  passCount: number;
  noteCount: number;
  bySeverity: { high: number; medium: number; low: number; info: number };
  checklist: SecurityControlRow[];
  findings: Array<{
    status: string;
    rule: string;
    severity: string;
    page: string;
    expected: string;
    actual: string;
  }>;
  disclaimer: string;
  limitations: string[];
  missingReason: string;
}

export interface ContentSectionModel {
  available: boolean;
  status: string;
  source: string;
  suitePassed: boolean;
  pagesAnalyzed: number;
  failCount: number;
  passCount: number;
  noteCount: number;
  bySeverity: { high: number; medium: number; low: number; info: number };
  findings: Array<{
    status: string;
    rule: string;
    severity: string;
    page: string;
    expected: string;
    actual: string;
  }>;
  disclaimer: string;
  limitations: string[];
  missingReason: string;
}

export interface VisualDiffRow {
  page: string;
  diffPercent: string;
  threshold: string;
  baselinePath: string;
  actualPath: string;
  diffPath: string;
}

export interface VisualSectionModel {
  available: boolean;
  status: string;
  source: string;
  baselineCount: number | typeof NOT_AVAILABLE;
  comparedCount: number | typeof NOT_AVAILABLE;
  newBaselineCount: number | typeof NOT_AVAILABLE;
  diffs: VisualDiffRow[];
  note: string;
  missingReason: string;
}

interface StructuredAxeResults {
  violations?: Array<{
    id?: string;
    impact?: string;
    helpUrl?: string;
    tags?: string[];
    nodes?: Array<{ target?: string[]; html?: string }>;
    url?: string;
  }>;
  url?: string;
  pages?: Array<{
    url?: string;
    path?: string;
    violations?: StructuredAxeResults['violations'];
  }>;
}

function wcagFromTags(tags: string[] | undefined): string {
  if (!tags?.length) return NOT_AVAILABLE;
  const mapped = tags
    .filter((tag) => /^wcag\d+/i.test(tag))
    .map((tag) => {
      const digits = tag.replace(/[^0-9]/g, '');
      if (digits.length >= 3) return `${digits[0]}.${digits[1]}.${digits.slice(2)}`;
      return tag;
    });
  return mapped.length > 0 ? mapped.join(', ') : NOT_AVAILABLE;
}

function asAxeRows(violations: NonNullable<StructuredAxeResults['violations']>, page: string): AxeViolationRow[] {
  return violations.map((row) => ({
    ruleId: row.id ?? NOT_AVAILABLE,
    impact: row.impact ?? NOT_AVAILABLE,
    wcag: wcagFromTags(row.tags),
    selector: row.nodes?.[0]?.target?.join(' ') ?? NOT_AVAILABLE,
    html: row.nodes?.[0]?.html ?? NOT_AVAILABLE,
    nodeCount: row.nodes ? String(row.nodes.length) : NOT_AVAILABLE,
    helpUrl: row.helpUrl ?? NOT_AVAILABLE,
    page,
  }));
}

function looksLikePlaywrightJson(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && 'suites' in raw && 'config' in raw);
}

export function loadAccessibilitySection(uniquePageCount: number): AccessibilitySectionModel {
  const resultsPath = path.join(PATHS.reports.accessibility, 'results.json');
  const summaryPath = path.join(PATHS.reports.accessibility, 'summary.json');
  const findingsPath = path.join(PATHS.reports.accessibility, 'findings.json');
  const summary = readJsonIfExists<AccessibilitySummary>(summaryPath);
  const structured =
    readJsonIfExists<StructuredAxeResults>(findingsPath) ??
    readJsonIfExists<StructuredAxeResults>(resultsPath);
  const rawResults = readJsonIfExists<unknown>(resultsPath);

  const empty: AccessibilitySectionModel = {
    available: false,
    status: 'NOT_EXECUTED',
    source: NOT_AVAILABLE,
    pagesAnalyzed: 0,
    uniquePageCount,
    violationCount: 0,
    incompleteCount: 0,
    suitePassed: false,
    byImpact: { critical: 0, serious: 0, moderate: 0, minor: 0, info: 0 },
    byPage: [],
    violations: [],
    findings: [],
    disclaimer: A11Y_DISCLAIMER,
    limitations: [...A11Y_LIMITATIONS],
    missingReason: 'reports/accessibility/results.json and summary.json were not present.',
  };

  if (!summary && !structured && !rawResults) return empty;

  let violations: AxeViolationRow[] = [];
  let source = 'reports/accessibility/summary.json';

  if (structured && !looksLikePlaywrightJson(structured) && (structured.violations || structured.pages)) {
    source = fs.existsSync(findingsPath)
      ? 'reports/accessibility/findings.json'
      : 'reports/accessibility/results.json';
    if (structured.pages) {
      for (const page of structured.pages) {
        violations.push(...asAxeRows(page.violations ?? [], page.url ?? page.path ?? NOT_AVAILABLE));
      }
    } else {
      violations = asAxeRows(structured.violations ?? [], structured.url ?? NOT_AVAILABLE);
    }
  } else if (looksLikePlaywrightJson(rawResults)) {
    source = 'reports/accessibility/results.json (Playwright JSON — no per-violation axe fields)';
  }

  const byPageMap = new Map<string, number>();
  for (const row of violations) {
    byPageMap.set(row.page, (byPageMap.get(row.page) ?? 0) + 1);
  }

  return {
    available: true,
    status: summary ? (summary.passed ? 'PASS' : 'FAIL') : violations.length > 0 ? 'FAIL' : 'RECORDED',
    source,
    pagesAnalyzed: summary?.pagesAnalyzed ?? (byPageMap.size || 0),
    uniquePageCount,
    violationCount: summary?.violationCount ?? violations.length,
    incompleteCount: summary?.incompleteCount ?? 0,
    suitePassed: summary?.passed ?? violations.length === 0,
    byImpact: summary?.byImpact ?? { critical: 0, serious: 0, moderate: 0, minor: 0, info: 0 },
    byPage: [...byPageMap.entries()].map(([page, count]) => ({ page, violations: count })),
    violations,
    findings: (summary?.findings ?? []).map((f) => ({
      status: f.status,
      rule: f.rule,
      impact: f.impact,
      page: `${f.page} (${f.pagePath})`,
      detail: f.actual,
    })),
    disclaimer: summary?.disclaimer ?? A11Y_DISCLAIMER,
    limitations: summary?.limitations ?? [...A11Y_LIMITATIONS],
    missingReason:
      violations.length === 0
        ? 'Per-violation axe fields (rule ID, WCAG, selector, snippet) were not present in results.json.'
        : '',
  };
}

const SECURITY_CONTROLS = [
  { id: 'csp', match: /content-security-policy|csp/i, label: 'CSP' },
  { id: 'hsts', match: /strict-transport-security|hsts/i, label: 'HSTS' },
  { id: 'frame', match: /x-frame-options|frame-ancestors|clickjack/i, label: 'X-Frame-Options or frame-ancestors' },
  { id: 'xcto', match: /x-content-type-options/i, label: 'X-Content-Type-Options' },
  { id: 'referrer', match: /referrer-policy/i, label: 'Referrer-Policy' },
  { id: 'permissions', match: /permissions-policy/i, label: 'Permissions-Policy' },
  { id: 'cookie', match: /cookie|samesite|httponly/i, label: 'Cookie Secure/HttpOnly/SameSite' },
  { id: 'tls', match: /tls|https/i, label: 'TLS version' },
  { id: 'cert', match: /cert/i, label: 'Cert expiry' },
  { id: 'banner', match: /server.?banner|server header/i, label: 'Server banner' },
  { id: 'directory-listing', match: /directory-listing|autoindex/i, label: 'Directory listing' },
  { id: 'build-artifact', match: /build-artifact|source.?map|__next/i, label: 'Exposed source maps/build artifacts' },
] as const;

function controlForFinding(finding: SecurityFinding): string {
  const hay = `${finding.rule} ${finding.detail}`;
  const match = SECURITY_CONTROLS.find((row) => row.match.test(hay));
  return match?.label ?? finding.rule;
}

export function loadSecuritySection(): SecuritySectionModel {
  const resultsPath = path.join(PATHS.reports.security, 'results.json');
  const summaryPath = path.join(PATHS.reports.security, 'summary.json');
  const results = readJsonIfExists<SecuritySummary>(resultsPath);
  const summary = results ?? readJsonIfExists<SecuritySummary>(summaryPath);

  if (!summary) {
    return {
      available: false,
      status: 'NOT_EXECUTED',
      source: NOT_AVAILABLE,
      suitePassed: false,
      pagesAnalyzed: 0,
      originsAnalyzed: 0,
      failCount: 0,
      passCount: 0,
      noteCount: 0,
      bySeverity: { high: 0, medium: 0, low: 0, info: 0 },
      checklist: [],
      findings: [],
      disclaimer: SECURITY_DISCLAIMER,
      limitations: [...SECURITY_LIMITATIONS],
      missingReason: 'reports/security/results.json and summary.json were not present.',
    };
  }

  const findings = summary.findings ?? [];
  const pages = [...new Set(findings.map((row) => row.page ?? row.pagePath ?? NOT_AVAILABLE))];
  const checklist: SecurityControlRow[] = [];

  for (const page of pages) {
    const pageFindings = findings.filter((row) => (row.page ?? row.pagePath ?? NOT_AVAILABLE) === page);
    for (const control of SECURITY_CONTROLS) {
      const hit = pageFindings.find((row) => control.match.test(`${row.rule} ${row.detail}`));
      checklist.push({
        page,
        control: control.label,
        status: hit?.status ?? NOT_AVAILABLE,
        observed: hit?.actual ?? hit?.detail ?? NOT_AVAILABLE,
      });
    }
  }

  return {
    available: true,
    status: summary.passed ? 'PASS' : 'FAIL',
    source: results ? 'reports/security/results.json' : 'reports/security/summary.json',
    suitePassed: summary.passed,
    pagesAnalyzed: summary.pagesAnalyzed,
    originsAnalyzed: summary.originsAnalyzed,
    failCount: summary.failCount,
    passCount: summary.passCount,
    noteCount: summary.noteCount,
    bySeverity: summary.bySeverity,
    checklist,
    findings: findings.map((row) => ({
      status: row.status,
      rule: row.rule,
      severity: row.severity,
      page: row.pagePath ? `${row.page ?? NOT_AVAILABLE} (${row.pagePath})` : (row.page ?? NOT_AVAILABLE),
      expected: row.expected ?? NOT_AVAILABLE,
      actual: row.actual ?? row.detail ?? NOT_AVAILABLE,
    })),
    disclaimer: summary.disclaimer ?? SECURITY_DISCLAIMER,
    limitations: summary.limitations ?? [...SECURITY_LIMITATIONS],
    missingReason: '',
  };
}

export function loadContentSection(): ContentSectionModel {
  const resultsPath = path.join(PATHS.reports.content, 'results.json');
  const summaryPath = path.join(PATHS.reports.content, 'summary.json');
  const results = readJsonIfExists<ContentSummary>(resultsPath);
  const summary = results ?? readJsonIfExists<ContentSummary>(summaryPath);

  if (!summary) {
    return {
      available: false,
      status: 'NOT_EXECUTED',
      source: NOT_AVAILABLE,
      suitePassed: false,
      pagesAnalyzed: 0,
      failCount: 0,
      passCount: 0,
      noteCount: 0,
      bySeverity: { high: 0, medium: 0, low: 0, info: 0 },
      findings: [],
      disclaimer: CONTENT_DISCLAIMER,
      limitations: [...CONTENT_LIMITATIONS],
      missingReason: 'reports/content/results.json and summary.json were not present.',
    };
  }

  return {
    available: true,
    status: summary.passed ? 'PASS' : 'FAIL',
    source: results ? 'reports/content/results.json' : 'reports/content/summary.json',
    suitePassed: summary.passed,
    pagesAnalyzed: summary.pagesAnalyzed,
    failCount: summary.failCount,
    passCount: summary.passCount,
    noteCount: summary.noteCount,
    bySeverity: summary.bySeverity,
    findings: (summary.findings ?? []).map((row: ContentFinding) => ({
      status: row.status,
      rule: row.rule,
      severity: row.severity,
      page: row.page,
      expected: row.expected ?? NOT_AVAILABLE,
      actual: row.actual ?? row.detail ?? NOT_AVAILABLE,
    })),
    disclaimer: summary.disclaimer ?? CONTENT_DISCLAIMER,
    limitations: summary.limitations ?? [...CONTENT_LIMITATIONS],
    missingReason: '',
  };
}

interface VisualSummaryFile {
  generatedAt?: string;
  target?: string;
  updateBaselines?: boolean;
  passed?: boolean;
  resultsFile?: string;
  baselinesDir?: string;
  note?: string;
  baselineCount?: number;
  comparedCount?: number;
  newBaselineCount?: number;
  diffs?: VisualDiffRow[];
  threshold?: number | string;
}

function countFilesRecursive(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFilesRecursive(full);
    else count += 1;
  }
  return count;
}

export function loadVisualSection(): VisualSectionModel {
  const summaryPath = path.join(PATHS.reports.visual, 'summary.json');
  const summary = readJsonIfExists<VisualSummaryFile>(summaryPath);
  const baselineDir = summary?.baselinesDir ?? PATHS.visualBaselinesDir;
  const baselineCount = fs.existsSync(baselineDir) ? countFilesRecursive(baselineDir) : 0;

  if (!summary && baselineCount === 0) {
    return {
      available: false,
      status: 'NOT_EXECUTED',
      source: NOT_AVAILABLE,
      baselineCount: 0,
      comparedCount: NOT_AVAILABLE,
      newBaselineCount: NOT_AVAILABLE,
      diffs: [],
      note: 'No visual baselines and no reports/visual/summary.json.',
      missingReason: 'No visual baselines were present; visual comparison was not executed.',
    };
  }

  if (baselineCount === 0) {
    return {
      available: Boolean(summary),
      status: 'NOT_EXECUTED',
      source: summary ? 'reports/visual/summary.json' : NOT_AVAILABLE,
      baselineCount: 0,
      comparedCount: summary?.comparedCount ?? NOT_AVAILABLE,
      newBaselineCount: summary?.newBaselineCount ?? (summary?.updateBaselines ? NOT_AVAILABLE : 0),
      diffs: summary?.diffs ?? [],
      note: summary?.note ?? 'No visual baselines were present.',
      missingReason: 'No visual baselines were present; status is NOT_EXECUTED.',
    };
  }

  return {
    available: true,
    status: summary?.passed === false ? 'FAIL' : summary?.passed === true ? 'PASS' : 'RECORDED',
    source: summary ? 'reports/visual/summary.json' : 'visual-baselines/',
    baselineCount: summary?.baselineCount ?? baselineCount,
    comparedCount: summary?.comparedCount ?? NOT_AVAILABLE,
    newBaselineCount: summary?.newBaselineCount ?? NOT_AVAILABLE,
    diffs: summary?.diffs ?? [],
    note: summary?.note ?? '',
    missingReason: summary?.diffs ? '' : 'Per-page diff % was not present in the visual artifact.',
  };
}

export function loadStageTimelineRows(): StageTimelineLike[] | null {
  const json = readJsonIfExists<{ stages?: StageTimelineLike[] }>(
    path.join(PATHS.reports.orchestrator, 'timeline.json')
  );
  if (json?.stages?.length) return json.stages;
  const summary = readJsonIfExists<{ stages?: StageTimelineLike[] }>(
    path.join(PATHS.reports.orchestrator, 'summary.json')
  );
  if (summary?.stages?.length) return summary.stages;
  return null;
}

export interface StageTimelineLike {
  id?: number;
  key?: string;
  name?: string;
  phase?: string;
  status?: string;
  exitCode?: number | null;
  startedAt?: string;
  completedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  reason?: string;
  executedCount?: number;
}

export interface LighthousePageRow {
  url: string;
  status: string;
  reason: string;
  lcpMs: string;
  cls: string;
  inpMs: string;
  tbtMs: string;
  performanceScore: string;
  accessibilityScore: string;
  bestPracticesScore: string;
  seoScore: string;
}

export interface LighthouseSectionModel {
  available: boolean;
  status: string;
  source: string;
  skipReason: string;
  pageSource: string;
  chromePath: string;
  lighthouseCommand: string;
  thresholdStatus: string;
  thresholdNote: string;
  pages: LighthousePageRow[];
  comparisons: Array<{ metric: string; limit: string; actual: string; status: string }>;
  missingReason: string;
}

function lighthouseMetric(value: number | typeof NOT_AVAILABLE | null | undefined): string {
  if (value == null || value === NOT_AVAILABLE) return NOT_AVAILABLE;
  return String(value);
}

function asLighthousePageRow(page: LighthousePageMetrics): LighthousePageRow {
  return {
    url: page.url || NOT_AVAILABLE,
    status: page.status || NOT_AVAILABLE,
    reason: page.reason ?? NOT_AVAILABLE,
    lcpMs: lighthouseMetric(page.lcpMs),
    cls: lighthouseMetric(page.cls),
    inpMs: lighthouseMetric(page.inpMs),
    tbtMs: lighthouseMetric(page.tbtMs),
    performanceScore: lighthouseMetric(page.performanceScore),
    accessibilityScore: lighthouseMetric(page.accessibilityScore),
    bestPracticesScore: lighthouseMetric(page.bestPracticesScore),
    seoScore: lighthouseMetric(page.seoScore),
  };
}

export function loadLighthouseSection(): LighthouseSectionModel {
  const summaryPath = PATHS.lighthouseSummary;
  const summary = readJsonIfExists<LighthouseSummary>(summaryPath);

  if (!summary) {
    return {
      available: false,
      status: 'NOT_EXECUTED',
      source: NOT_AVAILABLE,
      skipReason: 'reports/lighthouse/summary.json was not present.',
      pageSource: NOT_AVAILABLE,
      chromePath: NOT_AVAILABLE,
      lighthouseCommand: NOT_AVAILABLE,
      thresholdStatus: NOT_AVAILABLE,
      thresholdNote: NOT_AVAILABLE,
      pages: [],
      comparisons: [],
      missingReason: 'reports/lighthouse/summary.json was not present.',
    };
  }

  return {
    available: true,
    status: summary.status,
    source: 'reports/lighthouse/summary.json',
    skipReason: summary.skipReason ?? NOT_AVAILABLE,
    pageSource: summary.pageSource ?? NOT_AVAILABLE,
    chromePath: summary.chromePath ?? NOT_AVAILABLE,
    lighthouseCommand: summary.lighthouseCommand ?? NOT_AVAILABLE,
    thresholdStatus: summary.thresholds?.status ?? NOT_AVAILABLE,
    thresholdNote: summary.thresholds?.note ?? NOT_AVAILABLE,
    pages: (summary.pages ?? []).map(asLighthousePageRow),
    comparisons: (summary.thresholds?.comparisons ?? []).map((row) => ({
      metric: row.metric,
      limit: row.limit == null ? NOT_AVAILABLE : String(row.limit),
      actual: lighthouseMetric(row.actual),
      status: row.status,
    })),
    missingReason:
      summary.status === 'NOT_EXECUTED'
        ? summary.skipReason ?? 'Lighthouse was not executed.'
        : '',
  };
}

/** Required 2.16 header — classifications are not defect tickets. */
export const FAILURE_ANALYSIS_NOT_TICKETS =
  'Classifications are evidence-based and are not defect tickets.';

export interface FailureAnalysisRow {
  testId: string;
  classification: string;
  evidenceExcerpt: string;
  ruleFired: string;
}

export interface FailureAnalysisSectionModel {
  available: boolean;
  status: string;
  source: string;
  analyzed: number;
  byClass: Record<string, number>;
  rows: FailureAnalysisRow[];
  disclaimer: string;
  limitations: string[];
  missingReason: string;
}

export interface RetestRow {
  testId: string;
  originalStatus: string;
  retestStatus: string;
  runCount: number | typeof NOT_AVAILABLE;
  stabilityVerdict: string;
}

export interface RetestSectionModel {
  available: boolean;
  status: string;
  source: string;
  reason: string;
  /** Always false in the report model — dry-run is NOT_EXECUTED, never DRY_RUN. */
  dryRun: false;
  selected: number;
  notSelected: number;
  executed: number;
  runCount: number | typeof NOT_AVAILABLE;
  stabilityVerdict: string;
  disabledReason: string;
  byFinalStatus: Record<string, number>;
  items: RetestRow[];
  disclaimer: string;
  limitations: string[];
  missingReason: string;
}

function asText(value: unknown, fallback = NOT_AVAILABLE): string {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function rowFromSection216(row: {
  testId?: string;
  classification?: string;
  evidenceExcerpt?: string;
  ruleFired?: string;
}): FailureAnalysisRow {
  return {
    testId: asText(row.testId),
    classification: asText(row.classification),
    evidenceExcerpt: asText(row.evidenceExcerpt),
    ruleFired: asText(row.ruleFired),
  };
}

export function mapFailureAnalysisRows(
  section216: FailureAnalysisSection216 | null | undefined,
  summary: FailureAnalysisSummary | null | undefined
): FailureAnalysisRow[] {
  if (section216?.rows?.length) {
    return section216.rows.map(rowFromSection216);
  }
  const findings = summary?.findings as FailureAnalysisFinding[] | undefined;
  if (findings?.length) {
    return findings.map((row) =>
      rowFromSection216({
        testId: row.testId,
        classification: row.classification,
        evidenceExcerpt: row.evidenceExcerpt,
        ruleFired: row.ruleFired,
      })
    );
  }
  if (summary?.failures?.length) {
    return summary.failures.map((row) =>
      rowFromSection216({
        testId: row.testId,
        classification: row.classification,
        evidenceExcerpt: row.evidenceExcerpt,
        ruleFired: row.ruleFired,
      })
    );
  }
  return [];
}

export function loadFailureAnalysisSection(): FailureAnalysisSectionModel {
  const sectionPath = path.join(PATHS.reports.failures, 'section-2.16.json');
  const summaryPath = path.join(PATHS.reports.failures, 'summary.json');
  const section216 = readJsonIfExists<FailureAnalysisSection216>(sectionPath);
  const summary = readJsonIfExists<FailureAnalysisSummary>(summaryPath);
  const rows = mapFailureAnalysisRows(section216, summary);

  if (!section216 && !summary) {
    return {
      available: false,
      status: 'NOT_EXECUTED',
      source: NOT_AVAILABLE,
      analyzed: 0,
      byClass: {},
      rows: [],
      disclaimer: FAILURE_ANALYSIS_DISCLAIMER,
      limitations: [...FAILURE_ANALYSIS_LIMITATIONS],
      missingReason:
        'reports/failures/section-2.16.json and reports/failures/summary.json were not present.',
    };
  }

  const source = section216
    ? 'reports/failures/section-2.16.json'
    : 'reports/failures/summary.json';
  const byClass = section216?.byClass ?? summary?.byClass ?? {};
  const analyzed = summary?.analyzed ?? summary?.totalFailures ?? rows.length;

  return {
    available: true,
    status: 'RECORDED',
    source,
    analyzed,
    byClass,
    rows,
    disclaimer: section216?.disclaimer ?? summary?.disclaimer ?? FAILURE_ANALYSIS_DISCLAIMER,
    limitations: summary?.limitations ?? [...FAILURE_ANALYSIS_LIMITATIONS],
    missingReason: rows.length === 0 ? 'no classified failures were present' : '',
  };
}

const UNSTABLE_VERDICT = 'FAIL → PASS (unstable)';
const REPRODUCED_VERDICT = 'FAIL → FAIL (reproduced)';
const NOT_RETESTED_VERDICT = 'FAIL → NOT_EXECUTED';

export function stabilityVerdictForStatuses(
  originalStatus: string,
  retestStatus: string
): string {
  if (originalStatus === 'FAIL' && retestStatus === 'PASS') return UNSTABLE_VERDICT;
  if (originalStatus === 'FAIL' && retestStatus === 'FAIL') return REPRODUCED_VERDICT;
  return NOT_RETESTED_VERDICT;
}

function rowFromSection217(row: Partial<RetestSection217Row> & {
  finalStatus?: string;
  runCount?: number;
}): RetestRow {
  const originalStatus = asText(row.originalStatus, 'FAIL');
  const retestStatus = asText(row.retestStatus ?? row.finalStatus, 'NOT_EXECUTED');
  const fromArtifact =
    typeof row.stabilityVerdict === 'string' ? row.stabilityVerdict.trim() : '';
  return {
    testId: asText(row.testId),
    originalStatus,
    retestStatus,
    runCount: typeof row.runCount === 'number' ? row.runCount : NOT_AVAILABLE,
    stabilityVerdict:
      retestStatus === 'PASS'
        ? UNSTABLE_VERDICT
        : fromArtifact || stabilityVerdictForStatuses(originalStatus, retestStatus),
  };
}

export function mapRetestRows(
  section217: RetestSection217 | null | undefined,
  summary: RetestSummary | null | undefined
): RetestRow[] {
  if (section217?.rows?.length) {
    return section217.rows.map((row) => rowFromSection217(row));
  }
  if (summary?.items?.length) {
    return summary.items.map((row) =>
      rowFromSection217({
        testId: row.testId,
        originalStatus: row.originalStatus,
        retestStatus: row.retestStatus,
        finalStatus: row.finalStatus,
        runCount: row.runCount,
        stabilityVerdict: row.stabilityVerdict,
      })
    );
  }
  return [];
}

export function loadRetestSection(options: { enabled: boolean }): RetestSectionModel {
  const sectionPath = path.join(PATHS.reports.retest, 'section-2.17.json');
  const summaryPath = path.join(PATHS.reports.retest, 'summary.json');
  const section217 = readJsonIfExists<RetestSection217>(sectionPath);
  const summary = readJsonIfExists<RetestSummary>(summaryPath);
  const items = mapRetestRows(section217, summary);

  const missingReason = options.enabled
    ? 'reports/retest/section-2.17.json was not present.'
    : 'Retest is disabled in qa.config.json (retest.enabled = false).';

  if (!section217 && !summary) {
    return {
      available: false,
      status: 'NOT_EXECUTED',
      source: NOT_AVAILABLE,
      reason: missingReason,
      dryRun: false,
      selected: 0,
      notSelected: 0,
      executed: 0,
      runCount: NOT_AVAILABLE,
      stabilityVerdict: 'NOT_EXECUTED',
      disabledReason: missingReason,
      byFinalStatus: {},
      items: [],
      disclaimer: RETEST_DISCLAIMER,
      limitations: [...RETEST_LIMITATIONS],
      missingReason,
    };
  }

  const source = section217
    ? 'reports/retest/section-2.17.json'
    : 'reports/retest/summary.json';
  const rawDryRun = Boolean((summary as { dryRun?: boolean } | null)?.dryRun);
  const artifactStatus = section217?.status ?? summary?.status;
  const artifactReason =
    section217?.reason ??
    summary?.reason ??
    summary?.disabledReason ??
    (rawDryRun
      ? 'Retest was a dry-run; no executions. Status is NOT_EXECUTED, not DRY_RUN.'
      : '');

  const executed =
    summary?.executed ?? items.filter((row) => row.retestStatus !== 'NOT_EXECUTED').length;
  const status =
    !options.enabled || rawDryRun || executed === 0 || artifactStatus === 'NOT_EXECUTED'
      ? 'NOT_EXECUTED'
      : artifactStatus ?? 'RECORDED';

  const reason =
    status === 'NOT_EXECUTED'
      ? artifactReason ||
        (!options.enabled
          ? 'Retest is disabled in qa.config.json (retest.enabled = false).'
          : rawDryRun
            ? 'Retest was a dry-run; no executions. Status is NOT_EXECUTED, not DRY_RUN.'
            : 'Retest was not executed. Original FAIL records were not overwritten.')
      : artifactReason || 'Retest recorded against original FAIL evidence.';

  const unstable = items.filter((row) => row.stabilityVerdict === UNSTABLE_VERDICT).length;
  const runCount =
    typeof summary?.runCount === 'number'
      ? summary.runCount
      : items.every((row) => typeof row.runCount === 'number')
        ? items.reduce((sum, row) => sum + (row.runCount as number), 0)
        : NOT_AVAILABLE;

  return {
    available: true,
    status,
    source,
    reason,
    dryRun: false,
    selected: summary?.selected ?? items.length,
    notSelected: summary?.notSelected ?? 0,
    executed,
    runCount,
    stabilityVerdict:
      unstable > 0
        ? `${unstable} ${UNSTABLE_VERDICT} — original FAIL preserved`
        : status === 'NOT_EXECUTED'
          ? 'NOT_EXECUTED'
          : summary?.stabilityVerdict || 'RECORDED',
    disabledReason: status === 'NOT_EXECUTED' ? reason : '',
    byFinalStatus: summary?.byFinalStatus ?? {},
    items,
    disclaimer: summary?.disclaimer ?? RETEST_DISCLAIMER,
    limitations: summary?.limitations ?? [...RETEST_LIMITATIONS],
    missingReason: items.length === 0 ? reason || 'no retest items were present' : '',
  };
}
