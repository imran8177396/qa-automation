import fs from 'fs';
import path from 'path';
import { readJsonIfExists } from '../../discovery/write-json';
import type { DiscoveryResult } from '../../discovery/types';
import type { InventoryResult } from '../../inventory/types';
import type { CoverageRecord, CoverageReport, CoverageSummary } from '../../coverage/types';
import type { QualityGateResult } from '../../orchestrator/quality-gate';
import { PATHS } from '../paths';
import { loadConfig } from '../load-config';
import { NOT_AVAILABLE } from '../suite-origin';
import {
  dirHasRealContent,
  loadExecutionIdentity,
  type ExecutionIdentity,
  type ExecutionMetadata,
  type ProjectNameSource,
} from './execution-archive';
import {
  buildDomainMatrix,
  buildMasterNormalizedSummary,
  displaySectionStatus,
  type ArtifactFinding,
  type FailuresSummaryLike,
  type MasterNormalizedSummary,
  type MasterSectionKind,
  type RetestSummaryLike,
} from './master-report-summary';
import { formatDurationBetween, PKT_OFFSET, PKT_TIMEZONE } from './timestamps';
import type { PlaywrightSuiteName } from '../playwright-suites';

export const MASTER_SECTION_DEFS = [
  { id: 'executive-summary', title: 'EXECUTIVE SUMMARY', kind: 'executive' },
  { id: 'key-findings', title: 'KEY FINDINGS', kind: 'standard' },
  { id: 'qa-execution-information', title: 'QA EXECUTION INFORMATION', kind: 'standard' },
  { id: 'test-scope-environment', title: 'TEST SCOPE & ENVIRONMENT', kind: 'standard' },
  { id: 'application-discovery', title: 'APPLICATION DISCOVERY', kind: 'standard' },
  { id: 'coverage', title: 'COVERAGE', kind: 'standard' },
  { id: 'functional-ui-e2e', title: 'FUNCTIONAL UI / E2E', kind: 'domain' },
  { id: 'responsive-testing', title: 'RESPONSIVE TESTING', kind: 'domain' },
  { id: 'cross-browser-testing', title: 'CROSS-BROWSER TESTING', kind: 'domain' },
  { id: 'visual-testing', title: 'VISUAL TESTING', kind: 'domain' },
  { id: 'accessibility-testing', title: 'ACCESSIBILITY TESTING', kind: 'domain' },
  { id: 'api-testing', title: 'API TESTING', kind: 'domain' },
  { id: 'ui-api-correlation', title: 'UI/API CORRELATION', kind: 'domain' },
  { id: 'performance-testing', title: 'PERFORMANCE TESTING', kind: 'domain' },
  { id: 'security-qa', title: 'SECURITY QA', kind: 'domain' },
  { id: 'seo-qa', title: 'SEO QA', kind: 'domain' },
  { id: 'content-qa', title: 'CONTENT QA', kind: 'domain' },
  { id: 'workflow-testing', title: 'WORKFLOW TESTING', kind: 'domain' },
  { id: 'defect-risk-summary', title: 'DEFECT / RISK SUMMARY', kind: 'analysis' },
  { id: 'failure-analysis', title: 'FAILURE ANALYSIS', kind: 'analysis' },
  { id: 'retest-results', title: 'RETEST RESULTS', kind: 'analysis' },
  { id: 'recommended-actions', title: 'RECOMMENDED ACTIONS', kind: 'analysis' },
  { id: 'final-coverage-matrix', title: 'FINAL COVERAGE MATRIX', kind: 'analysis' },
  { id: 'release-quality-assessment', title: 'RELEASE QUALITY ASSESSMENT', kind: 'analysis' },
  { id: 'appendix-a-test-case-details', title: 'APPENDIX A — TEST CASE DETAILS', kind: 'appendix', letter: 'A' },
  { id: 'appendix-b-failure-evidence', title: 'APPENDIX B — FAILURE EVIDENCE', kind: 'appendix', letter: 'B' },
  { id: 'appendix-c-screenshots', title: 'APPENDIX C — SCREENSHOTS / VISUAL EVIDENCE', kind: 'appendix', letter: 'C' },
  { id: 'appendix-d-api-evidence', title: 'APPENDIX D — API EVIDENCE', kind: 'appendix', letter: 'D' },
  { id: 'appendix-e-browser-viewport', title: 'APPENDIX E — BROWSER / VIEWPORT MATRIX', kind: 'appendix', letter: 'E' },
  { id: 'appendix-f-configuration', title: 'APPENDIX F — CONFIGURATION & METHODOLOGY', kind: 'appendix', letter: 'F' },
] as const;

export type MasterSectionId = (typeof MASTER_SECTION_DEFS)[number]['id'];
export const MASTER_NUMBERED_SECTION_COUNT = MASTER_SECTION_DEFS.filter((row) => row.kind !== 'appendix').length;

export interface MasterTable {
  caption?: string;
  headers: string[];
  rows: string[][];
  emptyReason: string;
}

export interface MasterEvidenceRef {
  kind: string;
  label: string;
  path: string;
  available: boolean;
}

export interface MasterReportSection {
  id: MasterSectionId;
  number: number | string;
  title: string;
  heading: string;
  kind: MasterSectionKind;
  status: string;
  displayStatus: string;
  dataAvailable: boolean;
  unavailableReason: string;
  summaryText: string;
  paragraphs: string[];
  fields: Array<{ label: string; value: string }>;
  tables: MasterTable[];
  lists: string[];
  limitations: string[];
  evidence: MasterEvidenceRef[];
}

export interface MasterReportModel {
  generatedAt: string;
  timezone: typeof PKT_TIMEZONE;
  timezoneOffset: typeof PKT_OFFSET;
  projectName: string;
  projectNameSource: ProjectNameSource | typeof NOT_AVAILABLE;
  websiteName: string;
  websiteNameSource: ProjectNameSource | typeof NOT_AVAILABLE;
  hostnameFallback: boolean;
  baseUrl: string;
  executionId: string;
  folderPath: string;
  overallStatus: string;
  qualityGateStatus: string;
  summary: MasterNormalizedSummary;
  sections: MasterReportSection[];
  allure: { available: boolean; href: string; note: string };
}

export interface BuildMasterReportInput {
  reportsRoot?: string;
  folderPath?: string;
  identity?: ExecutionIdentity | null;
  metadata?: ExecutionMetadata | null;
  preferHistoryModules?: boolean;
}

interface ArtifactCtx {
  reportsRoot: string;
  folderPath: string;
  identity: ExecutionIdentity | null;
  metadata: ExecutionMetadata | null;
  preferHistoryModules: boolean;
}

interface StageLike {
  key?: string;
  name?: string;
  status?: string;
  reason?: string;
  executedCount?: number;
  exitCode?: number | null;
}

interface FindingLike {
  id?: string;
  testId?: string;
  rule?: string;
  status?: string;
  severity?: string;
  impact?: string;
  page?: string;
  pagePath?: string;
  expected?: string;
  actual?: string;
  detail?: string;
  title?: string;
  classification?: string;
  ownerClassification?: string;
  error?: string;
  errorMessage?: string;
}

function asText(value: unknown, fallback = NOT_AVAILABLE): string {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asCount(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value == null) return NOT_AVAILABLE;
  const text = String(value).trim();
  return text || NOT_AVAILABLE;
}

function moduleDir(ctx: ArtifactCtx, key: string): string {
  const current = path.join(ctx.reportsRoot, key);
  const archived = path.join(ctx.folderPath, 'modules', key);
  if (ctx.preferHistoryModules && dirHasRealContent(archived)) return archived;
  if (dirHasRealContent(current)) return current;
  if (dirHasRealContent(archived)) return archived;
  return current;
}

function readModuleJson<T>(ctx: ArtifactCtx, key: string, fileName: string): T | null {
  return readJsonIfExists<T>(path.join(moduleDir(ctx, key), fileName));
}

function fileExistsInModule(ctx: ArtifactCtx, key: string, fileName: string): boolean {
  return fs.existsSync(path.join(moduleDir(ctx, key), fileName));
}

function stageMap(ctx: ArtifactCtx): Map<string, StageLike> {
  const summary = readModuleJson<{ stages?: StageLike[] }>(ctx, 'orchestrator', 'summary.json');
  const timeline = readModuleJson<{ stages?: StageLike[] }>(ctx, 'orchestrator', 'timeline.json');
  const rows = summary?.stages ?? timeline?.stages ?? [];
  const map = new Map<string, StageLike>();
  for (const row of rows) {
    if (row.key) map.set(row.key, row);
  }
  return map;
}

function stageStatus(stages: Map<string, StageLike>, key: string): StageLike | undefined {
  return stages.get(key);
}

function section(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  partial: Omit<MasterReportSection, 'id' | 'number' | 'title' | 'heading' | 'kind' | 'displayStatus' | 'summaryText' | 'limitations'> &
    Partial<Pick<MasterReportSection, 'kind' | 'displayStatus' | 'summaryText' | 'limitations'>>
): MasterReportSection {
  return {
    ...partial,
    id: def.id,
    number,
    title: def.title,
    heading: typeof number === 'number' ? `${number}. ${def.title}` : def.title,
    kind: partial.kind ?? def.kind,
    displayStatus: partial.displayStatus ?? displaySectionStatus(partial.status),
    summaryText: partial.summaryText ?? '',
    limitations: partial.limitations ?? [],
  };
}

function notExecuted(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  reason: string,
  stage?: StageLike
): MasterReportSection {
  if (stage?.status === 'BLOCKED') {
    const because = asText(stage.reason, reason);
    return section(def, number, {
      status: 'BLOCKED',
      displayStatus: 'BLOCKED',
      dataAvailable: false,
      unavailableReason: because,
      summaryText: `BLOCKED. Execution could not proceed because ${because}.`,
      paragraphs: ['BLOCKED', `Execution could not proceed because ${because}.`],
      fields: [{ label: 'Status', value: 'BLOCKED' }],
      tables: [],
      lists: [],
      evidence: [],
    });
  }
  return section(def, number, {
    status: 'NOT_EXECUTED',
    displayStatus: 'NOT TESTED',
    dataAvailable: false,
    unavailableReason: reason,
    summaryText: 'NOT TESTED. No test execution was performed for this domain.',
    paragraphs: ['NOT TESTED', 'No test execution was performed for this domain.', reason],
    fields: [{ label: 'Status', value: 'NOT TESTED' }],
    tables: [],
    lists: [],
    evidence: [],
  });
}

function suiteStatusFromSummary(summary: { passed?: boolean; status?: string } | null, fallback: string): string {
  if (!summary) return fallback;
  if (typeof summary.status === 'string' && summary.status.trim()) return summary.status.trim();
  if (summary.passed === false) return 'FAIL';
  if (summary.passed === true) return 'PASS';
  return fallback;
}

