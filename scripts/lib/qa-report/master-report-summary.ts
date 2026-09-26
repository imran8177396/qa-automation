import type { CoverageReport, CoverageSummary, CoverageTotals, DimensionCoverage, RiskArea } from '../../coverage/types';
import type { QualityGateResult } from '../../orchestrator/quality-gate';
import { NOT_AVAILABLE } from '../suite-origin';
import { formatDurationBetween, formatPktLongDate, PKT_OFFSET, PKT_TIMEZONE } from './timestamps';

export const UNCLASSIFIED_SEVERITY = 'Unclassified';

export type MasterDisplayStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT TESTED' | 'N/A' | string;

export type MasterSectionKind = 'executive' | 'standard' | 'domain' | 'analysis' | 'appendix';

export type RecommendationPriority = 'RELEASE BLOCKING' | 'HIGH PRIORITY' | 'FOLLOW-UP';

export interface MasterKpiSnapshot {
  totalTests: number | null;
  executed: number | null;
  passed: number | null;
  failed: number | null;
  blocked: number | null;
  notTested: number | null;
  coveragePercent: number | null;
  passRatePercent: number | null;
  skipped: number | null;
  notApplicable: number | null;
  untestable: number | null;
  passedExecutions: number | null;
  failedExecutions: number | null;
  skippedExecutions: number | null;
  scopeItems: number | null;
  scopeCoveragePercent: number | null;
  definitions: {
    totalTests: string;
    executed: string;
    passed: string;
    failed: string;
    blocked: string;
    notTested: string;
    coveragePercent: string;
    passRatePercent: string;
  };
  identity: {
    officialTestableFormula: string;
    officialTestableLeft: number | null;
    officialTestableRight: number | null;
    officialTestableHolds: boolean | null;
    fourWaySum: number | null;
    fourWayEqualsTotalTests: boolean | null;
    fourWayNote: string;
  };
}

export interface MasterCoverMeta {
  title: 'MASTER QA REPORT';
  applicationName: string | null;
  applicationUrl: string | null;
  executionDateTime: string | null;
  executionLongDate: string | null;
  reportVersion: string | null;
  frameworkVersion: string | null;
  testRunId: string | null;
  environment: string | null;
  releaseStatus: string | null;
}

export interface MasterReleaseStatus {
  gate: string | null;
  passed: boolean;
  hasBlockers: boolean;
  headline: string;
  blockers: Array<{ code: string; detail: string; area: string }>;
}

export interface MasterKeyFinding {
  index: number;
  area: string;
  finding: string;
  severity: string;
  status: string;
  sourceId: string;
}

export interface MasterDefect {
  id: string;
  area: string;
  description: string;
  severity: string;
  status: string;
  evidence: string;
  group: 'Critical / Release Blocking' | 'High' | 'Medium' | 'Low' | 'Unclassified';
  fromFailures: boolean;
}

export interface MasterRecommendedAction {
  priority: RecommendationPriority;
  index: number;
  defectOrTestId: string;
  area: string;
  problem: string;
  suggestedAction: string;
}

export interface MasterDomainMatrixRow {
  area: string;
  sectionId: string;
  tested: string;
  passed: string;
  failed: string;
  blocked: string;
  notTested: string;
  coverage: string;
  sectionStatus: string;
}

export interface MasterFailureDistributionRow {
  category: string;
  count: number;
}

export interface MasterScopeBreakdown {
  included: string[];
  notExecuted: string[];
  blocked: string[];
}

export interface MasterRetestRow {
  test: string;
  original: string;
  retest: string;
  currentStatus: string;
}

