import fs from 'fs';
import path from 'path';
import { loadConfig } from '../load-config';
import {
  loadReportFormat,
  resolveReportOutputPaths,
  writeLatestReportManifest,
  type ReportFormat,
} from './format';
import { buildEnterpriseReportModel, type EnterpriseReportModel } from './enterprise-model';
import { generateEnterpriseDocx } from './enterprise-docx';
import { writeEnterpriseHtml } from './enterprise-html';
import { writeEnterprisePdf } from './enterprise-pdf';
import { SectionRegistry } from './section-manifest';
import { TableAudit } from './empty-table';

function renderEnterpriseText(model: EnterpriseReportModel): string {
  const lines: string[] = [
    `${model.meta.reportTitle}`,
    `Project: ${model.meta.projectName}`,
    `Application: ${model.meta.applicationName}`,
    `Overall QA Status: ${model.meta.overallStatus}`,
    `Execution Date: ${model.meta.executionDate}`,
    `Generated: ${model.meta.generatedAt}`,
    '',
    '## Report Structure — Five QA Layers',
    ...model.layers.map((layer) => `- ${layer.id}: ${layer.title} — ${layer.purpose}`),
    '',
    '## LAYER 1 — Executive Summary',
    ...model.executiveSummary.map((line) => `- ${line}`),
    '- Exhaustive execution: no silent skip of runnable tests, scenarios, or UI. BLOCKED / NOT_TESTED / REQUIRES_CONFIGURATION items are listed with reasons.',
    `- Passed stages: ${model.suiteGroups.passed.join(', ') || 'none'}`,
    `- Failed stages: ${model.suiteGroups.failed.join(', ') || 'none'}`,
    `- Not-executed stages: ${model.suiteGroups.notExecuted.join(', ') || 'none'}`,
    '',
    '## KPI Dashboard',
    `- Total UI Executions: ${model.kpi.totalUiExecutions}`,
    `- Passed: ${model.kpi.passed}`,
    `- Failed: ${model.kpi.failed}`,
    `- Skipped: ${model.kpi.skipped}`,
    `- UI execution pass rate: ${model.passRates.uiFormatted}`,
    `- Assertion pass rate: ${model.passRates.assertionFormatted}`,
    `- Unique UI Scenarios: ${model.kpi.uniqueUiScenarios}`,
    `- Browser Coverage: ${model.kpi.browserCoverage}`,
    `- API Requests: ${model.kpi.apiRequests}`,
    `- Performance Samples: ${model.kpi.performanceSamples}`,
    `- Defects: ${model.kpi.defects}`,
    `- Release Decision Preview: ${model.releaseRecommendation.decision}`,
    '',
    '## LAYER 2 — Test Evidence',
    '### Playwright Executions',
  ];

  for (const row of model.playwright.executions) {
    lines.push(
      `- ${row.testCaseId} | ${row.specFile} | ${row.scenario} | ${row.browser} | ${row.status} | ${row.durationMs}ms`
    );
  }

  lines.push('', '### Discovery-Generated Check Coverage Breakdown');
  if (model.coverageBreakdown.items.length > 0) {
    lines.push(
      `- BLOCKED: ${model.coverageBreakdown.blocked}`,
      `- REQUIRES_CONFIGURATION: ${model.coverageBreakdown.requiresConfiguration}`,
      `- NOT_TESTED: ${model.coverageBreakdown.notTested}`,
      `- Other skipped: ${model.coverageBreakdown.otherSkipped}`
    );
    for (const item of model.coverageBreakdown.items) {
      lines.push(`- ${item.testCaseId} | ${item.scenario} | ${item.category} | ${item.reason}`);
    }
  } else {
    lines.push('- No discovery-generated checks were skipped in this execution.');
  }

  lines.push('', '### API Requests');
  for (const row of model.api.requests) {
    lines.push(
      `- ${row.testId} | ${row.method} | ${row.endpoint} | ${row.statusCode} | ${row.responseTimeMs}ms | ${row.result}`
    );
  }

  lines.push(
    '',
    '### Performance Note',
    model.performance.slaNote,
    `- Profile: ${model.performance.profile}`,
    `- Run status: ${model.performance.runStatus}`,
    `- p50/p90/p95/p99: ${model.performance.p50Ms}/${model.performance.p90Ms}/${model.performance.p95Ms}/${model.performance.p99Ms}`,
    `- TTFB: ${model.performance.ttfbMs}`,
    `- Throughput: ${model.performance.throughputPerSec}`,
    `- Sample URL: ${model.performance.sampleUrl}`
  );
  lines.push(
    '',
    '### Core Web Vitals (Lighthouse) — not JMeter',
    `- Status: ${model.lighthouse.status}`,
    `- Reason: ${model.lighthouse.skipReason}`,
    `- Source: ${model.lighthouse.source}`
  );

  lines.push('', '### Discovery & Element Inventory Evidence');
  if (model.discovery.available) {
    lines.push(
      `- Seed URL: ${model.discovery.seedUrl}`,
      `- Pages discovered (raw): ${model.discovery.pagesDiscoveredRaw}`,
      `- Pages discovered (unique): ${model.discovery.pagesDiscoveredUnique}`,
      `- Pages discovered (reported): ${model.discovery.pagesDiscovered}`,
      `- Pages With Errors: ${model.discovery.pagesWithErrors}`,
      `- Broken Links: ${model.discovery.brokenLinks}`,
      `- Console Errors Observed: ${model.discovery.totalConsoleErrors}`,
      `- Crawl Truncated: ${model.discovery.truncated ? 'Yes' : 'No'}`,
      `- Interactive Elements Inventoried: ${model.inventory.totalElements}`
    );
    for (const row of model.inventory.byType) lines.push(`  - Type: ${row.label} — ${row.count}`);
    for (const row of model.inventory.byRisk) lines.push(`  - Risk: ${row.label} — ${row.count}`);
  } else {
    lines.push('- No discovery run is associated with this execution.');
  }

  lines.push('', '### SEO Analysis');
  if (model.seo.available) {
    lines.push(
      `- Pages Analyzed: ${model.seo.pagesAnalyzed}`,
      `- Findings: ${model.seo.uniqueFindingCount}`,
      `- High Severity: ${model.seo.high}`,
      `- Medium Severity: ${model.seo.medium}`,
      `- Low Severity: ${model.seo.low}`
    );
    for (const f of model.seo.findings) lines.push(`  - [${f.severity}] ${f.rule} | ${f.page} | ${f.detail}`);
  } else {
    lines.push('- No SEO analysis is associated with this execution.');
  }

  lines.push('', '## LAYER 3 — QA Analysis');
  for (const item of model.qaAnalysis) lines.push(`- ${item}`);
  lines.push('', '### Defects', model.defects.note);
  lines.push('', '### Quality Checks');
  for (const check of model.qualityChecks) lines.push(`- ${check}`);
  lines.push('', '## LAYER 4 — Risks & Limitations');
  lines.push('', '### Accessibility / Security / Content / Visual / Failure / Retest');
  lines.push(
    `- Accessibility: ${model.accessibility.status} (${model.accessibility.pagesAnalyzed}/${model.accessibility.uniquePageCount} pages)`,
    `- Security: ${model.security.status}`,
    `- Content: ${model.content.status}`,
    `- Visual: ${model.visual.status}`,
    `- Failure analysis: ${model.failureAnalysis.available ? String(model.failureAnalysis.analyzed) : model.failureAnalysis.status}`,
    `- Retest: ${model.retest.status}${model.retest.status === 'NOT_EXECUTED' ? ` — ${model.retest.reason}` : ''}`
  );
  for (const risk of model.risks) lines.push(`- ${risk}`);
  lines.push(
    '',
    '## LAYER 5 — Release Recommendation',
    `QA Status: ${model.releaseRecommendation.status}`,
    `Release Decision: ${model.releaseRecommendation.decision}`,
    model.releaseRecommendation.summary
  );
  for (const item of model.releaseRecommendation.bullets) lines.push(`- ${item}`);
  lines.push('');

  return lines.join('\n');
}