function evidenceRef(folderPath: string, kind: string, raw: string | undefined, label: string): MasterEvidenceRef {
  const value = asText(raw);
  if (value === NOT_AVAILABLE || value === 'NOT_AVAILABLE') {
    return { kind, label, path: NOT_AVAILABLE, available: false };
  }
  const posix = value.replace(/\\/g, '/');
  const candidates: string[] = [];
  if (kind === 'screenshot') {
    candidates.push(path.join(folderPath, 'evidence', 'screenshots', posix));
    if (posix.startsWith('test-results/')) {
      candidates.push(path.join(folderPath, 'evidence', 'screenshots', posix));
    }
  } else if (kind === 'trace') {
    candidates.push(path.join(folderPath, 'evidence', 'traces', posix));
  } else if (kind === 'video') {
    candidates.push(path.join(folderPath, 'evidence', 'videos', posix));
  } else {
    candidates.push(path.join(folderPath, 'evidence', 'logs', posix));
  }
  candidates.push(path.join(PATHS.root, posix));
  candidates.push(path.isAbsolute(value) ? value : path.join(PATHS.root, value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const rel = path.relative(folderPath, candidate).replace(/\\/g, '/');
      return {
        kind,
        label,
        path: rel.startsWith('..') ? posix : rel,
        available: true,
      };
    }
  }
  return { kind, label, path: posix, available: false };
}

function countBy(findings: FindingLike[], key: (row: FindingLike) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of findings) {
    const bucket = key(row) || NOT_AVAILABLE;
    out[bucket] = (out[bucket] ?? 0) + 1;
  }
  return out;
}

function findingsTable(findings: FindingLike[], emptyReason: string): MasterTable {
  return {
    headers: ['ID / rule', 'Page', 'Status', 'Severity / impact', 'Expected', 'Actual / detail'],
    rows: findings.map((row) => [
      row.id && row.rule && row.id !== row.rule
        ? `${asText(row.id)} (${asText(row.rule)})`
        : asText(row.id ?? row.rule ?? row.testId),
      asText(row.page ?? row.pagePath),
      asText(row.status),
      asText(row.severity ?? row.impact),
      asText(row.expected),
      asText(row.actual ?? row.detail ?? row.error ?? row.errorMessage).slice(0, 400),
    ]),
    emptyReason,
  };
}

function loadCoverage(ctx: ArtifactCtx): CoverageReport | CoverageSummary | null {
  return (
    readModuleJson<CoverageReport>(ctx, 'coverage', 'coverage.json') ??
    readModuleJson<CoverageSummary>(ctx, 'coverage', 'summary.json')
  );
}

function loadQualityGate(ctx: ArtifactCtx): QualityGateResult | null {
  return readModuleJson<QualityGateResult>(ctx, 'orchestrator', 'quality-gate.json');
}

function loadFailures(ctx: ArtifactCtx): FailuresSummaryLike | null {
  return readModuleJson<FailuresSummaryLike>(ctx, 'failures', 'summary.json');
}

function loadRetest(ctx: ArtifactCtx): RetestSummaryLike | null {
  return readModuleJson<RetestSummaryLike>(ctx, 'retest', 'summary.json');
}

function collectModuleFindings(ctx: ArtifactCtx): Array<{ area: string; findings: ArtifactFinding[] }> {
  const modules: Array<[string, string, string]> = [
    ['Accessibility', 'accessibility', 'summary.json'],
    ['Security', 'security', 'summary.json'],
    ['SEO', 'seo', 'summary.json'],
    ['Content', 'content', 'summary.json'],
    ['Responsive', 'responsive', 'summary.json'],
  ];
  return modules.map(([area, key, file]) => ({
    area,
    findings: readModuleJson<{ findings?: ArtifactFinding[] }>(ctx, key, file)?.findings ?? [],
  }));
}

function collectLimitations(ctx: ArtifactCtx, coverage: CoverageReport | CoverageSummary | null): string[] {
  const lines: string[] = [];
  const modules = ['accessibility', 'security', 'seo', 'content'] as const;
  for (const key of modules) {
    const summary = readModuleJson<{ limitations?: string[]; disclaimer?: string; testingMode?: string }>(
      ctx,
      key,
      'summary.json'
    );
    if (summary?.disclaimer) lines.push(summary.disclaimer);
    if (summary?.testingMode) lines.push(summary.testingMode);
    for (const line of summary?.limitations ?? []) lines.push(line);
  }
  if (coverage && 'notes' in coverage) {
    for (const note of coverage.notes ?? []) lines.push(note);
  }
  const visual = readModuleJson<{ note?: string }>(ctx, 'visual', 'summary.json');
  if (visual?.note) lines.push(visual.note);
  const responsive = readModuleJson<{ note?: string; testingMode?: string; realDeviceTesting?: boolean }>(
    ctx,
    'responsive',
    'summary.json'
  );
  if (responsive?.note) lines.push(responsive.note);
  if (responsive && responsive.realDeviceTesting === false) {
    lines.push('Responsive checks used emulated viewports. Real-device testing was not recorded as true.');
  }
  const jmeter = readModuleJson<{ profile?: string; heavy?: boolean; authorized?: boolean }>(ctx, 'jmeter', 'summary.json');
  if (jmeter?.profile) {
    lines.push(
      `JMeter profile recorded as ${jmeter.profile}. Heavy=${asText(jmeter.heavy)} authorized=${asText(jmeter.authorized)}.`
    );
  }
  return [...new Set(lines.filter((line) => line.trim()))];
}

function reportTemplateVersion(): string {
  try {
    const version = loadConfig().report?.revisionHistory?.[0]?.version;
    return asText(version);
  } catch {
    return NOT_AVAILABLE;
  }
}

function coverageFormulaOf(coverage: CoverageReport | CoverageSummary | null): string {
  if (!coverage) return NOT_AVAILABLE;
  if ('formula' in coverage && typeof coverage.formula === 'string') return coverage.formula;
  if ('formula' in coverage && coverage.formula && typeof coverage.formula === 'object' && 'coverageDefinition' in coverage.formula) {
    return asText(coverage.formula.coverageDefinition);
  }
  return 'Coverage = items with status TESTED or FAILED ÷ testable items. Pass rate is not coverage.';
}

function resolveIdentity(input: BuildMasterReportInput, folderPath: string): {
  identity: ExecutionIdentity | null;
  metadata: ExecutionMetadata | null;
} {
  const metadata =
    input.metadata ??
    readJsonIfExists<ExecutionMetadata>(path.join(folderPath, 'execution-metadata.json'));
  const identity =
    input.identity ??
    readJsonIfExists<ExecutionIdentity>(path.join(folderPath, 'execution-identity.json')) ??
    loadExecutionIdentity();
  return { identity, metadata };
}

export function buildMasterReportModel(input: BuildMasterReportInput = {}): MasterReportModel {
  const reportsRoot = input.reportsRoot ?? PATHS.reports.root;
  const identityHint = input.identity ?? loadExecutionIdentity();
  const folderPath = input.folderPath ?? identityHint?.folderPath ?? '';
  const { identity, metadata } = resolveIdentity(input, folderPath);
  const ctx: ArtifactCtx = {
    reportsRoot,
    folderPath,
    identity,
    metadata,
    preferHistoryModules: input.preferHistoryModules === true,
  };

  const projectName = asText(identity?.projectName ?? metadata?.projectName);
  const projectNameSource = (identity?.projectNameSource ?? metadata?.projectNameSource ?? NOT_AVAILABLE) as
    | ProjectNameSource
    | typeof NOT_AVAILABLE;
  const websiteName = asText(identity?.websiteName ?? metadata?.websiteName);
  const websiteNameSource = (identity?.websiteNameSource ?? metadata?.websiteNameSource ?? NOT_AVAILABLE) as
    | ProjectNameSource
    | typeof NOT_AVAILABLE;
  const hostnameFallback = Boolean(identity?.hostnameFallback ?? metadata?.hostnameFallback);
  const baseUrl = asText(identity?.baseUrl ?? metadata?.baseUrl);
  const executionId = asText(identity?.executionId ?? metadata?.executionId);
  const overallStatus = asText(metadata?.overallStatus);
  const stages = stageMap(ctx);
  const coverage = loadCoverage(ctx);
  const qualityGate = loadQualityGate(ctx);
  const failures = loadFailures(ctx);
  const retest = loadRetest(ctx);
  const summary = buildMasterNormalizedSummary({
    coverage,
    qualityGate,
    stages: [...stages.values()],
    failures,
    retest,
    moduleFindings: collectModuleFindings(ctx),
    projectName,
    baseUrl,
    executionId,
    startTime: asText(identity?.startTime ?? metadata?.startTime),
    endTime: asText(metadata?.endTime),
    environment: asText(metadata?.environment),
    frameworkVersion: asText(metadata?.frameworkVersion),
    reportVersion: reportTemplateVersion(),
    browsers: metadata?.browsers ?? [],
    testSuite: asText(identity?.testSuite ?? metadata?.testSuite),
    overallStatus: asText(qualityGate?.status ?? overallStatus),
    limitations: collectLimitations(ctx, coverage),
    coverageFormula: coverageFormulaOf(coverage),
  });
  const shared = {
    projectName,
    projectNameSource,
    websiteName,
    websiteNameSource,
    hostnameFallback,
    baseUrl,
    executionId,
    overallStatus,
    stages,
    coverage,
    qualityGate,
    identity,
    metadata,
    summary,
    failures,
    retest,
  };
  const numbered = MASTER_SECTION_DEFS.filter((def) => def.kind !== 'appendix');
  const appendices = MASTER_SECTION_DEFS.filter((def) => def.kind === 'appendix');
  const sections = [
    ...numbered.map((def, index) => buildSection(def, index + 1, ctx, shared)),
    ...appendices.map((def) => buildSection(def, def.letter, ctx, shared)),
  ];
  summary.domainMatrix = buildDomainMatrix(
    sections.map((row) => ({ id: row.id, status: row.status, displayStatus: row.displayStatus })),
    coverage
  );
  const matrix = sections.find((row) => row.id === 'final-coverage-matrix');
  if (matrix) {
    matrix.tables = [coverageMatrixTable(summary), ...matrix.tables.filter((table) => table.caption !== coverageMatrixTable(summary).caption)];
  }

  const allureIndex = [
    path.join(folderPath, 'allure', 'report', 'index.html'),
    path.join(reportsRoot, 'allure', 'report', 'index.html'),
  ].find((candidate) => fs.existsSync(candidate));
  const allureAvailable = Boolean(allureIndex);
  const allureHref = allureAvailable
    ? path.relative(folderPath || reportsRoot, allureIndex as string).replace(/\\/g, '/')
    : NOT_AVAILABLE;

  return {
    generatedAt: identity?.startTime ?? metadata?.startTime ?? NOT_AVAILABLE,
    timezone: PKT_TIMEZONE,
    timezoneOffset: PKT_OFFSET,
    projectName,
    projectNameSource,
    websiteName,
    websiteNameSource,
    hostnameFallback,
    baseUrl,
    executionId,
    folderPath,
    overallStatus: asText(qualityGate?.status ?? overallStatus),
    qualityGateStatus: asText(qualityGate?.status),
    summary,
    sections,
    allure: {
      available: allureAvailable,
      href: allureHref,
      note: allureAvailable
        ? 'Allure HTML for this execution only — see allure/report/index.html. Module findings are embedded in this master report; Allure is a supporting viewer.'
        : 'Allure report/index.html was not present for this execution. Status NOT_EXECUTED — results were not invented.',
    },
  };
}