export interface ArtifactFinding {
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

export interface FailureRecordLike {
  id?: string;
  testId?: string;
  title?: string;
  source?: string;
  classification?: string;
  ownerClassification?: string;
  evidenceExcerpt?: string;
  evidence?: {
    specFile?: string;
    errorMessage?: string;
    screenshotPath?: string;
    videoPath?: string;
    tracePath?: string;
    stackTrace?: string;
    logPath?: string;
    durationMs?: number;
  };
}

export interface FailuresSummaryLike {
  outcome?: string;
  analyzed?: number;
  totalFailures?: number;
  byClass?: Record<string, number>;
  byOwnerClass?: Record<string, number>;
  failures?: FailureRecordLike[];
}

export interface RetestItemLike {
  id?: string;
  originalFailureId?: string;
  title?: string;
  testId?: string;
  originalStatus?: string;
  retestStatus?: string;
  finalStatus?: string;
  ownerClassification?: string;
  stabilityVerdict?: string;
}

export interface RetestSummaryLike {
  status?: string;
  outcome?: string;
  reason?: string;
  selected?: number;
  notSelected?: number;
  executed?: number;
  items?: RetestItemLike[];
}

export interface StageLike {
  key?: string;
  name?: string;
  status?: string;
  reason?: string;
  executedCount?: number;
  exitCode?: number | null;
}

export interface MasterSummarySources {
  coverage: CoverageReport | CoverageSummary | null;
  qualityGate: QualityGateResult | null;
  stages: StageLike[];
  failures: FailuresSummaryLike | null;
  retest: RetestSummaryLike | null;
  moduleFindings: Array<{ area: string; findings: ArtifactFinding[] }>;
  projectName: string;
  baseUrl: string;
  executionId: string;
  startTime: string;
  endTime: string;
  environment: string;
  frameworkVersion: string;
  reportVersion: string;
  browsers: string[];
  testSuite: string;
  overallStatus: string;
  limitations: string[];
  coverageFormula: string;
}

export interface MasterNormalizedSummary {
  kpis: MasterKpiSnapshot;
  cover: MasterCoverMeta;
  release: MasterReleaseStatus;
  keyFindings: MasterKeyFinding[];
  defects: MasterDefect[];
  defectsByGroup: Record<MasterDefect['group'], MasterDefect[]>;
  recommendedActions: MasterRecommendedAction[];
  domainMatrix: MasterDomainMatrixRow[];
  scope: MasterScopeBreakdown;
  failureDistribution: MasterFailureDistributionRow[];
  retestRows: MasterRetestRow[];
  limitations: string[];
  methodology: {
    interpretationRules: string[];
    officialFormulas: string[];
    knownLimitations: string[];
    configuration: Array<{ label: string; value: string }>;
  };
}

export const QA_DOMAIN_AREAS = [
  { area: 'Functional UI / E2E', sectionId: 'functional-ui-e2e', stageKeys: ['e2e'], dimensionIds: ['page'] },
  { area: 'Responsive', sectionId: 'responsive-testing', stageKeys: ['responsive'], dimensionIds: ['responsive'] },
  { area: 'Cross-Browser', sectionId: 'cross-browser-testing', stageKeys: ['cross-browser'], dimensionIds: ['browser'] },
  { area: 'Visual', sectionId: 'visual-testing', stageKeys: ['visual'], dimensionIds: ['visual'] },
  { area: 'Accessibility', sectionId: 'accessibility-testing', stageKeys: ['accessibility'], dimensionIds: ['accessibility'] },
  { area: 'API', sectionId: 'api-testing', stageKeys: ['api'], dimensionIds: ['api'] },
  { area: 'UI/API Correlation', sectionId: 'ui-api-correlation', stageKeys: ['workflows'], dimensionIds: ['workflow'] },
  { area: 'Performance', sectionId: 'performance-testing', stageKeys: ['performance'], dimensionIds: [] as string[] },
  { area: 'Security', sectionId: 'security-qa', stageKeys: ['security'], dimensionIds: [] as string[] },
  { area: 'SEO', sectionId: 'seo-qa', stageKeys: ['seo'], dimensionIds: [] as string[] },
  { area: 'Content', sectionId: 'content-qa', stageKeys: ['content'], dimensionIds: [] as string[] },
  { area: 'Workflow', sectionId: 'workflow-testing', stageKeys: ['workflows'], dimensionIds: ['workflow'] },
] as const;

function present(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text === NOT_AVAILABLE || text === 'NOT_AVAILABLE') return null;
  return text;
}

export function asDisplay(value: unknown): string {
  return present(value) ?? NOT_AVAILABLE;
}