export function buildQaReportText(): string {
  const model = buildEnterpriseReportModel();
  return renderEnterpriseText(model);
}

export async function generateQaReportDocx(format?: ReportFormat): Promise<{
  timestamp: string;
  txtPath: string;
  docxPath: string;
  htmlPath?: string;
  pdfPath?: string;
  latestManifestPath?: string;
  format: ReportFormat;
  model: EnterpriseReportModel;
}> {
  const config = loadConfig();
  if (config.report?.enabled === false) {
    throw new Error('Report generation is disabled in qa.config.json (report.enabled = false).');
  }

  const reportFormat = format ?? loadReportFormat();
  const model = buildEnterpriseReportModel();
  const generatedAt = model.meta.generatedAt;
  const outputPaths = resolveReportOutputPaths(reportFormat, generatedAt);
  const registry = new SectionRegistry();
  const audit = new TableAudit();

  const reportText = renderEnterpriseText(model);
  fs.mkdirSync(path.dirname(outputPaths.txtPath), { recursive: true });
  fs.writeFileSync(outputPaths.txtPath, reportText, 'utf8');

  if (outputPaths.htmlPath) {
    writeEnterpriseHtml(model, outputPaths.htmlPath, registry, audit);
  }

  await generateEnterpriseDocx(model, outputPaths.docxPath, registry, audit);
  registry.assertEveryReferenceResolves();

  let pdfPath = outputPaths.pdfPath;
  if (pdfPath && outputPaths.htmlPath) {
    try {
      await writeEnterprisePdf(outputPaths.htmlPath, pdfPath);
    } catch (error) {
      console.warn(`PDF generation skipped: ${String(error)}`);
      pdfPath = undefined;
    }
  }

  // Keep a model snapshot next to the report for auditability
  const modelPath = path.join(path.dirname(outputPaths.docxPath), 'qa-test-results.model.json');
  fs.writeFileSync(modelPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');

  const latestManifestPath = writeLatestReportManifest(
    reportFormat,
    generatedAt,
    {
      ...outputPaths,
      pdfPath,
    }
  );

  return {
    timestamp: outputPaths.timestamp,
    txtPath: outputPaths.txtPath,
    docxPath: outputPaths.docxPath,
    htmlPath: outputPaths.htmlPath,
    pdfPath,
    latestManifestPath,
    format: reportFormat,
    model,
  };
}

if (require.main === module) {
  generateQaReportDocx()
    .then(({ timestamp, txtPath, docxPath, htmlPath, pdfPath, latestManifestPath, format, model }) => {
      console.log(`Format:       ${format.id} v${format.version}`);
      console.log(`Timestamp:    ${timestamp}`);
      console.log(`QA Status:    ${model.meta.overallStatus}`);
      console.log(`Text report:  ${txtPath}`);
      console.log(`Word report:  ${docxPath}`);
      if (htmlPath) console.log(`HTML report:  ${htmlPath}`);
      if (pdfPath) console.log(`PDF report:   ${pdfPath}`);
      if (latestManifestPath) console.log(`Latest index: ${latestManifestPath}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