function coverageMatrixTable(summary: MasterNormalizedSummary): MasterTable {
  return {
    caption: 'Final coverage matrix (same source of truth as Executive Summary)',
    headers: ['QA Area', 'Tested', 'Passed', 'Failed', 'Blocked', 'Not Tested', 'Coverage'],
    rows: summary.domainMatrix.map((row) => [
      row.area,
      row.tested,
      row.passed,
      row.failed,
      row.blocked,
      row.notTested,
      row.coverage,
    ]),
    emptyReason: 'Domain matrix rows were not available.',
  };
}

function buildSection(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  shared: {
    projectName: string;
    projectNameSource: ProjectNameSource | typeof NOT_AVAILABLE;
    websiteName: string;
    websiteNameSource: ProjectNameSource | typeof NOT_AVAILABLE;
    hostnameFallback: boolean;
    baseUrl: string;
    executionId: string;
    overallStatus: string;
    stages: Map<string, StageLike>;
    coverage: CoverageReport | CoverageSummary | null;
    qualityGate: QualityGateResult | null;
    identity: ExecutionIdentity | null;
    metadata: ExecutionMetadata | null;
    summary: MasterNormalizedSummary;
    failures: FailuresSummaryLike | null;
    retest: RetestSummaryLike | null;
  }
): MasterReportSection {
  switch (def.id) {
    case 'executive-summary':
      return buildExecutiveSummary(def, number, shared);
    case 'key-findings':
      return buildKeyFindingsSection(def, number, shared.summary);
    case 'qa-execution-information':
      return buildExecutionInfo(def, number, ctx, shared);
    case 'test-scope-environment':
      return buildTestScope(def, number, ctx, shared);
    case 'application-discovery':
      return buildDiscovery(def, number, ctx, shared.stages);
    case 'coverage':
      return buildCoverage(def, number, shared.coverage, shared.summary);
    case 'functional-ui-e2e':
      return buildFunctionalUi(def, number, ctx, shared.stages);
    case 'responsive-testing':
      return buildResponsive(def, number, ctx, shared.stages);
    case 'cross-browser-testing':
      return buildCrossBrowser(def, number, ctx, shared.stages);
    case 'visual-testing':
      return buildVisual(def, number, ctx, shared.stages);
    case 'accessibility-testing':
      return buildAccessibility(def, number, ctx, shared.stages);
    case 'api-testing':
      return buildApi(def, number, ctx, shared.stages);
    case 'ui-api-correlation':
      return buildCorrelation(def, number, ctx, shared.stages);
    case 'performance-testing':
      return buildPerformance(def, number, ctx, shared.stages);
    case 'security-qa':
      return buildSecurity(def, number, ctx, shared.stages);
    case 'seo-qa':
      return buildSeo(def, number, ctx, shared.stages);
    case 'content-qa':
      return buildContent(def, number, ctx, shared.stages);
    case 'workflow-testing':
      return buildWorkflows(def, number, ctx, shared.stages);
    case 'defect-risk-summary':
      return buildDefects(def, number, shared.summary);
    case 'failure-analysis':
      return buildFailures(def, number, ctx, shared.stages, shared.summary, shared.failures);
    case 'retest-results':
      return buildRetest(def, number, ctx, shared.stages, shared.summary);
    case 'recommended-actions':
      return buildRecommendedActionsSection(def, number, shared.summary);
    case 'final-coverage-matrix':
      return buildMatrix(def, number, shared.coverage, shared.summary);
    case 'release-quality-assessment':
      return buildAssessment(def, number, ctx, shared);
    case 'appendix-a-test-case-details':
      return buildAppendixA(def, number, shared.coverage);
    case 'appendix-b-failure-evidence':
      return buildAppendixB(def, number, ctx, shared.failures);
    case 'appendix-c-screenshots':
      return buildAppendixC(def, number, ctx, shared.failures);
    case 'appendix-d-api-evidence':
      return buildAppendixD(def, number, ctx, shared.stages);
    case 'appendix-e-browser-viewport':
      return buildAppendixE(def, number, ctx, shared.stages);
    case 'appendix-f-configuration':
      return buildAppendixF(def, number, shared.summary);
    default:
      return notExecuted(def, number, 'Unknown section — not fabricated.');
  }
}

function buildExecutionInfo(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  shared: {
    projectName: string;
    projectNameSource: ProjectNameSource | typeof NOT_AVAILABLE;
    websiteName: string;
    websiteNameSource: ProjectNameSource | typeof NOT_AVAILABLE;
    hostnameFallback: boolean;
    baseUrl: string;
    executionId: string;
    identity: ExecutionIdentity | null;
    metadata: ExecutionMetadata | null;
    summary: MasterNormalizedSummary;
  }
): MasterReportSection {
  const browsers = shared.metadata?.browsers ?? [];
  const start = asText(shared.identity?.startTime ?? shared.metadata?.startTime);
  const end = asText(shared.metadata?.endTime);
  const viewport = readModuleJson<{ viewports?: Array<{ name?: string; width?: number; height?: number }> }>(
    ctx,
    'responsive',
    'summary.json'
  )?.viewports?.[0];
  const fields = [
    { label: 'Project name', value: shared.projectName },
    { label: 'Project name source', value: asText(shared.projectNameSource) },
    { label: 'Execution date/time', value: start },
    { label: 'Application URL', value: shared.baseUrl },
    { label: 'Environment', value: asText(shared.metadata?.environment) },
    { label: 'Test framework', value: asText(shared.identity?.testSuite ?? shared.metadata?.testSuite) },
    { label: 'Browser', value: browsers.length ? browsers.join(', ') : NOT_AVAILABLE },
    {
      label: 'Viewport',
      value: viewport
        ? `${asText(viewport.name)} ${asCount(viewport.width)}×${asCount(viewport.height)}`
        : NOT_AVAILABLE,
    },
    { label: 'QA run ID', value: shared.executionId },
    { label: 'Duration', value: formatDurationBetween(start, end) },
    { label: 'Framework version', value: asText(shared.metadata?.frameworkVersion) },
    { label: 'End date/time', value: end },
    { label: 'Git branch', value: asText(shared.metadata?.gitBranch) },
    { label: 'Git commit', value: asText(shared.metadata?.gitCommit) },
  ].filter((row) => row.value !== NOT_AVAILABLE);
  return section(def, number, {
    status: shared.executionId === NOT_AVAILABLE ? 'NOT_AVAILABLE' : 'RECORDED',
    dataAvailable: shared.executionId !== NOT_AVAILABLE,
    unavailableReason:
      shared.executionId === NOT_AVAILABLE
        ? 'execution-metadata.json / execution-identity.json was not present.'
        : '',
    summaryText: 'Execution identity recorded from this run’s metadata. Cover values are not repeated here unless they add detail.',
    paragraphs: [],
    fields,
    tables: [],
    lists: [],
    evidence: [],
  });
}

function buildExecutiveSummary(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  shared: {
    overallStatus: string;
    coverage: CoverageReport | CoverageSummary | null;
    qualityGate: QualityGateResult | null;
    summary: MasterNormalizedSummary;
  }
): MasterReportSection {
  const kpis = shared.summary.kpis;
  if (!shared.coverage && !shared.qualityGate) {
    return notExecuted(def, number, 'Coverage and quality-gate artifacts were not present. Counts were not invented.');
  }

  return section(def, number, {
    status: asText(shared.qualityGate?.status ?? shared.overallStatus),
    dataAvailable: true,
    unavailableReason: '',
    summaryText: shared.summary.release.headline,
    paragraphs: [],
    fields: [
      { label: 'Total Tests', value: asCount(kpis.totalTests) },
      { label: 'Executed', value: asCount(kpis.executed) },
      { label: 'Passed', value: asCount(kpis.passed) },
      { label: 'Failed', value: asCount(kpis.failed) },
      { label: 'Blocked', value: asCount(kpis.blocked) },
      { label: 'Not Tested', value: asCount(kpis.notTested) },
      { label: 'Coverage %', value: kpis.coveragePercent == null ? NOT_AVAILABLE : `${kpis.coveragePercent}%` },
      { label: 'Pass Rate %', value: kpis.passRatePercent == null ? NOT_AVAILABLE : `${kpis.passRatePercent}%` },
    ],
    tables: [
      {
        caption: 'Release blockers',
        headers: ['Area', 'Code', 'Detail'],
        rows: shared.summary.release.blockers.map((row) => [row.area, row.code, row.detail]),
        emptyReason: shared.summary.release.passed
          ? 'No release-blocking issues detected.'
          : 'Quality gate recorded no structured blocker rows.',
      },
    ],
    lists: shared.summary.release.blockers.map((row) => `${row.area}: ${row.detail}`),
    evidence: [],
  });
}

function buildDiscovery(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const discovery = readModuleJson<DiscoveryResult>(ctx, 'discovery', 'discovery.json');
  const inventory = readModuleJson<InventoryResult>(ctx, 'discovery', 'inventory.json');
  const stage = stageStatus(stages, 'discovery');
  if (!discovery && !inventory) {
    return notExecuted(
      def,
      number,
      stage?.reason
        ? `Discovery artifacts were not present (${stage.status ?? 'NOT_EXECUTED'}: ${stage.reason}).`
        : 'reports/discovery/discovery.json was not present. Pages and elements were not invented.',
      stage
    );
  }

  const elements = inventory?.elements ?? [];
  const byType = countBy(
    elements.map((el) => ({ rule: el.type })),
    (row) => asText(row.rule)
  );
  const pages = discovery?.pages ?? [];
  const forms = pages.reduce((sum, page) => sum + (page.formCount ?? 0), 0);
  const links = pages.reduce((sum, page) => sum + (page.linkCount ?? 0), 0);

  return section(def, number, {
    status: asText(stage?.status, discovery ? 'RECORDED' : 'NOT_EXECUTED'),
    dataAvailable: true,
    unavailableReason: '',
    summaryText: `${asCount(discovery?.pagesDiscoveredUnique ?? pages.length)} page(s), ${asCount(elements.length)} inventory element(s), ${asCount(forms)} form(s), ${asCount(links)} link(s).`,
    paragraphs: [],
    fields: [
      { label: 'Pages discovered (unique)', value: asCount(discovery?.pagesDiscoveredUnique ?? pages.length) },
      { label: 'Pages discovered (raw)', value: asCount(discovery?.pagesDiscoveredRaw) },
      { label: 'Seed URL', value: asText(discovery?.seedUrl) },
      { label: 'Scope host', value: asText(discovery?.scopeHost) },
      { label: 'Forms (page.formCount sum)', value: asCount(forms) },
      { label: 'Links (page.linkCount sum)', value: asCount(links) },
      { label: 'Inventory elements', value: asCount(elements.length) },
      { label: 'Buttons (inventory type=button)', value: asCount(byType.button ?? 0) },
      { label: 'Inputs (inventory *-input + textarea)', value: asCount(countInputs(byType)) },
      { label: 'Selects', value: asCount(byType.select ?? 0) },
      { label: 'Checkboxes', value: asCount(byType.checkbox ?? 0) },
      { label: 'Radio buttons', value: asCount(byType.radio ?? 0) },
      { label: 'Toggles', value: asCount(byType.toggle ?? 0) },
      { label: 'Tables', value: asCount(byType.table ?? 0) },
      { label: 'Modals / tabs / accordions', value: 'NOT_AVAILABLE — not a first-class inventory type in this run' },
    ],
    tables: [
      {
        caption: 'Discovered pages / routes / URLs',
        headers: ['URL', 'Final URL', 'Title', 'HTTP', 'Forms', 'Links', 'OK'],
        rows: pages.map((page) => [
          asText(page.url),
          asText(page.finalUrl),
          asText(page.title, '(empty title in discovery artifact)'),
          asCount(page.status),
          asCount(page.formCount),
          asCount(page.linkCount),
          page.ok ? 'true' : 'false',
        ]),
        emptyReason: 'Discovery recorded no pages.',
      },
      {
        caption: 'Inventory elements by type',
        headers: ['Type', 'Count'],
        rows: Object.entries(byType).map(([type, count]) => [type, String(count)]),
        emptyReason: 'inventory.json recorded 0 elements. Interactive types were not invented.',
      },
    ],
    lists: [],
    evidence: [],
  });
}