export function documentedSeverityLabel(row: { severity?: string; impact?: string }): string {
  const raw = String(row.severity ?? '').trim().toLowerCase();
  const impact = String(row.impact ?? '').trim().toLowerCase();
  if (raw === 'critical' || impact === 'critical' || raw === 'p0') return 'Critical';
  if (raw === 'high' || raw === 'p1' || impact === 'serious') return 'High';
  if (raw === 'medium' || raw === 'p2' || impact === 'moderate') return 'Medium';
  if (raw === 'low' || raw === 'p3' || impact === 'minor') return 'Low';
  if (raw === 'info' || raw === 'informational' || impact === 'info') return 'Informational';
  if (raw) return String(row.severity).trim();
  if (impact) return String(row.impact).trim();
  return UNCLASSIFIED_SEVERITY;
}

export function displaySectionStatus(status: string | undefined | null): MasterDisplayStatus {
  const upper = String(status ?? '').trim().toUpperCase();
  if (!upper || upper === NOT_AVAILABLE) return 'NOT TESTED';
  if (
    upper === 'NOT_EXECUTED' ||
    upper === 'NOT_TESTED' ||
    upper === 'UNCOVERED' ||
    upper.includes('NOT TESTED') ||
    upper.includes('UNCOVERED')
  ) {
    return 'NOT TESTED';
  }
  if (upper.includes('BLOCKED')) return 'BLOCKED';
  if (upper.includes('NOT_APPLICABLE') || upper === 'N/A' || upper.includes('NOT APPLICABLE')) return 'N/A';
  if (upper === 'PARTIAL' || upper.includes('FAIL') || upper === 'ERROR' || upper === 'INVALID') return 'FAIL';
  if (upper.includes('PASS') && !upper.includes('FAIL')) return 'PASS';
  return String(status).trim();
}

