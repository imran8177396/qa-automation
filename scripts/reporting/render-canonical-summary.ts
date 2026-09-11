import path from 'path';
import { PATHS } from '../lib/paths';
import type { CoverageReport } from '../coverage/types';
import type { FailureAnalysisSummary } from '../failures/types';
import type { EnterpriseReportModel } from '../lib/qa-report/enterprise-model';
import { reportQualityWarnings } from '../lib/qa-report/quality-checks';
import type { FinalVerdict } from './verdict';
import type { ProfessionalReportPaths } from './write-enterprise-report';

function toPosix(target: string): string {
  return path.relative(PATHS.root, target).replace(/\\/g, '/');
}

function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return 'NOT_AVAILABLE';
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  return `${(minutes / 60).toFixed(2)}h`;
}

function classifyDefectFamily(classification: string): string {
  switch (classification) {
    case 'ASSERTION_FAILURE':
      return 'APPLICATION DEFECT (heuristic — assertion failed against observed product behavior; not a ticket)';
    case 'ENVIRONMENT':
    case 'NETWORK_ERROR':
      return 'ENVIRONMENT / NETWORK';
    case 'NAVIGATION_TIMEOUT':
    case 'ELEMENT_TIMEOUT':
    case 'CONSOLE_ERROR':
    case 'FLAKY':
      return 'AUTOMATION or ENVIRONMENT (timeout / console / flake heuristic — not weakened to pass)';
    default:
      return classification;
  }
}