function countInputs(byType: Record<string, number>): number {
  return Object.entries(byType)
    .filter(([type]) => type.endsWith('-input') || type === 'textarea')
    .reduce((sum, [, count]) => sum + count, 0);
}

function buildCoverage(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  coverage: CoverageReport | CoverageSummary | null,
  normalized?: MasterNormalizedSummary
): MasterReportSection {
  if (!coverage) {
    return notExecuted(def, number, 'reports/coverage/coverage.json and summary.json were not present. Coverage % was not invented.');
  }
  const totals = 'totals' in coverage ? coverage.totals : null;
  const dimensions = coverage.dimensions ?? [];
  const wanted = [
    'page',
    'route',
    'ui',
    'field',
    'button',
    'link',
    'form',
    'workflow',
    'api',
    'browser',
    'responsive',
    'accessibility',
    'visual',
  ];
  return section(def, number, {
    status: coverage && (totals?.complete === false || ('complete' in coverage && coverage.complete === false))
      ? 'RECORDED'
      : 'RECORDED',
    dataAvailable: true,
    unavailableReason: '',
    paragraphs: [
      asText(
        'formula' in coverage && typeof coverage.formula === 'string'
          ? coverage.formula
          : totals
            ? 'Coverage = items with status TESTED or FAILED ÷ testable items. Pass rate is not coverage.'
            : NOT_AVAILABLE
      ),
    ],
    fields: [
      { label: 'Total discovered areas', value: asCount(totals?.discoveredItems ?? dimensions.length) },
      { label: 'TESTED', value: asCount(normalized?.kpis.passed ?? totals?.testedCount) },
      { label: 'NOT TESTED', value: asCount(normalized?.kpis.notTested ?? totals?.uncoveredItems ?? (coverage as CoverageSummary).uncoveredCount) },
      { label: 'BLOCKED', value: asCount(normalized?.kpis.blocked ?? totals?.blockedCount ?? (coverage as CoverageSummary).blockedCount) },
      { label: 'Coverage %', value: asCount(normalized?.kpis.coveragePercent ?? totals?.itemCoveragePercent ?? (coverage as CoverageSummary).itemCoveragePercent) },
      { label: 'Item coverage %', value: asCount(totals?.itemCoveragePercent ?? (coverage as CoverageSummary).itemCoveragePercent) },
      { label: 'Scope coverage %', value: asCount(totals?.scopeCoveragePercent ?? (coverage as CoverageSummary).scopeCoveragePercent) },
      { label: 'Testable items', value: asCount(totals?.testableItems ?? (coverage as CoverageSummary).testableItems) },
      { label: 'Covered (TESTED + FAILED)', value: asCount(totals?.testedItems ?? (coverage as CoverageSummary).coveredItems) },
      { label: 'Complete (100% claim)', value: String(totals?.complete ?? (coverage as CoverageSummary).complete ?? false) },
    ],
    tables: [
      {
        caption: 'Required coverage dimensions',
        headers: ['Dimension', 'Discovered', 'Testable', 'Covered', 'Uncovered', 'Coverage %', 'TESTED', 'FAILED', 'BLOCKED', 'N/A', 'UNTESTABLE', 'UNCOVERED'],
        rows: wanted.map((id) => {
          const row = dimensions.find((dim) => dim.id === id);
          if (!row) {
            return [id, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE];
          }
          return [
            row.label,
            String(row.discovered),
            String(row.testable),
            String(row.covered),
            String(row.uncovered),
            String(row.coveragePercent),
            String(row.byStatus?.TESTED ?? NOT_AVAILABLE),
            String(row.byStatus?.FAILED ?? NOT_AVAILABLE),
            String(row.byStatus?.BLOCKED ?? NOT_AVAILABLE),
            String(row.byStatus?.['NOT APPLICABLE'] ?? NOT_AVAILABLE),
            String(row.byStatus?.UNTESTABLE ?? NOT_AVAILABLE),
            String(row.byStatus?.UNCOVERED ?? NOT_AVAILABLE),
          ];
        }),
        emptyReason: 'Coverage dimensions were not present.',
      },
    ],
    lists: 'notes' in coverage ? coverage.notes ?? [] : [],
    evidence: [],
  });
}

function readPlaywrightSuite(ctx: ArtifactCtx, suite: PlaywrightSuiteName): {
  passed?: boolean;
  executed?: boolean;
  skipReason?: string;
  browsers?: Array<{
    browser: string;
    status: string;
    reason?: string;
    total?: number | string;
    passed?: number | string;
    failed?: number | string;
    skipped?: number | string;
  }>;
  failureDetails?: { executions?: Array<Record<string, unknown>> };
} | null {
  return readJsonIfExists(path.join(moduleDir(ctx, 'playwright'), suite, 'summary.json'));
}

function buildFunctionalUi(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const e2e = readPlaywrightSuite(ctx, 'e2e');
  const generated = readPlaywrightSuite(ctx, 'generated-check');
  const stage = stageStatus(stages, 'e2e');
  if (!e2e && !generated && !fileExistsInModule(ctx, 'playwright', path.join('e2e', 'results.json'))) {
    return notExecuted(
      def,
      number,
      stage?.status === 'NOT_EXECUTED'
        ? `Playwright UI/E2E was NOT_EXECUTED (${stage.reason ?? 'no reason recorded'}).`
        : 'Playwright e2e / generated-check summaries were not present. Scenarios were not invented.',
      stage
    );
  }

  const executions = [
    ...((e2e?.failureDetails?.executions ?? []) as Array<Record<string, unknown>>),
    ...((generated?.failureDetails?.executions ?? []) as Array<Record<string, unknown>>),
  ];
  const browsers = [...(e2e?.browsers ?? []), ...(generated?.browsers ?? [])];

  return section(def, number, {
    status: asText(stage?.status, suiteStatusFromSummary(e2e, 'RECORDED')),
    dataAvailable: true,
    unavailableReason: '',
    summaryText: `E2E executed=${asText(e2e ? String(e2e.executed) : undefined)} passed=${asText(e2e ? String(e2e.passed) : undefined)}.`,
    paragraphs: [],
    fields: [
      { label: 'E2E suite passed', value: e2e ? String(e2e.passed) : NOT_AVAILABLE },
      { label: 'E2E executed', value: e2e ? String(e2e.executed) : NOT_AVAILABLE },
      { label: 'Generated-check passed', value: generated ? String(generated.passed) : NOT_AVAILABLE },
      { label: 'Generated-check skip reason', value: asText(generated?.skipReason) },
      { label: 'Orchestrator stage', value: asText(stage?.status) },
    ],
    tables: [
      {
        caption: 'Browser summary (e2e + generated-check)',
        headers: ['Browser', 'Status', 'Reason', 'Total', 'Passed', 'Failed', 'Skipped'],
        rows: browsers.map((row) => [
          asText(row.browser),
          asText(row.status),
          asText(row.reason),
          asCount(row.total),
          asCount(row.passed),
          asCount(row.failed),
          asCount(row.skipped),
        ]),
        emptyReason: 'No browser rows were present in Playwright suite summaries.',
      },
      {
        caption: 'Failed UI executions (actual results)',
        headers: ['Scenario', 'Spec', 'Browser', 'Expected', 'Actual', 'Error'],
        rows: executions.map((row) => {
          const assertion = (row.assertion ?? {}) as { expected?: string; actual?: string };
          return [
            asText(row.title),
            asText(row.specFile),
            asText(row.projectName),
            asText(assertion.expected),
            asText(assertion.actual),
            asText(row.errorMessage).slice(0, 400),
          ];
        }),
        emptyReason: 'No failed UI executions were recorded in suite summaries (passing titles are in the Playwright JSON, not duplicated here as invented scenarios).',
      },
    ],
    lists: [],
    evidence: executions.flatMap((row) => {
      const refs: MasterEvidenceRef[] = [];
      if (row.screenshotPath) refs.push(evidenceRef(ctx.folderPath, 'screenshot', String(row.screenshotPath), asText(row.title)));
      if (row.tracePath) refs.push(evidenceRef(ctx.folderPath, 'trace', String(row.tracePath), asText(row.title)));
      if (row.videoPath) refs.push(evidenceRef(ctx.folderPath, 'video', String(row.videoPath), asText(row.title)));
      return refs;
    }),
  });
}

function buildResponsive(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const summary = readModuleJson<{
    passed?: boolean;
    status?: string;
    note?: string;
    testingMode?: string;
    realDeviceTesting?: boolean;
    failureCount?: number;
    notApplicableCount?: number;
    viewports?: Array<{ name?: string; width?: number; height?: number; realDevice?: boolean; emulationNote?: string }>;
    findings?: FindingLike[];
  }>(ctx, 'responsive', 'summary.json');
  const stage = stageStatus(stages, 'responsive');
  if (!summary) {
    return notExecuted(def, number, 'reports/responsive/summary.json was not present.');
  }
  return section(def, number, {
    status: asText(stage?.status, suiteStatusFromSummary(summary, 'RECORDED')),
    dataAvailable: true,
    unavailableReason: '',
    paragraphs: [asText(summary.note), asText(summary.testingMode)],
    fields: [
      { label: 'Real device testing', value: summary.realDeviceTesting ? 'true' : 'false' },
      { label: 'Failure count', value: asCount(summary.failureCount) },
      { label: 'Not applicable count', value: asCount(summary.notApplicableCount) },
    ],
    tables: [
      {
        caption: 'Viewports (Desktop / Laptop / Tablet / Mobile)',
        headers: ['Name', 'Width', 'Height', 'Real device', 'Note'],
        rows: (summary.viewports ?? []).map((row) => [
          asText(row.name),
          asCount(row.width),
          asCount(row.height),
          row.realDevice ? 'true' : 'false',
          asText(row.emulationNote),
        ]),
        emptyReason: 'No viewport rows were present.',
      },
      findingsTable(summary.findings ?? [], 'No responsive findings rows were present.'),
    ],
    lists: [],
    evidence: [],
  });
}

