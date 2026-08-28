import fs from 'fs';
import path from 'path';
import { loadConfig } from '../load-config';
import { PATHS } from '../paths';
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
    '',
    '## KPI Dashboard',
    `- Total UI Executions: ${model.kpi.totalUiExecutions}`,
    `- Passed: ${model.kpi.passed}`,
    `- Failed: ${model.kpi.failed}`,
    `- Skipped: ${model.kpi.skipped}`,
    `- Pass Rate: ${model.kpi.passRate}`,
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

  lines.push('', '### API Requests');
  for (const row of model.api.requests) {
    lines.push(
      `- ${row.testId} | ${row.method} | ${row.endpoint} | ${row.statusCode} | ${row.responseTimeMs}ms | ${row.result}`
    );
  }

  lines.push('', '### Performance Note', model.performance.slaNote);
  lines.push('', '## LAYER 3 — QA Analysis');
  for (const item of model.qaAnalysis) lines.push(`- ${item}`);
  lines.push('', '### Defects', model.defects.note);
  lines.push('', '### Quality Checks');
  for (const check of model.qualityChecks) lines.push(`- ${check}`);
  lines.push('', '## LAYER 4 — Risks & Limitations');
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

export function buildQaReportText(format?: ReportFormat): string {
  void format;
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
  const generatedAt = new Date().toISOString();
  const outputPaths = resolveReportOutputPaths(reportFormat, generatedAt);

  const reportText = renderEnterpriseText(model);
  fs.mkdirSync(path.dirname(outputPaths.txtPath), { recursive: true });
  fs.writeFileSync(outputPaths.txtPath, reportText, 'utf8');

  await generateEnterpriseDocx(model, outputPaths.docxPath);

  if (outputPaths.htmlPath) {
    writeEnterpriseHtml(model, outputPaths.htmlPath);
  }

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

  void PATHS;
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