export function renderCanonicalFinalReportMd(input: {
  generatedAt: string;
  verdict: FinalVerdict;
  projectName: string;
  coverage: CoverageReport;
  failures: FailureAnalysisSummary;
  model: EnterpriseReportModel;
  professional: ProfessionalReportPaths | null;
  professionalError?: string;
}): string {
  const { coverage, failures, model, professional, verdict } = input;
  const totals = coverage.totals;
  const pipeline = model.pipeline;
  const totalDurationMs = pipeline.stages.reduce((sum, row) => sum + (row.durationMs || 0), 0);
  const qualityWarnings = reportQualityWarnings(model.qualityCheckRecords);
  const byClass = Object.entries(failures.byClass).filter(([, count]) => count > 0);
  const uncovered = coverage.records.filter((row) => row.status === 'UNCOVERED');
  const blocked = coverage.records.filter((row) => row.status === 'BLOCKED');
  const untestable = coverage.records.filter((row) => row.status === 'UNTESTABLE');
  const requiresConfig = model.coverageBreakdown.items.filter(
    (row) => row.category === 'REQUIRES_CONFIGURATION'
  );

  const professionalLines = professional
    ? [
        `- Timestamp folder: ${professional.timestamp}`,
        `- Text: ${toPosix(professional.txtPath)}`,
        `- Word: ${toPosix(professional.docxPath)}`,
        ...(professional.htmlPath ? [`- HTML: ${toPosix(professional.htmlPath)}`] : []),
        ...(professional.pdfPath ? [`- PDF: ${toPosix(professional.pdfPath)}`] : ['- PDF: NOT_AVAILABLE (generator skipped or tool missing)']),
        `- Latest index: ${toPosix(PATHS.docsQaTestResultsLatest)}`,
      ]
    : [
        '- Professional five-layer Word/HTML/PDF was not written in this invocation.',
        input.professionalError ? `- Reason: ${input.professionalError}` : '- Run `npm run docs:qa-report` after fixing report-integrity blockers.',
      ];

  const lines: string[] = [
    '# Final QA Report',
    '',
    `**Verdict:** ${verdict}`,
    `**Release recommendation:** ${model.releaseRecommendation.decision}`,
    `**Generated:** ${input.generatedAt}`,
    `**Project:** ${input.projectName}`,
    `**Target URL:** ${pipeline.url}`,
    `**Command:** ${pipeline.command}`,
    `**Orchestrator overall:** ${pipeline.overallStatus}`,
    `**Pipeline duration (sum of stage durationMs):** ${formatDuration(totalDurationMs)}`,
    '',
    '> Statuses, coverage, and counts below come only from `reports/` artifacts. Coverage is not pass rate. Nothing is marked PASS to hide a failure.',
    '',
    '## Exhaustive execution (no silent skip)',
    '',
    'qa:all does not silently skip runnable tests, scenarios, or UI execution. Planned checks run when executable. Safety-blocked, unconfigurable, or tool-missing items are recorded as BLOCKED / NOT_TESTED / REQUIRES_CONFIGURATION with a reason. Failures stay FAIL. Visual / responsive / accessibility / workflows use the resolved target URL — the local fixture is not substituted when a live origin is configured.',
    '',
    '## LAYER 1 — Executive Summary',
    '',
    ...model.executiveSummary.map((line) => `- ${line}`),
    '',
    `- Passed stages: ${model.suiteGroups.passed.join(', ') || 'none'}`,
    `- Failed stages: ${model.suiteGroups.failed.join(', ') || 'none'}`,
    `- Not-executed stages: ${model.suiteGroups.notExecuted.join(', ') || 'none'}`,
    '',
    '## All 20 pipeline stages',
    '',
    '| # | Stage | Status | Exit | Duration | Reason |',
    '| --- | --- | --- | --- | --- | --- |',
    ...pipeline.stages.map(
      (row) =>
        `| ${row.id} | ${row.name} | ${row.status} | ${row.exitCode} | ${formatDuration(row.durationMs)} | ${row.reason || ''} |`
    ),
    '',
    professional
      ? `Note: the stage table above is the original orchestrator record. This professional pack (${professional.timestamp}) was written afterward from the same \`reports/\` artifacts. A later successful report generation does not rewrite the original Stage 20 FAIL row.`
      : '',
    '',
    '## Coverage vs pass rate',
    '',
    'Coverage = covered (TESTED + FAILED) ÷ testable discovered items. Pass rate is a different figure and is never used as coverage.',
    '',
    `- Testable items: ${totals.testableItems}`,
    `- Covered (TESTED + FAILED): ${totals.testedItems} (${totals.itemCoveragePercent}%)`,
    `- Uncovered: ${totals.uncoveredItems}`,
    `- Scenario coverage: ${totals.testedScenarios}/${totals.executableScenarios} (${totals.scenarioCoveragePercent}%)`,
    `- Pass rate (not coverage): ${totals.passRatePercent ?? 'n/a'}%`,
    `- By status: TESTED ${totals.byStatus.TESTED} / FAILED ${totals.byStatus.FAILED} / BLOCKED ${totals.byStatus.BLOCKED} / UNTESTABLE ${totals.byStatus.UNTESTABLE} / UNCOVERED ${totals.byStatus.UNCOVERED}`,
    `- Executions: passed ${totals.passedExecutions}, failed ${totals.failedExecutions}, skipped ${totals.skippedExecutions}`,
    '',
    '## Failure analysis (not defect tickets)',
    '',
    `- Classified failures: ${failures.totalFailures}`,
    `- Analyzer classes: ${byClass.map(([label, count]) => `${label} ${count}`).join(', ') || 'none'}`,
    '',
    '| Analyzer class | Count | Reporting family |',
    '| --- | --- | --- |',
    ...byClass.map(([label, count]) => `| ${label} | ${count} | ${classifyDefectFamily(label)} |`),
    '',
    'Classifications are evidence-based heuristics. They are not Jira tickets. Tests were not modified merely to pass.',
    '',
    '## Important application findings (from security / discovery / generated checks)',
    '',
    ...model.security.findings
      .filter((row) => row.severity === 'high')
      .map((row) => `- P1/high security: ${row.rule} — ${row.page} (${row.actual || row.status})`),
    ...model.seo.findings
      .filter((row) => row.severity === 'high')
      .slice(0, 12)
      .map((row) => `- SEO high: ${row.rule} — ${row.page} — ${row.detail}`),
    ...model.content.findings
      .filter((row) => row.severity === 'high')
      .slice(0, 12)
      .map((row) => `- Content high: ${row.rule} — ${row.page} — expected ${row.expected}, actual ${row.actual}`),
    `- Accessibility: ${model.accessibility.status} (${model.accessibility.pagesAnalyzed} page(s), ${model.accessibility.violationCount} violation(s)). Automated only — not a complete WCAG audit.`,
    `- Visual: ${model.visual.status}. ${model.visual.note || ''}`.trim(),
    '',
    '## What was NOT tested (and why)',
    '',
    `- Workflows: ${model.correlation.available ? `${model.correlation.workflows.length} correlated workflow(s)` : 'NOT_EXECUTED'} — ${model.correlation.note || 'no UI+API workflow artifact'}`,
    `- Retest: ${model.retest.status}${model.retest.reason ? ` — ${model.retest.reason}` : ''}`,
    `- Lighthouse / CWV: ${model.lighthouse.status} — ${model.lighthouse.skipReason}`,
    `- JMeter heavy profiles (load/stress/spike/soak): BLOCKED unless \`--authorize-heavy\` and an allowlisted host`,
    `- API authentication / authorization: BLOCKED / REQUIRES_CONFIGURATION when no documented auth contract`,
    `- Form submission and destructive clicks: never exercised (safety policy)`,
    `- Real-device / Mobile Safari / Android Chrome: not in this execution`,
    `- Penetration test: not in this execution (QA-level security only)`,
    '',
    '### UNCOVERED items',
    '',
    ...uncovered.map((row) => `- ${row.id} — ${row.element || row.page} (${row.kind}) — ${row.reason}`),
    uncovered.length === 0 ? '- None listed in coverage.json.' : '',
    '',
    '### BLOCKED items',
    '',
    ...blocked.map((row) => `- ${row.id} — ${row.element || row.page} (${row.kind}) — ${row.reason}`),
    blocked.length === 0 ? '- None listed in coverage.json.' : '',
    '',
    '### UNTESTABLE items',
    '',
    ...untestable.map((row) => `- ${row.id} — ${row.element || row.page} (${row.kind}) — ${row.reason}`),
    untestable.length === 0 ? '- None listed in coverage.json.' : '',
    '',
    '### REQUIRES_CONFIGURATION / skipped generated checks',
    '',
    ...requiresConfig.map((row) => `- ${row.testCaseId} — ${row.scenario} — ${row.reason}`),
    `- BLOCKED generated checks: ${model.coverageBreakdown.blocked}`,
    `- REQUIRES_CONFIGURATION generated checks: ${model.coverageBreakdown.requiresConfiguration}`,
    `- NOT_TESTED generated checks: ${model.coverageBreakdown.notTested}`,
    '',
    '## Performance (JMeter liveness) and Lighthouse',
    '',
    `- Profile: ${model.performance.profile}`,
    `- Run status: ${model.performance.runStatus} (liveness is RECORDED, never PASS)`,
    `- Samples: ${model.kpi.performanceSamples}`,
    `- p50/p90/p95/p99 ms: ${model.performance.p50Ms}/${model.performance.p90Ms}/${model.performance.p95Ms}/${model.performance.p99Ms}`,
    `- TTFB: ${model.performance.ttfbMs}`,
    `- Throughput/sec: ${model.performance.throughputPerSec}`,
    `- Sample URL: ${model.performance.sampleUrl}`,
    `- Threshold status: ${model.performance.thresholdStatus}`,
    `- ${model.performance.slaNote}`,
    `- Lighthouse: ${model.lighthouse.status} — ${model.lighthouse.skipReason}`,
    '',
    '## API notes (including tautological / observed-status)',
    '',
    ...model.api.requests.map(
      (row) => `- ${row.testId} ${row.method} ${row.endpoint} → ${row.statusCode} in ${row.responseTimeMs}ms — ${row.result}`
    ),
    '',
    ...qualityWarnings.map((row) => `- Report-quality warning: ${row.id} ${row.result} — ${row.detail}`),
    qualityWarnings.length === 0
      ? '- No tautological-assertion quality warnings were recorded.'
      : '- Tautological assertions are low-value (expected copied from last observed). They are disclosed, not hidden, and they did not abort this report.',
    '',
    '## Browsers and suite origin',
    '',
    `- Browser coverage KPI: ${model.kpi.browserCoverage}`,
    ...model.originMismatches.map(
      (row) =>
        `- Origin mismatch: suite \`${row.suite}\` ran against ${row.origin} (configured base ${row.baseUrl})${row.product ? ' — PRODUCT suite' : ' — non-product suite'}`
    ),
    model.originMismatches.length === 0 ? '- No suite-origin mismatches were recorded.' : '',
    '',
    '## Quality checks',
    '',
    ...model.qualityCheckRecords.map((row) => `- ${row.result}: ${row.id} — ${row.detail}`),
    '',
    '## LAYER 3 — QA Analysis',
    '',
    ...model.qaAnalysis.map((line) => `- ${line}`),
    '',
    '## LAYER 4 — Risks & Limitations',
    '',
    ...model.risks.map((line) => `- ${line}`),
    '',
    '## LAYER 5 — Release Recommendation',
    '',
    `QA Status: ${model.releaseRecommendation.status}`,
    `Release Decision: ${model.releaseRecommendation.decision}`,
    '',
    model.releaseRecommendation.summary,
    '',
    ...model.releaseRecommendation.bullets.map((line) => `- ${line}`),
    '',
    '## Professional SQA report (five layers)',
    '',
    'Automatically generated at the end of this run (or from existing artifacts). Status and counts come from execution artifacts only.',
    '',
    '1. Executive Summary',
    '2. Test Evidence',
    '3. QA Analysis',
    '4. Risks & Limitations',
    '5. Release Recommendation',
    '',
    ...professionalLines,
    '',
    '## Artifact index',
    '',
    `- Coverage: ${toPosix(PATHS.coverageJsonFile)}`,
    `- Coverage matrix: ${toPosix(PATHS.coverageMatrixDoc)}`,
    `- Uncovered items: ${toPosix(PATHS.uncoveredItemsDoc)}`,
    `- Test inventory: ${toPosix(PATHS.testInventoryDoc)}`,
    `- Failure analysis: reports/failures/summary.json`,
    `- Orchestrator: reports/orchestrator/stages.md`,
    `- Discovery: reports/discovery/`,
    `- JMeter findings: ${toPosix(PATHS.jmeterFindings)}`,
    `- Security: reports/security/summary.json`,
    `- SEO: reports/seo/summary.json`,
    `- Content: reports/content/summary.json`,
    `- Accessibility: reports/accessibility/summary.json`,
    `- Visual: reports/visual/summary.json`,
    `- Lighthouse: reports/lighthouse/summary.json (absent ⇒ NOT_EXECUTED)`,
    `- Quality (tautological): reports/quality/tautological-assertions.json`,
    ...model.artifacts.map((row) => `- ${row.name}: ${row.location}`),
    '',
  ];

  return `${lines.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n')}\n`;
}