function buildCrossBrowser(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const summary = readModuleJson<{
    passed?: boolean;
    browsers?: string[];
    executedBrowsers?: string[];
    skippedBrowsers?: string[];
    engineTotals?: Record<string, { total?: number; passed?: number; failed?: number; skipped?: number; notExecuted?: number }>;
    versions?: Array<{ engine?: string; version?: string }>;
    failures?: FindingLike[];
  }>(ctx, 'cross-browser', 'summary.json');
  const stage = stageStatus(stages, 'cross-browser');
  if (!summary) {
    return notExecuted(def, number, 'reports/cross-browser/summary.json was not present.');
  }
  const engines = ['chromium', 'firefox', 'webkit'];
  return section(def, number, {
    status: asText(stage?.status, suiteStatusFromSummary(summary, 'RECORDED')),
    dataAvailable: true,
    unavailableReason: '',
    paragraphs: ['WebKit is not iOS Safari. Chromium is not Android Chrome. Engine caveats are recorded, not hidden.'],
    fields: [
      { label: 'Executed browsers', value: (summary.executedBrowsers ?? []).join(', ') || NOT_AVAILABLE },
      { label: 'Skipped browsers', value: (summary.skippedBrowsers ?? []).join(', ') || 'none' },
    ],
    tables: [
      {
        caption: 'Engine totals',
        headers: ['Engine', 'Version', 'Total', 'Passed', 'Failed', 'Skipped', 'Not executed'],
        rows: engines.map((engine) => {
          const totals = summary.engineTotals?.[engine];
          const version = summary.versions?.find((row) => row.engine === engine)?.version;
          return [
            engine,
            asText(version),
            asCount(totals?.total),
            asCount(totals?.passed),
            asCount(totals?.failed),
            asCount(totals?.skipped),
            asCount(totals?.notExecuted),
          ];
        }),
        emptyReason: 'No engine totals were present.',
      },
    ],
    lists: [],
    evidence: [],
  });
}

function buildVisual(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const summary = readModuleJson<{
    passed?: boolean;
    note?: string;
    applicability?: Array<{ id?: string; name?: string; status?: string; reason?: string }>;
    diffs?: Array<{ page?: string; diffPercent?: string; threshold?: string; baselinePath?: string; actualPath?: string; diffPath?: string }>;
    evidenceFiles?: string[];
  }>(ctx, 'visual', 'summary.json');
  const stage = stageStatus(stages, 'visual');
  if (!summary) {
    return notExecuted(def, number, 'reports/visual/summary.json was not present.');
  }
  return section(def, number, {
    status: asText(stage?.status, suiteStatusFromSummary(summary, 'RECORDED')),
    dataAvailable: true,
    unavailableReason: '',
    paragraphs: [asText(summary.note, 'Visual comparison against committed baselines. Missing diffs are not invented.')],
    fields: [{ label: 'Passed', value: String(summary.passed) }],
    tables: [
      {
        caption: 'Applicability',
        headers: ['ID', 'Name', 'Status', 'Reason'],
        rows: (summary.applicability ?? []).map((row) => [
          asText(row.id),
          asText(row.name),
          asText(row.status),
          asText(row.reason),
        ]),
        emptyReason: 'No visual applicability rows were present.',
      },
      {
        caption: 'Visual differences',
        headers: ['Page', 'Diff %', 'Threshold', 'Baseline', 'Actual', 'Diff'],
        rows: (summary.diffs ?? []).map((row) => [
          asText(row.page),
          asText(row.diffPercent),
          asText(row.threshold),
          asText(row.baselinePath),
          asText(row.actualPath),
          asText(row.diffPath),
        ]),
        emptyReason: 'No per-page visual diffs were present in the artifact.',
      },
    ],
    lists: [],
    evidence: (summary.evidenceFiles ?? []).map((file) => evidenceRef(ctx.folderPath, 'screenshot', file, file)),
  });
}

function buildAccessibility(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const summary = readModuleJson<{
    passed?: boolean;
    pagesAnalyzed?: number;
    violationCount?: number;
    incompleteCount?: number;
    byImpact?: Record<string, number>;
    findings?: FindingLike[];
    disclaimer?: string;
    limitations?: string[];
    testingMode?: string;
  }>(ctx, 'accessibility', 'summary.json');
  const stage = stageStatus(stages, 'accessibility');
  if (!summary) {
    return notExecuted(def, number, 'reports/accessibility/summary.json was not present.', stage);
  }
  return section(def, number, {
    status: asText(stage?.status, suiteStatusFromSummary(summary, 'RECORDED')),
    dataAvailable: true,
    unavailableReason: '',
    summaryText: `${asCount(summary.pagesAnalyzed)} page(s) analyzed, ${asCount(summary.violationCount)} violation(s).`,
    paragraphs: [],
    fields: [
      { label: 'Pages analyzed', value: asCount(summary.pagesAnalyzed) },
      { label: 'Violations', value: asCount(summary.violationCount) },
      { label: 'Incomplete', value: asCount(summary.incompleteCount) },
      { label: 'Critical (axe impact)', value: asCount(summary.byImpact?.critical) },
      { label: 'Serious', value: asCount(summary.byImpact?.serious) },
      { label: 'Moderate', value: asCount(summary.byImpact?.moderate) },
      { label: 'Minor', value: asCount(summary.byImpact?.minor) },
    ],
    tables: [findingsTable(summary.findings ?? [], 'No accessibility findings were present.')],
    lists: [],
    limitations: [asText(summary.disclaimer), asText(summary.testingMode), ...(summary.limitations ?? [])].filter(
      (line) => line && line !== NOT_AVAILABLE
    ),
    evidence: [],
  });
}

function buildApi(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const report = readModuleJson<{
    run?: {
      summary?: {
        iterations?: { executed?: number; errors?: number };
        executedRequests?: { executed?: number; errors?: number };
        tests?: { executed?: number; failed?: number; passed?: number; skipped?: number };
        timeStats?: { responseAverage?: number; responseMin?: number; responseMax?: number };
      };
      executions?: Array<{
        item?: { name?: string };
        requestExecuted?: { name?: string; method?: string; url?: { path?: string[]; host?: string[] } };
        response?: { code?: number; responseTime?: number };
        tests?: Array<{ name?: string; status?: string }>;
      }>;
    };
  }>(ctx, 'postman', 'report.json');
  const stage = stageStatus(stages, 'api');
  if (!report?.run?.summary) {
    return notExecuted(def, number, 'reports/postman/report.json was not present. Endpoints were not invented.');
  }
  const summary = report.run.summary;
  const executions = report.run.executions ?? [];
  return section(def, number, {
    status: asText(stage?.status, summary.tests?.failed ? 'FAIL' : 'PASS'),
    dataAvailable: true,
    unavailableReason: '',
    paragraphs: [
      'Executed requests are from the Postman CLI report for configured qa.config.json postman.requests. Product XHR paths were not invented.',
      'Authentication/authorization stay NOT_EXECUTED when postman.auth.type is none or credentials are absent.',
    ],
    fields: [
      { label: 'Requests executed', value: asCount(summary.executedRequests?.executed) },
      { label: 'Request errors', value: asCount(summary.executedRequests?.errors) },
      { label: 'Assertions executed', value: asCount(summary.tests?.executed) },
      { label: 'Assertions passed', value: asCount(summary.tests?.passed) },
      { label: 'Assertions failed', value: asCount(summary.tests?.failed) },
      { label: 'Avg response time (ms)', value: asCount(summary.timeStats?.responseAverage) },
      { label: 'Min / max (ms)', value: `${asCount(summary.timeStats?.responseMin)} / ${asCount(summary.timeStats?.responseMax)}` },
    ],
    tables: [
      {
        caption: 'Request-level results',
        headers: ['Name', 'Method', 'Path', 'Status', 'Time (ms)', 'Assertion result'],
        rows: executions.map((exec) => {
          const pathParts = exec.requestExecuted?.url?.path ?? [];
          const tests = exec.tests ?? [];
          const failed = tests.some((test) => String(test.status).toUpperCase() === 'FAILED' || String(test.status).toUpperCase() === 'FAIL');
          return [
            asText(exec.requestExecuted?.name ?? exec.item?.name),
            asText(exec.requestExecuted?.method),
            pathParts.length ? `/${pathParts.filter(Boolean).join('/')}` : '/',
            asCount(exec.response?.code),
            asCount(exec.response?.responseTime),
            tests.length === 0 ? NOT_AVAILABLE : failed ? 'FAIL' : 'PASS',
          ];
        }),
        emptyReason: 'Postman report contained no executions.',
      },
    ],
    lists: [],
    evidence: [],
  });
}

function buildCorrelation(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const summary = readModuleJson<{
    passed?: boolean;
    correlationUsed?: boolean;
    correlatedExecuted?: number;
    discoveredXhrCount?: number;
    documentedPairCount?: number;
    workflows?: Array<{ id?: string; name?: string; kind?: string; status?: string; reason?: string }>;
  }>(ctx, 'workflows', 'summary.json');
  const stage = stageStatus(stages, 'workflows');
  if (!summary) {
    return notExecuted(def, number, 'reports/workflows/summary.json was not present. UI↔API pairs were not invented.');
  }
  const correlated = (summary.workflows ?? []).filter(
    (row) => row.id === 'WF-CORRELATED' || row.kind === 'inferred-gated' || /correlat/i.test(asText(row.name))
  );
  return section(def, number, {
    status: asText(
      correlated[0]?.status ?? stage?.status,
      summary.correlationUsed ? suiteStatusFromSummary(summary, 'RECORDED') : 'NOT_APPLICABLE'
    ),
    dataAvailable: true,
    unavailableReason: '',
    paragraphs: [
      'UI/API correlation uses only discovered XHR or documented workflows.correlated pairs. JSONPlaceholder is not forced into the UI.',
    ],
    fields: [
      { label: 'Correlation used', value: String(Boolean(summary.correlationUsed)) },
      { label: 'Correlated executed', value: asCount(summary.correlatedExecuted) },
      { label: 'Discovered XHR count', value: asCount(summary.discoveredXhrCount) },
      { label: 'Documented pair count', value: asCount(summary.documentedPairCount) },
    ],
    tables: [
      {
        caption: 'Applicable combined workflows',
        headers: ['ID', 'Name', 'Kind', 'Status', 'Reason'],
        rows: (summary.workflows ?? []).map((row) => [
          asText(row.id),
          asText(row.name),
          asText(row.kind),
          asText(row.status),
          asText(row.reason),
        ]),
        emptyReason: 'No workflow rows were present.',
      },
    ],
    lists: [],
    evidence: [],
  });
}