export function statusTone(status: string): 'pass' | 'fail' | 'blocked' | 'not-tested' | 'info' {
  const display = displaySectionStatus(status);
  const upper = display.toUpperCase();
  if (upper === 'PASS') return 'pass';
  if (upper === 'FAIL' || upper === 'PARTIAL') return 'fail';
  if (upper === 'BLOCKED') return 'blocked';
  if (upper === 'NOT TESTED' || upper === 'N/A' || upper === NOT_AVAILABLE) return 'not-tested';
  return 'info';
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coverageTotals(coverage: CoverageReport | CoverageSummary | null): {
  totals: CoverageTotals | null;
  summary: CoverageSummary | null;
} {
  if (!coverage) return { totals: null, summary: null };
  if ('totals' in coverage && coverage.totals) return { totals: coverage.totals, summary: null };
  return { totals: null, summary: coverage as CoverageSummary };
}

export function buildKpiSnapshot(coverage: CoverageReport | CoverageSummary | null): MasterKpiSnapshot {
  const { totals, summary } = coverageTotals(coverage);
  const byStatus = totals?.byStatus;
  const totalTests = finiteNumber(totals?.testableItems ?? summary?.testableItems);
  const passed = finiteNumber(totals?.testedCount ?? summary?.testedCount);
  const failed = finiteNumber(totals?.failedCount ?? summary?.failedCount);
  const blocked = finiteNumber(totals?.blockedCount ?? summary?.blockedCount);
  const notTested = finiteNumber(totals?.uncoveredItems ?? summary?.uncoveredCount);
  const executed = finiteNumber(totals?.testedItems ?? summary?.coveredItems);
  const skipped = finiteNumber(byStatus?.SKIPPED ?? totals?.skippedExecutions);
  const notApplicable = finiteNumber(byStatus?.['NOT APPLICABLE']);
  const untestable = finiteNumber(byStatus?.UNTESTABLE);
  const officialRight =
    passed != null && failed != null && notTested != null ? passed + failed + notTested : null;
  const fourWaySum =
    passed != null && failed != null && blocked != null && notTested != null
      ? passed + failed + blocked + notTested
      : null;

  return {
    totalTests,
    executed,
    passed,
    failed,
    blocked,
    notTested,
    coveragePercent: finiteNumber(totals?.itemCoveragePercent ?? summary?.itemCoveragePercent),
    passRatePercent: finiteNumber(totals?.passRatePercent ?? summary?.passRatePercent),
    skipped,
    notApplicable,
    untestable,
    passedExecutions: finiteNumber(totals?.passedExecutions),
    failedExecutions: finiteNumber(totals?.failedExecutions),
    skippedExecutions: finiteNumber(totals?.skippedExecutions),
    scopeItems: finiteNumber(totals?.scopeItems ?? summary?.scopeItems),
    scopeCoveragePercent: finiteNumber(totals?.scopeCoveragePercent ?? summary?.scopeCoveragePercent),
    definitions: {
      totalTests:
        'Official coverage testableItems — inventory items with at least one executable scenario. Not a pass count.',
      executed:
        'Official testedItems / coveredItems — items with status TESTED or FAILED. Covered is not pass rate.',
      passed: 'Official testedCount — items with status TESTED only. NOT TESTED and BLOCKED are never counted here.',
      failed: 'Official failedCount — items with status FAILED. FAILED remains covered and is never hidden.',
      blocked: 'Official blockedCount — items with status BLOCKED. BLOCKED is never treated as TESTED or PASS.',
      notTested: 'Official uncoveredItems — items with status UNCOVERED. NOT TESTED is never treated as PASS.',
      coveragePercent:
        'Official itemCoveragePercent — (TESTED + FAILED) ÷ testableItems. Coverage is not pass rate.',
      passRatePercent:
        'Official passRatePercent — passed executions ÷ executed executions (skipped excluded). Not coverage.',
    },
    identity: {
      officialTestableFormula: 'testableItems = TESTED + FAILED + UNCOVERED',
      officialTestableLeft: totalTests,
      officialTestableRight: officialRight,
      officialTestableHolds: totalTests != null && officialRight != null ? totalTests === officialRight : null,
      fourWaySum,
      fourWayEqualsTotalTests: totalTests != null && fourWaySum != null ? totalTests === fourWaySum : null,
      fourWayNote:
        'The requested Passed + Failed + Blocked + Not Tested sum is not the official testableItems total. BLOCKED is outside the testable denominator (scopeItems = testableItems + blockedCount). This report keeps the official coverage definitions.',
    },
  };
}

function areaFromText(text: string): string {
  const upper = text.toUpperCase();
  if (upper.includes('ACCESSIBILITY') || upper.includes('A11Y')) return 'Accessibility';
  if (upper.includes('RESPONSIVE') || upper.includes('VIEWPORT')) return 'Responsive';
  if (upper.includes('VISUAL')) return 'Visual';
  if (upper.includes('CROSS-BROWSER') || upper.includes('BROWSER')) return 'Cross-Browser';
  if (upper.includes('POSTMAN') || upper.includes('API')) return 'API';
  if (upper.includes('PERFORMANCE') || upper.includes('JMETER') || upper.includes('LIGHTHOUSE')) return 'Performance';
  if (upper.includes('SECURITY')) return 'Security';
  if (upper.includes('SEO')) return 'SEO';
  if (upper.includes('CONTENT')) return 'Content';
  if (upper.includes('WORKFLOW') || upper.includes('CORRELAT')) return 'Workflow';
  if (upper.includes('PLAYWRIGHT') || upper.includes('E2E') || upper.includes('FUNCTIONAL')) return 'Functional';
  if (upper.includes('COVERAGE')) return 'Coverage';
  return 'Quality gate';
}

function buildRelease(qualityGate: QualityGateResult | null, overallStatus: string): MasterReleaseStatus {
  const gate = present(qualityGate?.status ?? overallStatus);
  const blockers = (qualityGate?.reasons ?? []).map((row) => ({
    code: row.code,
    detail: row.detail,
    area: areaFromText(`${row.code} ${row.detail}`),
  }));
  const passed = gate === 'PASS' && blockers.length === 0;
  return {
    gate,
    passed,
    hasBlockers: blockers.length > 0 || (gate != null && gate !== 'PASS'),
    headline: passed ? 'No release-blocking issues detected.' : 'Release blockers detected.',
    blockers,
  };
}

function buildKeyFindings(input: {
  release: MasterReleaseStatus;
  qualityGate: QualityGateResult | null;
  riskAreas: RiskArea[];
  moduleFindings: Array<{ area: string; findings: ArtifactFinding[] }>;
}): MasterKeyFinding[] {
  const rows: MasterKeyFinding[] = [];
  const seen = new Set<string>();

  const push = (area: string, finding: string, severity: string, status: string, sourceId: string) => {
    const key = `${area}|${finding}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      index: rows.length + 1,
      area,
      finding,
      severity,
      status,
      sourceId,
    });
  };

  for (const blocker of input.release.blockers) {
    push(blocker.area, blocker.detail, UNCLASSIFIED_SEVERITY, input.release.gate ?? 'FAIL', blocker.code);
  }

  for (const suite of input.qualityGate?.requiredSuites ?? []) {
    const display = displaySectionStatus(suite.status);
    if (display === 'FAIL' || display === 'BLOCKED' || display === 'NOT TESTED') {
      push(
        areaFromText(suite.label),
        suite.detail ? `${suite.label} is ${suite.status} (${suite.detail})` : `${suite.label} is ${suite.status}`,
        UNCLASSIFIED_SEVERITY,
        display,
        `suite:${suite.label}`
      );
    }
  }

  for (const risk of input.riskAreas) {
    push(
      areaFromText(`${risk.category} ${risk.title}`),
      `${risk.title} — ${risk.reason}`,
      risk.severity ? documentedSeverityLabel({ severity: risk.severity }) : UNCLASSIFIED_SEVERITY,
      risk.category === 'failed' ? 'FAIL' : risk.category === 'blocked' ? 'BLOCKED' : 'NOT TESTED',
      risk.id
    );
  }

  for (const group of input.moduleFindings) {
    for (const finding of group.findings) {
      const status = String(finding.status ?? '').toUpperCase();
      if (status !== 'FAIL' && status !== 'FAILED' && status !== 'BLOCKED') continue;
      const severity = documentedSeverityLabel(finding);
      if (severity !== 'Critical' && severity !== 'High') continue;
      push(
        group.area,
        present(finding.actual ?? finding.detail ?? finding.title ?? finding.rule ?? finding.id) ?? 'Recorded finding',
        severity,
        displaySectionStatus(finding.status),
        asDisplay(finding.id ?? finding.rule ?? finding.testId)
      );
    }
  }

  return rows;
}

function defectGroup(severity: string, releaseBlocking: boolean): MasterDefect['group'] {
  if (releaseBlocking || severity === 'Critical') return 'Critical / Release Blocking';
  if (severity === 'High') return 'High';
  if (severity === 'Medium') return 'Medium';
  if (severity === 'Low') return 'Low';
  return 'Unclassified';
}

function buildDefects(input: {
  release: MasterReleaseStatus;
  failures: FailuresSummaryLike | null;
  riskAreas: RiskArea[];
  moduleFindings: Array<{ area: string; findings: ArtifactFinding[] }>;
}): MasterDefect[] {
  const defects: MasterDefect[] = [];
  const seen = new Set<string>();

  const push = (row: Omit<MasterDefect, 'group'> & { releaseBlocking?: boolean }) => {
    const key = `${row.id}|${row.area}|${row.description}`;
    if (seen.has(key)) return;
    seen.add(key);
    defects.push({
      id: row.id,
      area: row.area,
      description: row.description,
      severity: row.severity,
      status: row.status,
      evidence: row.evidence,
      fromFailures: row.fromFailures,
      group: defectGroup(row.severity, row.releaseBlocking === true),
    });
  };

  for (const blocker of input.release.blockers) {
    push({
      id: blocker.code,
      area: blocker.area,
      description: blocker.detail,
      severity: UNCLASSIFIED_SEVERITY,
      status: input.release.gate ?? 'FAIL',
      evidence: 'orchestrator/quality-gate.json',
      fromFailures: false,
      releaseBlocking: true,
    });
  }

  for (const failure of input.failures?.failures ?? []) {
    const id = asDisplay(failure.id ?? failure.testId);
    push({
      id,
      area: areaFromText(asDisplay(failure.source ?? failure.evidence?.specFile)),
      description: present(failure.title ?? failure.evidenceExcerpt ?? failure.evidence?.errorMessage) ?? 'Recorded failure',
      severity: UNCLASSIFIED_SEVERITY,
      status: 'FAIL',
      evidence: asDisplay(
        failure.evidence?.screenshotPath ?? failure.evidence?.tracePath ?? failure.evidence?.logPath ?? failure.evidence?.specFile
      ),
      fromFailures: true,
    });
  }

  for (const group of input.moduleFindings) {
    for (const finding of group.findings) {
      const status = displaySectionStatus(finding.status);
      if (status !== 'FAIL' && status !== 'BLOCKED') continue;
      push({
        id: asDisplay(finding.id ?? finding.rule ?? finding.testId),
        area: group.area,
        description:
          present(finding.actual ?? finding.detail ?? finding.title ?? finding.expected ?? finding.rule) ?? 'Recorded finding',
        severity: documentedSeverityLabel(finding),
        status,
        evidence: asDisplay(finding.page ?? finding.pagePath),
        fromFailures: false,
      });
    }
  }

  for (const risk of input.riskAreas) {
    push({
      id: risk.id,
      area: areaFromText(`${risk.category} ${risk.title}`),
      description: `${risk.title} — ${risk.reason}`,
      severity: documentedSeverityLabel({ severity: risk.severity }),
      status: risk.category === 'failed' ? 'FAIL' : risk.category === 'blocked' ? 'BLOCKED' : 'NOT TESTED',
      evidence: risk.itemIds?.length ? risk.itemIds.join(', ') : `coverage risk area (${risk.itemCount} item(s))`,
      fromFailures: false,
    });
  }

  return defects;
}

function suggestedActionFor(defect: MasterDefect): string {
  if (defect.group === 'Critical / Release Blocking') {
    return `Resolve release-blocking ${defect.area} issue ${defect.id}: ${defect.description}`;
  }
  if (defect.status === 'BLOCKED') {
    return `Unblock ${defect.area} item ${defect.id} so it can be executed. Recorded reason: ${defect.description}`;
  }
  if (defect.status === 'NOT TESTED') {
    return `Cover ${defect.area} item ${defect.id}. It remains NOT TESTED: ${defect.description}`;
  }
  return `Investigate ${defect.area} defect ${defect.id}: ${defect.description}`;
}

function buildRecommendedActions(defects: MasterDefect[]): MasterRecommendedAction[] {
  const actions: MasterRecommendedAction[] = [];
  const seen = new Set<string>();
  const order: RecommendationPriority[] = ['RELEASE BLOCKING', 'HIGH PRIORITY', 'FOLLOW-UP'];

  const priorityFor = (defect: MasterDefect): RecommendationPriority => {
    if (defect.group === 'Critical / Release Blocking') return 'RELEASE BLOCKING';
    if (defect.group === 'High') return 'HIGH PRIORITY';
    return 'FOLLOW-UP';
  };

  const ranked = [...defects].sort((a, b) => order.indexOf(priorityFor(a)) - order.indexOf(priorityFor(b)));
  for (const defect of ranked) {
    const key = `${defect.id}|${defect.area}|${defect.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push({
      priority: priorityFor(defect),
      index: actions.length + 1,
      defectOrTestId: defect.id,
      area: defect.area,
      problem: defect.description,
      suggestedAction: suggestedActionFor(defect),
    });
  }
  return actions;
}

export function retestCurrentStatus(original?: string, retest?: string, final?: string): string {
  const orig = String(original ?? '').toUpperCase();
  const ret = String(retest ?? '').toUpperCase();
  if (ret === 'PASS') return 'Fixed';
  if (ret === 'FAIL' && orig === 'FAIL') return 'Still failing';
  if (ret === 'FAIL' && orig !== 'FAIL') return 'Newly failing';
  if (!ret || ret === 'NOT_EXECUTED' || ret === 'SKIPPED' || ret === NOT_AVAILABLE) return 'Not retested';
  return asDisplay(retest ?? final);
}

function buildRetestRows(retest: RetestSummaryLike | null): MasterRetestRow[] {
  return (retest?.items ?? []).map((row) => ({
    test: asDisplay(row.title ?? row.testId ?? row.id ?? row.originalFailureId),
    original: asDisplay(row.originalStatus),
    retest: asDisplay(row.retestStatus),
    currentStatus: retestCurrentStatus(row.originalStatus, row.retestStatus, row.finalStatus),
  }));
}

function buildScope(stages: StageLike[]): MasterScopeBreakdown {
  const included: string[] = [];
  const notExecuted: string[] = [];
  const blocked: string[] = [];
  for (const stage of stages) {
    const label = present(stage.name ?? stage.key);
    if (!label) continue;
    const status = String(stage.status ?? '').toUpperCase();
    if (status === 'BLOCKED') blocked.push(`${label} — ${present(stage.reason) ?? 'BLOCKED'}`);
    else if (status === 'NOT_EXECUTED') notExecuted.push(`${label}${stage.reason ? ` — ${stage.reason}` : ''}`);
    else if (status) included.push(`${label} (${stage.status})`);
  }
  return { included, notExecuted, blocked };
}

function buildFailureDistribution(failures: FailuresSummaryLike | null): MasterFailureDistributionRow[] {
  return Object.entries(failures?.byClass ?? {})
    .map(([category, count]) => ({ category, count: finiteNumber(count) ?? 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
}

function formatCount(value: number | undefined): string {
  return value == null ? NOT_AVAILABLE : String(value);
}

export function buildDomainMatrix(
  sections: Array<{ id: string; status: string; displayStatus?: string }>,
  coverage: CoverageReport | CoverageSummary | null
): MasterDomainMatrixRow[] {
  const dimensions: DimensionCoverage[] = coverage?.dimensions ?? [];
  return QA_DOMAIN_AREAS.map((area) => {
    const section = sections.find((row) => row.id === area.sectionId);
    const sectionStatus = displaySectionStatus(section?.displayStatus ?? section?.status);
    const dimensionId = area.dimensionIds.length === 1 ? area.dimensionIds[0] : undefined;
    const dimension = dimensionId ? dimensions.find((row) => row.id === dimensionId) : undefined;
    if (!dimension) {
      return {
        area: area.area,
        sectionId: area.sectionId,
        tested: NOT_AVAILABLE,
        passed: NOT_AVAILABLE,
        failed: NOT_AVAILABLE,
        blocked: NOT_AVAILABLE,
        notTested: sectionStatus === 'NOT TESTED' ? 'NOT TESTED' : NOT_AVAILABLE,
        coverage: NOT_AVAILABLE,
        sectionStatus,
      };
    }
    return {
      area: area.area,
      sectionId: area.sectionId,
      tested: formatCount(dimension.covered),
      passed: formatCount(dimension.byStatus?.TESTED),
      failed: formatCount(dimension.byStatus?.FAILED),
      blocked: formatCount(dimension.byStatus?.BLOCKED),
      notTested: formatCount(dimension.byStatus?.UNCOVERED),
      coverage: `${dimension.coveragePercent}%`,
      sectionStatus,
    };
  });
}

function buildCover(input: MasterSummarySources, release: MasterReleaseStatus): MasterCoverMeta {
  return {
    title: 'MASTER QA REPORT',
    applicationName: present(input.projectName),
    applicationUrl: present(input.baseUrl),
    executionDateTime: present(input.startTime),
    executionLongDate: present(input.startTime) ? formatPktLongDate(input.startTime) : null,
    reportVersion: present(input.reportVersion),
    frameworkVersion: present(input.frameworkVersion),
    testRunId: present(input.executionId),
    environment: present(input.environment),
    releaseStatus: release.gate,
  };
}

function buildMethodology(input: MasterSummarySources, kpis: MasterKpiSnapshot): MasterNormalizedSummary['methodology'] {
  return {
    interpretationRules: [
      'PASS is recorded only when an executed check passed. NOT TESTED and BLOCKED are never rendered as PASS.',
      'FAIL is recorded when an executed check failed or a required suite is PARTIAL/FAIL. Failures are not omitted.',
      'BLOCKED means execution could not proceed because of environment, safety, or dependency constraints.',
      'NOT TESTED / NOT_EXECUTED means no test execution was performed for that item or domain.',
      'N/A / NOT APPLICABLE means the check does not apply to the discovered target.',
      'Item coverage is not pass rate. Product-complete is not claimed from coverage percent alone.',
      'Severity labels are taken only from documented artifact fields (critical/P0, high/P1/serious, medium/P2/moderate, low/P3/minor, info). Otherwise severity is Unclassified.',
      'Quality gate overall is PASS, FAIL, or BLOCKED. WARNING is never treated as PASS.',
      `Timezone for this report is ${PKT_TIMEZONE} (${PKT_OFFSET}). PST in this project means Pakistan Standard Time.`,
    ],
    officialFormulas: [
      kpis.identity.officialTestableFormula,
      kpis.definitions.totalTests,
      kpis.definitions.executed,
      kpis.definitions.passed,
      kpis.definitions.failed,
      kpis.definitions.blocked,
      kpis.definitions.notTested,
      kpis.definitions.coveragePercent,
      kpis.definitions.passRatePercent,
      kpis.identity.fourWayNote,
      present(input.coverageFormula) ?? 'Coverage formula was not present in the coverage artifact.',
    ],
    knownLimitations: input.limitations,
    configuration: [
      { label: 'Application / project name', value: asDisplay(input.projectName) },
      { label: 'Base URL', value: asDisplay(input.baseUrl) },
      { label: 'Test run ID', value: asDisplay(input.executionId) },
      { label: 'Start', value: asDisplay(input.startTime) },
      { label: 'End', value: asDisplay(input.endTime) },
      { label: 'Duration', value: formatDurationBetween(input.startTime, input.endTime) },
      { label: 'Environment', value: asDisplay(input.environment) },
      { label: 'Framework version', value: asDisplay(input.frameworkVersion) },
      { label: 'Report template version', value: asDisplay(input.reportVersion) },
      { label: 'Browsers', value: input.browsers.length ? input.browsers.join(', ') : NOT_AVAILABLE },
      { label: 'Test suite', value: asDisplay(input.testSuite) },
      { label: 'Timezone', value: `${PKT_TIMEZONE} (${PKT_OFFSET})` },
    ].filter((row) => row.value !== NOT_AVAILABLE),
  };
}

export function buildMasterNormalizedSummary(input: MasterSummarySources): MasterNormalizedSummary {
  const kpis = buildKpiSnapshot(input.coverage);
  const release = buildRelease(input.qualityGate, input.overallStatus);
  const riskAreas = input.coverage?.riskAreas ?? [];
  const keyFindings = buildKeyFindings({
    release,
    qualityGate: input.qualityGate,
    riskAreas,
    moduleFindings: input.moduleFindings,
  });
  const defects = buildDefects({
    release,
    failures: input.failures,
    riskAreas,
    moduleFindings: input.moduleFindings,
  });
  const defectsByGroup: MasterNormalizedSummary['defectsByGroup'] = {
    'Critical / Release Blocking': defects.filter((row) => row.group === 'Critical / Release Blocking'),
    High: defects.filter((row) => row.group === 'High'),
    Medium: defects.filter((row) => row.group === 'Medium'),
    Low: defects.filter((row) => row.group === 'Low'),
    Unclassified: defects.filter((row) => row.group === 'Unclassified'),
  };
  const recommendedActions = buildRecommendedActions(defects);
  return {
    kpis,
    cover: buildCover(input, release),
    release,
    keyFindings,
    defects,
    defectsByGroup,
    recommendedActions,
    domainMatrix: [],
    scope: buildScope(input.stages),
    failureDistribution: buildFailureDistribution(input.failures),
    retestRows: buildRetestRows(input.retest),
    limitations: input.limitations,
    methodology: buildMethodology(input, kpis),
  };
}

export function kpiCardValue(value: number | null, suffix = ''): string {
  if (value == null) return NOT_AVAILABLE;
  return suffix ? `${value}${suffix}` : String(value);
}
