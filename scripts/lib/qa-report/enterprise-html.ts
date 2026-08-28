import fs from 'fs';
import path from 'path';
import type { EnterpriseReportModel } from './enterprise-model';
import { sanitizeDocxText } from '../../../npm-docs/sanitize-text';

function escapeHtml(text: string): string {
  return sanitizeDocxText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusClass(status: string): string {
  const upper = status.toUpperCase();
  if (upper.includes('PASS') && !upper.includes('FAIL')) return 'pass';
  if (upper.includes('FAIL')) return 'fail';
  return '';
}

function table(headers: string[], rows: string[][]): string {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) => {
            const header = headers[index] ?? '';
            const isStatus =
              header.toLowerCase().includes('status') || header.toLowerCase().includes('result');
            const cls = isStatus ? statusClass(cell) : '';
            return `<td class="${cls}">${escapeHtml(cell)}</td>`;
          })
          .join('')}</tr>`
    )
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function bullets(items: string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function kv(rows: Array<{ label: string; value: string }>): string {
  return table(
    ['Field', 'Value'],
    rows.map((row) => [row.label, row.value])
  );
}

export function generateEnterpriseHtml(model: EnterpriseReportModel): string {
  const kpiCards = [
    ['UI Executions', String(model.kpi.totalUiExecutions)],
    ['Passed', String(model.kpi.passed)],
    ['Failed', String(model.kpi.failed)],
    ['Skipped', String(model.kpi.skipped)],
    ['Pass Rate', model.kpi.passRate],
    ['UI Scenarios', String(model.kpi.uniqueUiScenarios)],
    ['Browsers', model.kpi.browserCoverage],
    ['API Requests', String(model.kpi.apiRequests)],
    ['Perf Samples', String(model.kpi.performanceSamples)],
    ['Defects', String(model.kpi.defects)],
  ]
    .map(
      ([label, value]) =>
        `<div class="kpi"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value ${statusClass(value)}">${escapeHtml(value)}</div></div>`
    )
    .join('');

  const passedPct = model.kpi.totalUiExecutions
    ? (model.distribution.passed / model.kpi.totalUiExecutions) * 100
    : 0;
  const failedPct = model.kpi.totalUiExecutions
    ? (model.distribution.failed / model.kpi.totalUiExecutions) * 100
    : 0;
  const skippedPct = model.kpi.totalUiExecutions
    ? (model.distribution.skipped / model.kpi.totalUiExecutions) * 100
    : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(model.meta.reportTitle)} — ${escapeHtml(model.meta.projectName)}</title>
  <style>
    :root {
      --navy: #1f3864;
      --slate: #334155;
      --muted: #64748b;
      --border: #cbd5e1;
      --header: #e8eef7;
      --pass: #166534;
      --fail: #991b1b;
      --bg: #f8fafc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Calibri, "Segoe UI", Arial, sans-serif;
      color: var(--slate);
      background: var(--bg);
      line-height: 1.5;
    }
    .page {
      max-width: 1100px;
      margin: 0 auto;
      background: #fff;
      padding: 2rem 2.25rem 3rem;
      box-shadow: 0 1px 3px rgba(0,0,0,.08);
    }
    header.report-header, footer.report-footer {
      color: var(--muted);
      font-size: 0.85rem;
      border-color: var(--border);
    }
    header.report-header {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.75rem;
      margin-bottom: 1.5rem;
    }
    footer.report-footer {
      border-top: 1px solid var(--border);
      margin-top: 2rem;
      padding-top: 0.75rem;
      text-align: center;
    }
    .cover {
      text-align: center;
      padding: 2rem 0 1rem;
      page-break-after: always;
    }
    .cover h1 {
      color: var(--navy);
      font-size: 2rem;
      margin: 0 0 0.5rem;
      letter-spacing: 0.02em;
    }
    .cover h2 {
      color: var(--slate);
      font-weight: 600;
      margin: 0 0 1.5rem;
    }
    h1.section {
      color: var(--navy);
      font-size: 1.35rem;
      border-bottom: 2px solid var(--navy);
      padding-bottom: 0.35rem;
      margin-top: 2rem;
      page-break-after: avoid;
    }
    h2.section {
      color: var(--navy);
      font-size: 1.1rem;
      margin-top: 1.25rem;
      page-break-after: avoid;
    }
    p { margin: 0.5rem 0 0.75rem; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.75rem 0 1.25rem;
      font-size: 0.92rem;
      table-layout: fixed;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 0.45rem 0.6rem;
      vertical-align: top;
      text-align: left;
    }
    th { background: var(--header); color: var(--navy); }
    td.pass, .pass { color: var(--pass); font-weight: 700; }
    td.fail, .fail { color: var(--fail); font-weight: 700; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.75rem;
      margin: 1rem 0 1.25rem;
    }
    .kpi {
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.75rem;
      background: #fff;
    }
    .kpi-label { font-size: 0.78rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    .kpi-value { font-size: 1.15rem; font-weight: 700; margin-top: 0.25rem; color: var(--navy); word-break: break-word; }
    .status-banner {
      display: inline-block;
      padding: 0.4rem 0.8rem;
      border: 1px solid var(--border);
      border-radius: 4px;
      font-weight: 700;
      margin: 0.5rem 0 1rem;
    }
    .bar {
      display: flex;
      height: 18px;
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 3px;
      overflow: hidden;
      margin: 0.75rem 0 1.25rem;
    }
    .bar .p { background: #86efac; }
    .bar .f { background: #fca5a5; }
    .bar .s { background: #cbd5e1; }
    ul { margin: 0.4rem 0 1rem; padding-left: 1.2rem; }
    @media print {
      body { background: #fff; }
      .page { box-shadow: none; max-width: none; padding: 0; }
      .cover { page-break-after: always; }
      h1.section { page-break-before: auto; }
    }
    @media (max-width: 900px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="report-header">
      <div>${escapeHtml(model.meta.reportTitle)}</div>
      <div>${escapeHtml(model.meta.projectName)}</div>
    </header>

    <section class="cover">
      <h1>${escapeHtml(model.meta.reportTitle)}</h1>
      <h2>${escapeHtml(model.meta.projectName)}</h2>
      ${table(
        ['Attribute', 'Details'],
        [
          ['Application', model.meta.applicationName],
          ['Testing Phase', model.meta.testingPhase],
          ['Environment', model.meta.environment],
          ['Report Version', model.meta.reportVersion],
          ['Execution Date', model.meta.executionDate],
          ['Prepared By', model.meta.preparedBy],
          ['Reviewed By', model.meta.reviewedBy],
          ['Overall QA Status', model.meta.overallStatus],
        ]
      )}
      <p>Generated from automation execution artifacts. Original test results are preserved without modification.</p>
    </section>

    <h1 class="section">Report Structure — Five QA Layers</h1>
    <p>This report is organized into five professional QA layers for stakeholders, management, and delivery teams.</p>
    ${table(
      ['Layer', 'Title', 'Purpose'],
      model.layers.map((layer) => [layer.id, layer.title, layer.purpose])
    )}

    <h1 class="section">LAYER 1 — Executive Summary</h1>
    ${model.executiveSummary.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
    <h2 class="section">1.1 KPI Dashboard</h2>
    <div class="kpi-grid">${kpiCards}</div>
    <div class="status-banner ${statusClass(model.meta.overallStatus)}">Overall QA Status: ${escapeHtml(model.meta.overallStatus)}</div>
    <p><strong>Release Decision Preview:</strong> ${escapeHtml(model.releaseRecommendation.decision)}</p>

    <h1 class="section">LAYER 2 — Test Evidence</h1>
    <p>This layer presents factual execution evidence only. Values are taken from automation artifacts without alteration.</p>

    <h2 class="section">2.1 Project &amp; Test Information</h2>
    ${kv(model.projectInfo)}

    <h2 class="section">2.2 Test Scope — In Scope</h2>
    ${bullets(model.inScope)}
    <h2 class="section">2.3 Test Scope — Out of Scope</h2>
    ${bullets(model.outOfScope)}

    <h2 class="section">2.4 Testing Types Executed</h2>
    ${table(
      ['Testing Type', 'Tool', 'Coverage', 'Result'],
      model.testingTypes.map((row) => [row.type, row.tool, row.coverage, row.result])
    )}

    <h2 class="section">2.5 Test Environment</h2>
    ${kv(model.environment)}

    <h2 class="section">2.6 Playwright — UI / E2E Evidence</h2>
    <h2 class="section">2.6.1 Execution Summary</h2>
    ${table(
      ['Metric', 'Value'],
      [
        ['Total Executions', String(model.playwright.total)],
        ['Passed', String(model.playwright.passed)],
        ['Failed', String(model.playwright.failed)],
        ['Skipped', String(model.playwright.skipped)],
        ['Pass Rate', model.playwright.passRate],
        ['Total Duration (ms)', String(model.playwright.durationMs)],
      ]
    )}
    <h2 class="section">2.6.2 Browser Summary</h2>
    ${table(
      ['Browser', 'Tests', 'Passed', 'Failed', 'Skipped', 'Pass Rate'],
      model.playwright.browsers.map((b) => [
        b.browser,
        String(b.total),
        String(b.passed),
        String(b.failed),
        String(b.skipped),
        b.passRate,
      ])
    )}
    <h2 class="section">2.6.3 Detailed Test Executions</h2>
    ${table(
      ['Test Case ID', 'Spec File', 'Test Scenario', 'Browser', 'Status', 'Duration (ms)', 'Started At'],
      model.playwright.executions.map((row) => [
        row.testCaseId,
        row.specFile,
        row.scenario,
        row.browser,
        row.status,
        String(row.durationMs),
        row.startedAt,
      ])
    )}

    <h2 class="section">2.7 API Smoke Test Evidence</h2>
    <p><strong>${escapeHtml(model.api.terminology)}</strong></p>
    ${
      model.api.available
        ? `${table(
            ['Metric', 'Value'],
            [
              ['Collection', model.api.collection],
              ['Iterations', String(model.api.iterations)],
              ['Requests Executed', String(model.api.requestsExecuted)],
              ['Request Errors', String(model.api.requestErrors)],
              ['Assertions Executed', String(model.api.assertionsExecuted)],
              ['Assertions Passed', String(model.api.assertionsPassed)],
              ['Assertions Failed', String(model.api.assertionsFailed)],
              ['Average Response Time (ms)', String(model.api.avgMs)],
              ['Minimum Response Time (ms)', String(model.api.minMs)],
              ['Maximum Response Time (ms)', String(model.api.maxMs)],
            ]
          )}
          <h2 class="section">2.7.1 Request-Level Results</h2>
          ${table(
            ['Test ID', 'Method', 'Endpoint', 'Status Code', 'Response Time (ms)', 'Assertion', 'Result'],
            model.api.requests.map((row) => [
              row.testId,
              row.method,
              row.endpoint,
              row.statusCode,
              String(row.responseTimeMs),
              row.assertion,
              row.result,
            ])
          )}`
        : '<p>API results were not available in the current execution data.</p>'
    }

    <h2 class="section">2.8 Performance Validation Evidence</h2>
    <p><strong>${escapeHtml(model.performance.terminology)}</strong></p>
    <p>${escapeHtml(model.performance.slaNote)}</p>
    ${
      model.performance.available
        ? `${table(
            ['Metric', 'Value'],
            [
              ['Target', model.performance.target],
              ['Threads', String(model.performance.threads)],
              ['Ramp-up (seconds)', String(model.performance.rampUpSeconds)],
              ['Loop Count', String(model.performance.loopCount)],
              ['Total Samples', String(model.performance.totalSamples)],
              ['Successful Samples', String(model.performance.successfulSamples)],
              ['Failed Samples', String(model.performance.failedSamples)],
              ['Error Rate', model.performance.errorRate],
              ['Average Response Time (ms)', String(model.performance.avgMs)],
              ['Minimum Response Time (ms)', String(model.performance.minMs)],
              ['Maximum Response Time (ms)', String(model.performance.maxMs)],
            ]
          )}
          <h2 class="section">2.8.1 Sample Results</h2>
          ${table(
            ['#', 'Thread', 'Label', 'URL', 'Status Code', 'Time (ms)', 'Result'],
            model.performance.samples.map((row) => [
              String(row.index),
              row.thread,
              row.label,
              row.url,
              row.statusCode,
              String(row.elapsedMs),
              row.result,
            ])
          )}`
        : '<p>Performance results were not available in the current execution data.</p>'
    }

    <h2 class="section">2.9 Test Artifacts</h2>
    ${table(
      ['Artifact', 'Location'],
      model.artifacts.map((item) => [item.name, item.location])
    )}

    <h1 class="section">LAYER 3 — QA Analysis</h1>
    <p>This layer interprets the evidence. It does not invent requirements, defects, or acceptance criteria.</p>
    <h2 class="section">3.1 Coverage Analysis</h2>
    <p><strong>${escapeHtml(model.coverage.coverageNote)}</strong></p>
    ${table(
      ['Coverage Dimension', 'Value'],
      [
        ['Unique UI Test Scenarios (Test Cases)', String(model.coverage.uniqueUiScenarios)],
        ['UI Test Executions', String(model.coverage.uiExecutions)],
        ['Browser Coverage', model.coverage.browsers.join(', ') || 'Not Provided'],
        ['API Requests Executed', String(model.coverage.apiRequests)],
        ['Performance Samples', String(model.coverage.performanceSamples)],
        ['Functional Areas Covered', model.coverage.functionalAreas.join('; ') || 'Not Provided'],
      ]
    )}
    <h2 class="section">3.2 Requirement Traceability</h2>
    <p>${escapeHtml(model.requirementTraceabilityNote)}</p>
    <h2 class="section">3.3 Defect Summary</h2>
    <p>${escapeHtml(model.defects.note)}</p>
    ${table(
      ['Severity', 'Count'],
      [
        ['Critical', String(model.defects.critical)],
        ['High', String(model.defects.high)],
        ['Medium', String(model.defects.medium)],
        ['Low', String(model.defects.low)],
      ]
    )}
    <h2 class="section">3.4 Test Result Distribution (UI Executions)</h2>
    <div class="bar">
      <div class="p" style="width:${passedPct}%"></div>
      <div class="f" style="width:${failedPct}%"></div>
      <div class="s" style="width:${skippedPct}%"></div>
    </div>
    ${table(
      ['Status', 'Count', 'Percentage'],
      [
        ['Passed', String(model.distribution.passed), `${passedPct.toFixed(1)}%`],
        ['Failed', String(model.distribution.failed), `${failedPct.toFixed(1)}%`],
        ['Skipped', String(model.distribution.skipped), `${skippedPct.toFixed(1)}%`],
      ]
    )}
    <h2 class="section">3.5 Analytical Findings</h2>
    ${bullets(model.qaAnalysis)}
    <h2 class="section">3.6 Automated Quality Check</h2>
    ${bullets(model.qualityChecks)}
    <h2 class="section">3.7 Analysis Conclusion</h2>
    ${model.conclusion.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}

    <h1 class="section">LAYER 4 — Risks &amp; Limitations</h1>
    <p>A high automated pass rate does not mean the full application is defect-free. The following limitations are supported by the available execution scope.</p>
    ${bullets(model.risks)}

    <h1 class="section">LAYER 5 — Release Recommendation</h1>
    <div class="status-banner ${statusClass(model.releaseRecommendation.status)}">QA Status: ${escapeHtml(model.releaseRecommendation.status)}</div>
    <p><strong>Release Decision:</strong> ${escapeHtml(model.releaseRecommendation.decision)}</p>
    <p>${escapeHtml(model.releaseRecommendation.summary)}</p>
    ${bullets(model.releaseRecommendation.bullets)}
    <p><em>This recommendation is evidence-based and scoped. It must be read together with Layers 2–4 and must not be interpreted as an unrestricted production-readiness certificate.</em></p>

    <footer class="report-footer">
      Version ${escapeHtml(model.meta.reportVersion)} |
      Generated ${escapeHtml(model.meta.generatedAt.slice(0, 19))} |
      ${escapeHtml(model.meta.preparedBy)}
    </footer>
  </div>
</body>
</html>`;
}

export function writeEnterpriseHtml(model: EnterpriseReportModel, outputPath: string): string {
  const html = generateEnterpriseHtml(model);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');
  return outputPath;
}