function buildPerformance(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const ui = readModuleJson<{
    status?: string;
    skipReason?: string;
    label?: string;
    measurement?: Record<string, unknown> | null;
    applicability?: Array<{ id?: string; name?: string; status?: string; reason?: string }>;
  }>(ctx, 'performance', 'summary.json');
  const jmeter = readModuleJson<{
    status?: string;
    profile?: string;
    heavy?: boolean;
    authorized?: boolean;
    skipped?: boolean;
    skipReason?: string | null;
    target?: string;
    threads?: number;
    metrics?: Record<string, number>;
    samples?: Array<{ label?: string; success?: boolean; elapsed?: number; statusCode?: number }>;
  }>(ctx, 'jmeter', 'summary.json');
  const lighthouse = readModuleJson<{
    status?: string;
    skipReason?: string;
    pages?: Array<{ url?: string; status?: string; lcpMs?: number; cls?: number; inpMs?: number }>;
  }>(ctx, 'lighthouse', 'summary.json');
  const stage = stageStatus(stages, 'performance');
  if (!ui && !jmeter && !lighthouse) {
    return notExecuted(def, number, 'Performance / JMeter / Lighthouse summaries were not present. SLAs were not invented.');
  }
  return section(def, number, {
    status: asText(stage?.status, asText(jmeter?.status, asText(ui?.status))),
    dataAvailable: true,
    unavailableReason: '',
    paragraphs: [
      'UI timing, JMeter, and Lighthouse are separate surfaces. Heavy JMeter profiles require authorization and are not implied by liveness/smoke.',
    ],
    fields: [
      { label: 'UI performance status', value: asText(ui?.status) },
      { label: 'UI skip reason', value: asText(ui?.skipReason) },
      { label: 'JMeter profile actually executed', value: asText(jmeter?.profile) },
      { label: 'JMeter status', value: asText(jmeter?.status) },
      { label: 'JMeter heavy / authorized', value: `${asText(jmeter?.heavy)} / ${asText(jmeter?.authorized)}` },
      { label: 'JMeter target', value: asText(jmeter?.target) },
      { label: 'JMeter threads', value: asCount(jmeter?.threads) },
      { label: 'Lighthouse status', value: asText(lighthouse?.status) },
      { label: 'Lighthouse skip reason', value: asText(lighthouse?.skipReason) },
      { label: 'Load / stress / spike / soak', value: 'NOT_EXECUTED — not in this liveness/smoke run; not invented as PASS' },
    ],
    tables: [
      {
        caption: 'UI timing applicability',
        headers: ['ID', 'Name', 'Status', 'Reason'],
        rows: (ui?.applicability ?? []).map((row) => [
          asText(row.id),
          asText(row.name),
          asText(row.status),
          asText(row.reason),
        ]),
        emptyReason: 'No UI performance applicability rows were present.',
      },
      {
        caption: 'JMeter samples (executed profile only)',
        headers: ['Label', 'Success', 'Elapsed (ms)', 'Status'],
        rows: (jmeter?.samples ?? []).map((row) => [
          asText(row.label),
          row.success == null ? NOT_AVAILABLE : String(row.success),
          asCount(row.elapsed),
          asCount(row.statusCode),
        ]),
        emptyReason: jmeter ? 'JMeter summary had no samples.' : 'JMeter was not executed.',
      },
      {
        caption: 'Lighthouse / Web Vitals pages',
        headers: ['URL', 'Status', 'LCP ms', 'CLS', 'INP ms'],
        rows: (lighthouse?.pages ?? []).map((row) => [
          asText(row.url),
          asText(row.status),
          asCount(row.lcpMs),
          asCount(row.cls),
          asCount(row.inpMs),
        ]),
        emptyReason: lighthouse
          ? 'Lighthouse artifact had no page rows.'
          : 'Lighthouse was NOT_EXECUTED — scores were not invented.',
      },
    ],
    lists: [],
    evidence: [],
  });
}

function buildSecurity(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const summary = readModuleJson<{
    passed?: boolean;
    failCount?: number;
    passCount?: number;
    warningCount?: number;
    noteCount?: number;
    notTestedCount?: number;
    findings?: FindingLike[];
    disclaimer?: string;
    limitations?: string[];
    bySeverity?: Record<string, number>;
  }>(ctx, 'security', 'summary.json');
  const stage = stageStatus(stages, 'security');
  if (!summary) {
    return notExecuted(def, number, 'reports/security/summary.json was not present.');
  }
  return section(def, number, {
    status: asText(stage?.status, suiteStatusFromSummary(summary, 'RECORDED')),
    dataAvailable: true,
    unavailableReason: '',
    summaryText: `FAIL ${asCount(summary.failCount)}, PASS ${asCount(summary.passCount)}, NOT_TESTED ${asCount(summary.notTestedCount)}.`,
    paragraphs: [],
    limitations: [asText(summary.disclaimer), ...(summary.limitations ?? [])].filter((line) => line && line !== NOT_AVAILABLE),
    fields: [
      { label: 'FAIL count', value: asCount(summary.failCount) },
      { label: 'PASS count', value: asCount(summary.passCount) },
      { label: 'WARNING count', value: asCount(summary.warningCount) },
      { label: 'NOTE count', value: asCount(summary.noteCount) },
      { label: 'NOT_TESTED count', value: asCount(summary.notTestedCount) },
      { label: 'High / medium / low / info (documented)', value: `${asCount(summary.bySeverity?.high)} / ${asCount(summary.bySeverity?.medium)} / ${asCount(summary.bySeverity?.low)} / ${asCount(summary.bySeverity?.info)}` },
    ],
    tables: [findingsTable(summary.findings ?? [], 'No security findings were present.')],
    lists: [],
    evidence: [],
  });
}

function buildSeo(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const summary = readModuleJson<{
    passed?: boolean;
    failCount?: number;
    findings?: FindingLike[];
    disclaimer?: string;
    limitations?: string[];
    bySeverity?: Record<string, number>;
  }>(ctx, 'seo', 'summary.json');
  const stage = stageStatus(stages, 'seo');
  if (!summary) {
    return notExecuted(def, number, 'reports/seo/summary.json was not present.');
  }
  return section(def, number, {
    status: asText(stage?.status, suiteStatusFromSummary(summary, 'RECORDED')),
    dataAvailable: true,
    unavailableReason: '',
    paragraphs: [asText(summary.disclaimer)],
    fields: [
      { label: 'FAIL count', value: asCount(summary.failCount) },
      { label: 'High / medium / low / info', value: `${asCount(summary.bySeverity?.high)} / ${asCount(summary.bySeverity?.medium)} / ${asCount(summary.bySeverity?.low)} / ${asCount(summary.bySeverity?.info)}` },
    ],
    tables: [findingsTable(summary.findings ?? [], 'No SEO findings were present.')],
    lists: summary.limitations ?? [],
    evidence: [],
  });
}

function buildContent(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const summary = readModuleJson<{
    passed?: boolean;
    pagesAnalyzed?: number;
    failCount?: number;
    passCount?: number;
    findings?: FindingLike[];
    disclaimer?: string;
    limitations?: string[];
  }>(ctx, 'content', 'summary.json');
  const stage = stageStatus(stages, 'content');
  if (!summary && !stage) {
    return notExecuted(def, number, 'reports/content/summary.json was not present.');
  }
  const zeroExec = (summary?.pagesAnalyzed ?? 0) === 0 && (summary?.passCount ?? 0) === 0 && (summary?.failCount ?? 0) === 0;
  const status = stage?.status === 'NOT_EXECUTED' || zeroExec
    ? 'NOT_EXECUTED'
    : asText(stage?.status, suiteStatusFromSummary(summary ?? null, 'RECORDED'));
  return section(def, number, {
    status,
    dataAvailable: Boolean(summary),
    unavailableReason: zeroExec
      ? 'Content QA recorded zero pages analyzed and zero executed pass/fail checks. This is not a product PASS.'
      : '',
    paragraphs: [
      asText(summary?.disclaimer),
      zeroExec
        ? 'pagesAnalyzed is 0 — missing/empty/placeholder content was not judged. A PASS with zero executed items is not treated as defect-free.'
        : '',
    ].filter(Boolean),
    fields: [
      { label: 'Pages analyzed', value: asCount(summary?.pagesAnalyzed) },
      { label: 'Artifact passed flag', value: summary ? String(summary.passed) : NOT_AVAILABLE },
      { label: 'FAIL count', value: asCount(summary?.failCount) },
      { label: 'PASS count', value: asCount(summary?.passCount) },
      { label: 'Orchestrator stage', value: asText(stage?.status) },
    ],
    tables: [findingsTable(summary?.findings ?? [], 'No content findings were present.')],
    lists: summary?.limitations ?? [],
    evidence: [],
  });
}

function buildWorkflows(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const summary = readModuleJson<{
    passed?: boolean;
    workflows?: Array<{ id?: string; name?: string; status?: string; reason?: string; kind?: string }>;
  }>(ctx, 'workflows', 'summary.json');
  const stage = stageStatus(stages, 'workflows');
  if (!summary) {
    return notExecuted(def, number, 'reports/workflows/summary.json was not present.');
  }
  return section(def, number, {
    status: asText(stage?.status, suiteStatusFromSummary(summary, 'RECORDED')),
    dataAvailable: true,
    unavailableReason: '',
    paragraphs: ['Discovered and documented workflows only. Blocked / N/A / uncovered stay visible.'],
    fields: [{ label: 'Workflow count', value: asCount(summary.workflows?.length) }],
    tables: [
      {
        caption: 'Workflows',
        headers: ['ID', 'Name', 'Kind', 'Status', 'Reason'],
        rows: (summary.workflows ?? []).map((row) => [
          asText(row.id),
          asText(row.name),
          asText(row.kind),
          asText(row.status),
          asText(row.reason),
        ]),
        emptyReason: 'No workflows were recorded.',
      },
    ],
    lists: [],
    evidence: [],
  });
}

function buildFailures(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>,
  normalized: MasterNormalizedSummary,
  failures: FailuresSummaryLike | null
): MasterReportSection {
  const stage = stageStatus(stages, 'analyze');
  if (!failures) {
    return notExecuted(def, number, 'reports/failures/summary.json was not present.', stage);
  }
  return section(def, number, {
    status: asText(failures.outcome, asText(stage?.status, 'RECORDED')),
    dataAvailable: true,
    unavailableReason: '',
    summaryText: `Analyzed ${asCount(failures.analyzed)} of ${asCount(failures.totalFailures)} recorded failures.`,
    paragraphs: [],
    fields: Object.entries(failures.byOwnerClass ?? {}).map(([label, value]) => ({
      label: `Owner class ${label}`,
      value: String(value),
    })),
    tables: [
      {
        caption: 'Failure distribution',
        headers: ['Category', 'Count'],
        rows: normalized.failureDistribution.map((row) => [row.category, String(row.count)]),
        emptyReason: 'Failure analysis recorded no non-zero classification buckets.',
      },
      {
        caption: 'Failure records',
        headers: [
          'Failure ID',
          'Test',
          'Category',
          'Error',
          'URL',
          'Step',
          'Expected',
          'Actual',
          'Screenshot',
          'Trace / log',
          'Timestamp',
        ],
        rows: (failures.failures ?? []).map((row) => {
          const shot = evidenceRef(ctx.folderPath, 'screenshot', row.evidence?.screenshotPath, row.id ?? 'screenshot');
          const trace = evidenceRef(ctx.folderPath, 'trace', row.evidence?.tracePath, row.id ?? 'trace');
          const log = evidenceRef(ctx.folderPath, 'log', row.evidence?.logPath, row.id ?? 'log');
          return [
            asText(row.id ?? row.testId),
            asText(row.title ?? row.testId),
            asText(row.classification ?? row.ownerClassification),
            asText(row.evidence?.errorMessage ?? row.evidenceExcerpt).slice(0, 240),
            NOT_AVAILABLE,
            asText(row.evidence?.specFile ?? row.source),
            NOT_AVAILABLE,
            asText(row.evidence?.errorMessage ?? row.evidenceExcerpt).slice(0, 160),
            shot.available ? shot.path : `UNAVAILABLE (${shot.path})`,
            trace.available ? trace.path : log.available ? log.path : `UNAVAILABLE (${trace.path})`,
            NOT_AVAILABLE,
          ];
        }),
        emptyReason: 'Failure analysis recorded no failure rows.',
      },
    ],
    lists: normalized.failureDistribution.map((row) => `${row.category}: ${row.count}`),
    evidence: (failures.failures ?? []).flatMap((row) => [
      evidenceRef(ctx.folderPath, 'screenshot', row.evidence?.screenshotPath, asText(row.id)),
      evidenceRef(ctx.folderPath, 'video', row.evidence?.videoPath, asText(row.id)),
      evidenceRef(ctx.folderPath, 'trace', row.evidence?.tracePath, asText(row.id)),
    ]),
  });
}

function buildRetest(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>,
  normalized: MasterNormalizedSummary
): MasterReportSection {
  const artifact = loadRetest(ctx);
  const stage = stageStatus(stages, 'retest');
  if (!artifact) {
    return notExecuted(def, number, 'reports/retest/summary.json was not present.', stage);
  }
  return section(def, number, {
    status: asText(artifact.status, asText(stage?.status)),
    dataAvailable: true,
    unavailableReason: '',
    summaryText: asText(artifact.reason),
    paragraphs: [],
    fields: [
      { label: 'Outcome', value: asText(artifact.outcome) },
      { label: 'Selected', value: asCount(artifact.selected) },
      { label: 'Not selected', value: asCount(artifact.notSelected) },
      { label: 'Executed', value: asCount(artifact.executed) },
    ],
    tables: [
      {
        caption: 'Original run vs retest',
        headers: ['Test', 'Original', 'Retest', 'Current Status'],
        rows: normalized.retestRows.map((row) => [row.test, row.original, row.retest, row.currentStatus]),
        emptyReason: 'No retest items were present.',
      },
    ],
    lists: [],
    evidence: [],
  });
}

function buildDefects(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  normalized: MasterNormalizedSummary
): MasterReportSection {
  const groups: Array<MasterNormalizedSummary['defects'][number]['group']> = [
    'Critical / Release Blocking',
    'High',
    'Medium',
    'Low',
    'Unclassified',
  ];
  return section(def, number, {
    status: 'RECORDED',
    dataAvailable: true,
    unavailableReason: '',
    summaryText:
      'Defects are taken from the quality gate, recorded failures, module FAIL/BLOCKED findings, and coverage risk areas. Severity is documented or Unclassified.',
    paragraphs: [],
    fields: groups.map((group) => ({ label: group, value: String(normalized.defectsByGroup[group].length) })),
    tables: groups.map((group) => ({
      caption: group,
      headers: ['ID', 'Area', 'Description', 'Severity', 'Status', 'Evidence'],
      rows: normalized.defectsByGroup[group].map((row) => [
        row.id,
        row.area,
        row.description,
        row.severity,
        row.status,
        row.evidence,
      ]),
      emptyReason: `No ${group.toLowerCase()} defects were recorded.`,
    })),
    lists: [],
    evidence: [],
  });
}

function buildMatrix(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  coverage: CoverageReport | CoverageSummary | null,
  normalized: MasterNormalizedSummary
): MasterReportSection {
  if (!coverage) {
    return notExecuted(def, number, 'Coverage matrix source (coverage.json) was not present.');
  }
  const kpis = normalized.kpis;
  return section(def, number, {
    status: 'RECORDED',
    dataAvailable: true,
    unavailableReason: '',
    summaryText:
      'Area rows use official coverage dimensions when a 1:1 mapping exists. Overall KPI cards and this matrix share the same normalized summary.',
    paragraphs: [],
    fields: [
      { label: 'Total Tests', value: asCount(kpis.totalTests) },
      { label: 'Executed', value: asCount(kpis.executed) },
      { label: 'Passed', value: asCount(kpis.passed) },
      { label: 'Failed', value: asCount(kpis.failed) },
      { label: 'Blocked', value: asCount(kpis.blocked) },
      { label: 'Not Tested', value: asCount(kpis.notTested) },
      { label: 'Coverage %', value: kpis.coveragePercent == null ? NOT_AVAILABLE : `${kpis.coveragePercent}%` },
    ],
    tables: [coverageMatrixTable(normalized)],
    lists: [],
    evidence: [],
  });
}

function buildAssessment(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  shared: {
    overallStatus: string;
    qualityGate: QualityGateResult | null;
    coverage: CoverageReport | CoverageSummary | null;
    stages: Map<string, StageLike>;
    summary: MasterNormalizedSummary;
  }
): MasterReportSection {
  void ctx;
  const kpis = shared.summary.kpis;
  const gate = asText(shared.summary.release.gate ?? shared.qualityGate?.status ?? shared.overallStatus);
  const reasons = shared.summary.release.blockers.map((row) => row.detail);
  const summaryText = reasons.length
    ? `The QA execution resulted in a ${gate} release gate because ${reasons.join('; ')}.`
    : shared.summary.release.passed
      ? 'The QA execution resulted in a passed release gate. No release-blocking issues were recorded.'
      : `The QA execution resulted in a ${gate} release gate.`;
  return section(def, number, {
    status: gate,
    dataAvailable: Boolean(shared.qualityGate || shared.coverage),
    unavailableReason: '',
    summaryText,
    paragraphs: [summaryText],
    fields: [
      { label: 'Release Gate', value: gate },
      { label: 'Coverage', value: kpis.coveragePercent == null ? NOT_AVAILABLE : `${kpis.coveragePercent}%` },
      { label: 'Executed', value: asCount(kpis.executed) },
      { label: 'Passed', value: asCount(kpis.passed) },
      { label: 'Failed', value: asCount(kpis.failed) },
      { label: 'Blocked', value: asCount(kpis.blocked) },
      { label: 'Not Tested', value: asCount(kpis.notTested) },
    ],
    tables: [
      {
        caption: 'Required suites (quality gate)',
        headers: ['Suite', 'Status', 'Detail'],
        rows: (shared.qualityGate?.requiredSuites ?? []).map((row) => [
          asText(row.label),
          asText(row.status),
          asText(row.detail),
        ]),
        emptyReason: 'Quality gate artifact was not present.',
      },
    ],
    lists: shared.summary.limitations,
    limitations: shared.summary.limitations,
    evidence: [],
  });
}

function buildKeyFindingsSection(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  summary: MasterNormalizedSummary
): MasterReportSection {
  return section(def, number, {
    status: summary.keyFindings.length ? 'RECORDED' : 'RECORDED',
    dataAvailable: true,
    unavailableReason: '',
    summaryText: 'Management-level findings taken from the quality gate, required suites, coverage risk areas, and documented high/critical module findings.',
    paragraphs: [],
    fields: [],
    tables: [
      {
        caption: 'Key findings',
        headers: ['#', 'Area', 'Finding', 'Severity', 'Status'],
        rows: summary.keyFindings.map((row) => [
          String(row.index),
          row.area,
          row.finding,
          row.severity,
          row.status,
        ]),
        emptyReason: 'No key findings were present in the recorded artifacts.',
      },
    ],
    lists: [],
    evidence: [],
  });
}

function buildTestScope(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  shared: {
    baseUrl: string;
    metadata: ExecutionMetadata | null;
    summary: MasterNormalizedSummary;
    stages: Map<string, StageLike>;
  }
): MasterReportSection {
  const browsers = shared.metadata?.browsers ?? [];
  const responsive = readModuleJson<{
    viewports?: Array<{ name?: string; width?: number; height?: number; realDevice?: boolean; emulationNote?: string }>;
    realDeviceTesting?: boolean;
  }>(ctx, 'responsive', 'summary.json');
  const cross = readModuleJson<{
    versions?: Array<{ engine?: string; version?: string }>;
    executedBrowsers?: string[];
  }>(ctx, 'cross-browser', 'summary.json');
  const fields = [
    { label: 'OS', value: NOT_AVAILABLE },
    { label: 'Browser', value: browsers.length ? browsers.join(', ') : NOT_AVAILABLE },
    {
      label: 'Browser version',
      value: (cross?.versions ?? [])
        .filter((row) => row.engine && row.version)
        .map((row) => `${row.engine} ${row.version}`)
        .join(', ') || NOT_AVAILABLE,
    },
    {
      label: 'Viewport',
      value: (responsive?.viewports ?? [])
        .map((row) => `${asText(row.name)} ${asCount(row.width)}×${asCount(row.height)}`)
        .join('; ') || NOT_AVAILABLE,
    },
    {
      label: 'Device emulation',
      value:
        responsive?.realDeviceTesting === false
          ? 'Emulated viewports — real device testing was not recorded as true'
          : asText(responsive?.realDeviceTesting),
    },
    { label: 'API environment', value: asText(shared.baseUrl) },
    { label: 'Base URL', value: shared.baseUrl },
    { label: 'Framework version', value: asText(shared.metadata?.frameworkVersion) },
  ].filter((row) => row.value !== NOT_AVAILABLE);

  return section(def, number, {
    status: 'RECORDED',
    dataAvailable: true,
    unavailableReason: '',
    summaryText: 'Scope is taken from orchestrator stage statuses. Environment values are shown only when present in artifacts.',
    paragraphs: [],
    fields,
    tables: [
      {
        caption: 'Included',
        headers: ['Executed QA domain'],
        rows: shared.summary.scope.included.map((row) => [row]),
        emptyReason: 'No executed QA domains were recorded.',
      },
      {
        caption: 'Not Executed',
        headers: ['Domain'],
        rows: shared.summary.scope.notExecuted.map((row) => [row]),
        emptyReason: 'No NOT_EXECUTED domains were recorded.',
      },
      {
        caption: 'Blocked',
        headers: ['Domain'],
        rows: shared.summary.scope.blocked.map((row) => [row]),
        emptyReason: 'No BLOCKED domains were recorded.',
      },
    ],
    lists: [],
    evidence: [],
  });
}

function buildRecommendedActionsSection(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  summary: MasterNormalizedSummary
): MasterReportSection {
  const groups: Array<MasterNormalizedSummary['recommendedActions'][number]['priority']> = [
    'RELEASE BLOCKING',
    'HIGH PRIORITY',
    'FOLLOW-UP',
  ];
  return section(def, number, {
    status: summary.recommendedActions.length ? 'RECORDED' : 'RECORDED',
    dataAvailable: true,
    unavailableReason: '',
    summaryText: 'Actions are generated only from recorded defects and quality-gate reasons.',
    paragraphs: [],
    fields: [],
    tables: groups.map((priority) => ({
      caption: priority,
      headers: ['#', 'ID', 'Area', 'Problem', 'Suggested action'],
      rows: summary.recommendedActions
        .filter((row) => row.priority === priority)
        .map((row) => [String(row.index), row.defectOrTestId, row.area, row.problem, row.suggestedAction]),
      emptyReason: `No ${priority.toLowerCase()} recommendations were generated from recorded defects.`,
    })),
    lists: [],
    evidence: [],
  });
}

function buildAppendixA(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  coverage: CoverageReport | CoverageSummary | null
): MasterReportSection {
  const records: CoverageRecord[] = coverage && 'records' in coverage ? coverage.records ?? [] : [];
  if (!coverage) {
    return notExecuted(def, number, 'Coverage records were not present. Test-case details were not invented.');
  }
  return section(def, number, {
    status: 'RECORDED',
    dataAvailable: true,
    unavailableReason: '',
    summaryText: 'Inventory coverage records from coverage.json.',
    paragraphs: [],
    fields: [{ label: 'Record count', value: asCount(records.length) }],
    tables: [
      {
        caption: 'Test case / inventory records',
        headers: ['ID', 'Page', 'Element', 'Type', 'Status', 'Reason', 'Recommended test'],
        rows: records.map((row) => [
          row.id,
          row.page,
          row.element,
          row.type,
          row.status,
          row.reason,
          row.recommendedTest,
        ]),
        emptyReason: 'coverage.json had no records array (summary-only artifact).',
      },
    ],
    lists: [],
    evidence: [],
  });
}

function buildAppendixB(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  failures: FailuresSummaryLike | null
): MasterReportSection {
  if (!failures) {
    return notExecuted(def, number, 'Failure evidence artifact was not present.');
  }
  return section(def, number, {
    status: 'RECORDED',
    dataAvailable: true,
    unavailableReason: '',
    summaryText: 'Detailed errors, stack traces, and log references for recorded failures.',
    paragraphs: [],
    fields: [{ label: 'Failure rows', value: asCount(failures.failures?.length ?? failures.totalFailures) }],
    tables: [
      {
        caption: 'Failure evidence',
        headers: ['Failure ID', 'Error', 'Stack / excerpt', 'Screenshot', 'Trace', 'Log'],
        rows: (failures.failures ?? []).map((row) => {
          const shot = evidenceRef(ctx.folderPath, 'screenshot', row.evidence?.screenshotPath, row.id ?? 'screenshot');
          const trace = evidenceRef(ctx.folderPath, 'trace', row.evidence?.tracePath, row.id ?? 'trace');
          const log = evidenceRef(ctx.folderPath, 'log', row.evidence?.logPath, row.id ?? 'log');
          return [
            asText(row.id ?? row.testId),
            asText(row.evidence?.errorMessage ?? row.evidenceExcerpt).slice(0, 400),
            asText(row.evidence?.stackTrace ?? row.evidenceExcerpt).slice(0, 400),
            shot.available ? shot.path : `UNAVAILABLE (${shot.path})`,
            trace.available ? trace.path : `UNAVAILABLE (${trace.path})`,
            log.available ? log.path : `UNAVAILABLE (${log.path})`,
          ];
        }),
        emptyReason: 'No failure evidence rows were recorded.',
      },
    ],
    lists: [],
    evidence: (failures.failures ?? []).flatMap((row) => [
      evidenceRef(ctx.folderPath, 'screenshot', row.evidence?.screenshotPath, asText(row.id)),
      evidenceRef(ctx.folderPath, 'trace', row.evidence?.tracePath, asText(row.id)),
      evidenceRef(ctx.folderPath, 'log', row.evidence?.logPath, asText(row.id)),
    ]),
  });
}

function buildAppendixC(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  failures: FailuresSummaryLike | null
): MasterReportSection {
  const visual = readModuleJson<{ evidenceFiles?: string[]; diffs?: Array<{ page?: string; diffPath?: string; actualPath?: string; baselinePath?: string }> }>(
    ctx,
    'visual',
    'summary.json'
  );
  const shots = [
    ...(failures?.failures ?? []).map((row) =>
      evidenceRef(ctx.folderPath, 'screenshot', row.evidence?.screenshotPath, asText(row.id ?? row.title))
    ),
    ...(visual?.evidenceFiles ?? []).map((file) => evidenceRef(ctx.folderPath, 'screenshot', file, file)),
    ...(visual?.diffs ?? []).flatMap((row) => [
      evidenceRef(ctx.folderPath, 'screenshot', row.diffPath, `${asText(row.page)} diff`),
      evidenceRef(ctx.folderPath, 'screenshot', row.actualPath, `${asText(row.page)} actual`),
      evidenceRef(ctx.folderPath, 'screenshot', row.baselinePath, `${asText(row.page)} baseline`),
    ]),
  ].filter((row) => row.path !== NOT_AVAILABLE);
  return section(def, number, {
    status: shots.length ? 'RECORDED' : 'NOT_EXECUTED',
    displayStatus: shots.length ? 'RECORDED' : 'NOT TESTED',
    dataAvailable: shots.length > 0,
    unavailableReason: shots.length ? '' : 'No screenshot or visual evidence files were recorded.',
    summaryText: 'Screenshots and visual-regression files referenced by this execution.',
    paragraphs: shots.length ? [] : ['No screenshot or visual evidence files were recorded.'],
    fields: [{ label: 'Evidence references', value: String(shots.length) }],
    tables: [
      {
        caption: 'Screenshot / visual evidence',
        headers: ['Kind', 'Label', 'Path', 'Available'],
        rows: shots.map((row) => [row.kind, row.label, row.path, row.available ? 'true' : 'false']),
        emptyReason: 'No screenshot or visual evidence files were recorded.',
      },
    ],
    lists: [],
    evidence: shots,
  });
}

function buildAppendixD(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const report = readModuleJson<{
    run?: {
      executions?: Array<{
        item?: { name?: string };
        requestExecuted?: { name?: string; method?: string; url?: { path?: string[]; host?: string[] } };
        response?: { code?: number; responseTime?: number; body?: unknown };
        tests?: Array<{ name?: string; status?: string }>;
      }>;
    };
  }>(ctx, 'postman', 'report.json');
  const stage = stageStatus(stages, 'api');
  if (!report?.run?.executions) {
    return notExecuted(def, number, 'Postman report executions were not present. API evidence was not invented.', stage);
  }
  return section(def, number, {
    status: asText(stage?.status, 'RECORDED'),
    dataAvailable: true,
    unavailableReason: '',
    summaryText: 'Request/response rows from the Postman CLI report.',
    paragraphs: [],
    fields: [{ label: 'Executions', value: asCount(report.run.executions.length) }],
    tables: [
      {
        caption: 'API evidence',
        headers: ['Name', 'Method', 'Path', 'Status', 'Time (ms)', 'Assertion result'],
        rows: report.run.executions.map((exec) => {
          const pathParts = exec.requestExecuted?.url?.path ?? [];
          const tests = exec.tests ?? [];
          const failed = tests.some((test) => {
            const status = String(test.status).toUpperCase();
            return status === 'FAILED' || status === 'FAIL';
          });
          return [
            asText(exec.requestExecuted?.name ?? exec.item?.name),
            asText(exec.requestExecuted?.method),
            pathParts.length ? `/${pathParts.filter(Boolean).join('/')}` : '/',
            asCount(exec.response?.code),
            asCount(exec.response?.responseTime),
            tests.length === 0 ? NOT_AVAILABLE : failed ? 'FAIL' : 'PASS',
          ];
        }),
        emptyReason: 'Postman report contained no executions.',
      },
    ],
    lists: [],
    evidence: [],
  });
}

function buildAppendixE(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  ctx: ArtifactCtx,
  stages: Map<string, StageLike>
): MasterReportSection {
  const cross = readModuleJson<{
    versions?: Array<{ engine?: string; version?: string }>;
    engineTotals?: Record<string, { total?: number; passed?: number; failed?: number; skipped?: number; notExecuted?: number }>;
  }>(ctx, 'cross-browser', 'summary.json');
  const responsive = readModuleJson<{
    viewports?: Array<{ name?: string; width?: number; height?: number; realDevice?: boolean; emulationNote?: string }>;
  }>(ctx, 'responsive', 'summary.json');
  if (!cross && !responsive) {
    return notExecuted(def, number, 'Browser and viewport artifacts were not present.');
  }
  const engines = ['chromium', 'firefox', 'webkit'];
  return section(def, number, {
    status: asText(stageStatus(stages, 'cross-browser')?.status, 'RECORDED'),
    dataAvailable: true,
    unavailableReason: '',
    summaryText: 'Browser engine totals and viewport rows from this execution.',
    paragraphs: [],
    fields: [],
    tables: [
      {
        caption: 'Browser matrix',
        headers: ['Engine', 'Version', 'Total', 'Passed', 'Failed', 'Skipped', 'Not executed'],
        rows: engines.map((engine) => {
          const totals = cross?.engineTotals?.[engine];
          const version = cross?.versions?.find((row) => row.engine === engine)?.version;
          return [
            engine,
            asText(version),
            asCount(totals?.total),
            asCount(totals?.passed),
            asCount(totals?.failed),
            asCount(totals?.skipped),
            asCount(totals?.notExecuted),
          ];
        }),
        emptyReason: 'No engine totals were present.',
      },
      {
        caption: 'Viewport matrix',
        headers: ['Name', 'Width', 'Height', 'Real device', 'Note'],
        rows: (responsive?.viewports ?? []).map((row) => [
          asText(row.name),
          asCount(row.width),
          asCount(row.height),
          row.realDevice ? 'true' : 'false',
          asText(row.emulationNote),
        ]),
        emptyReason: 'No viewport rows were present.',
      },
    ],
    lists: [],
    evidence: [],
  });
}

function buildAppendixF(
  def: (typeof MASTER_SECTION_DEFS)[number],
  number: number | string,
  summary: MasterNormalizedSummary
): MasterReportSection {
  return section(def, number, {
    status: 'RECORDED',
    dataAvailable: true,
    unavailableReason: '',
    summaryText: 'Methodology, official KPI definitions, and interpretation rules for this report.',
    paragraphs: [...summary.methodology.interpretationRules, ...summary.methodology.officialFormulas],
    fields: summary.methodology.configuration,
    tables: [],
    lists: summary.methodology.knownLimitations,
    limitations: summary.methodology.knownLimitations,
    evidence: [],
  });
}

export function masterSectionHeadings(model: MasterReportModel = buildMasterReportModel()): string[] {
  return model.sections.map((row) => row.heading);
}
