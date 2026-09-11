import fs from 'fs';
import path from 'path';
import type { EnterpriseReportModel } from './enterprise-model';
import { sanitizeDocxText } from '../../../npm-docs/sanitize-text';
import { SectionRegistry, resolveRefTokens } from './section-manifest';
import { TableAudit, prepareTableRows } from './empty-table';
import { NOT_AVAILABLE } from '../suite-origin';

function escapeHtml(text: string): string {
  return sanitizeDocxText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusClass(status: string): string {
  const upper = status.toUpperCase();
  if (upper.includes('CONDITIONAL')) return 'conditional';
  if (upper.includes('BLOCKED') || upper.includes('REQUIRES_CONFIGURATION')) return 'conditional';
  if (upper.includes('PASS') && !upper.includes('FAIL')) return 'pass';
  if (upper.includes('FAIL')) return 'fail';
  return '';
}

function table(
  headers: string[],
  rows: string[][],
  audit: TableAudit,
  emptyReason: string
): string {
  const prepared = prepareTableRows(headers, rows, audit, emptyReason);
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = prepared.placeholder
    ? `<tr><td colspan="${prepared.placeholder.colSpan}">${escapeHtml(prepared.placeholder.cells[0] ?? '')}</td></tr>`
    : prepared.rows
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

export function generateEnterpriseHtml(
  model: EnterpriseReportModel,
  registry: SectionRegistry = new SectionRegistry(),
  audit: TableAudit = new TableAudit()
): string {
  const t = (headers: string[], rows: string[][], emptyReason: string) =>
    table(headers, rows, audit, emptyReason);
  const kv = (rows: Array<{ label: string; value: string }>, emptyReason: string) =>
    t(
      ['Field', 'Value'],
      rows.map((row) => [row.label, row.value]),
      emptyReason
    );
  const heading = (id: string, tag: 'h1' | 'h2' = 'h2') =>
    `<${tag} class="section" id="${escapeHtml(id)}">${escapeHtml(registry.emit(id))}</${tag}>`;
  const line = (value: string) => escapeHtml(resolveRefTokens(value, registry));
  const bulletsResolved = (items: string[]) =>
    `<ul>${items.map((item) => `<li>${line(item)}</li>`).join('')}</ul>`;
  const kpiCards = [
    ['UI Executions', String(model.kpi.totalUiExecutions)],
    ['Passed', String(model.kpi.passed)],
    ['Failed', String(model.kpi.failed)],
    ['Skipped', String(model.kpi.skipped)],
    ['UI execution pass rate', model.passRates.uiFormatted],
    ['Assertion pass rate', model.passRates.assertionFormatted],
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
      --conditional: #92400e;
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
    td.conditional, .conditional { color: var(--conditional); font-weight: 700; }
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
      ${model.meta.pendingReview ? `<div class="status-banner conditional">PENDING REVIEW — reviewer is unset. This report is not approved.</div>` : ''}
      <p>Report timezone: ${escapeHtml(model.meta.timezone)}</p>
      ${t(
        ['Attribute', 'Details'],
        [
          ['Application', model.meta.applicationName],
          ['Testing Phase', model.meta.testingPhase],
          ['Environment', model.meta.environment],
          ['Report Version', model.meta.reportVersion],
          ['Execution Date', model.meta.executionDate],
          ['Report timezone', model.meta.timezone],
          ['Prepared By', model.meta.preparedBy],
          ['Reviewed By', model.meta.reviewedBy],
          ['Approval date', model.meta.approvalDate],
          ['Distribution', model.meta.distribution],
          ['Confidentiality', model.meta.confidentiality],
          ['Overall QA Status', model.meta.overallStatus],
        ],
        'cover attributes were not populated'
      )}
      ${t(
        ['Version', 'Date', 'Author', 'Summary'],
        model.revisionHistory.map((row) => [row.version, row.date, row.author, row.summary]),
        'revision history was not present in qa.config.json'
      )}
      <p>Generated from automation execution artifacts. Original test results are preserved without modification.</p>
    </section>

    <h1 class="section">Report Structure — Five QA Layers</h1>
    <p>This report is organized into five professional QA layers for stakeholders, management, and delivery teams.</p>
    ${t(
      ['Layer', 'Title', 'Purpose'],
      model.layers.map((layer) => [layer.id, layer.title, layer.purpose]),
      'layer map was empty'
    )}

    ${heading('layer-1', 'h1')}
    ${model.meta.pendingReview ? `<div class="status-banner conditional">PENDING REVIEW</div>` : ''}
    ${model.executiveSummary.map((textLine) => `<p>${line(textLine)}</p>`).join('')}
    ${t(
      ['Passed stages', 'Failed stages', 'Not-executed stages'],
      [
        [
          model.suiteGroups.passed.join(', ') || 'none',
          model.suiteGroups.failed.join(', ') || 'none',
          model.suiteGroups.notExecuted.join(', ') || 'none',
        ],
      ],
      'orchestrator stage groups were not present'
    )}
    ${heading('kpi')}
    <div class="kpi-grid">${kpiCards}</div>
    <p>UI execution pass rate: ${escapeHtml(model.passRates.uiFormatted)}. Assertion pass rate: ${escapeHtml(model.passRates.assertionFormatted)}.</p>
    <div class="status-banner ${statusClass(model.meta.overallStatus)}">Overall QA Status: ${escapeHtml(model.meta.overallStatus)}</div>
    <p><strong>Release Decision Preview:</strong> ${escapeHtml(model.releaseRecommendation.decision)}</p>

    ${heading('layer-2', 'h1')}
    <p>This layer presents factual execution evidence only. Values are taken from automation artifacts without alteration.</p>

    ${heading('project-info')}
    ${kv(model.projectInfo, 'project information rows were not populated')}

    ${heading('in-scope')}
    ${bulletsResolved(model.inScope)}
    ${heading('out-of-scope')}
    ${bulletsResolved(model.outOfScope)}

    ${heading('testing-types')}
    ${t(
      ['Testing Type', 'Tool', 'Coverage', 'Result'],
      model.testingTypes.map((row) => [row.type, row.tool, row.coverage, row.result]),
      'no testing types were recorded'
    )}

    ${heading('environment')}
    ${kv(model.environment, 'environment rows were not populated')}
    ${heading('pipeline-stages')}
    ${
      model.stageTimeline.available
        ? t(
            ['#', 'Stage', 'Status', 'Started', 'Completed', 'Duration (ms)', 'Reason'],
            model.stageTimeline.rows.map((row) => [
              String(row.id),
              row.name,
              row.status,
              row.startedAt,
              row.completedAt,
              String(row.durationMs),
              row.reason ?? '',
            ]),
            'stage timeline rows were empty'
          )
        : t(
            ['#', 'Stage', 'Status', 'Started', 'Completed', 'Duration (ms)', 'Reason'],
            [],
            model.pipeline.available
              ? 'orchestrator summary existed but no timestamped timeline rows were present'
              : 'reports/orchestrator/stages.md and timeline.json were not present'
          )
    }

    ${heading('playwright')}
    <p>Source: ${escapeHtml(model.playwright.sourceFile)}. Available: ${escapeHtml(model.playwright.available ? 'yes' : 'NOT_AVAILABLE')}. Origin: ${escapeHtml(model.playwright.originStatus)} (expected ${escapeHtml(model.playwright.configuredBaseUrl)}, actual ${escapeHtml(model.playwright.targetOrigin)}). ${escapeHtml(model.pipeline.evidenceIntegrityNote)}</p>
    <p>${escapeHtml(model.playwright.engineCaveats.join(' '))}</p>
    ${heading('playwright-summary')}
    ${t(
      ['Metric', 'Value'],
      [
        ['Total Executions', String(model.playwright.total)],
        ['Passed', String(model.playwright.passed)],
        ['Failed', String(model.playwright.failed)],
        ['Skipped', String(model.playwright.skipped)],
        ['Pass Rate', model.playwright.passRate],
        ['Total Duration (ms)', String(model.playwright.durationMs)],
      ],
      'Playwright summary metrics were not populated'
    )}
    ${heading('playwright-browsers')}
    <p>${escapeHtml(model.playwright.engineCaveats.join(' '))}</p>
    ${t(
      ['Browser', 'Status', 'Reason', 'Tests', 'Passed', 'Failed', 'Skipped', 'Pass Rate'],
      model.playwright.browsers.map((b) => [
        b.browser,
        String(b.status),
        b.reason || NOT_AVAILABLE,
        String(b.total),
        String(b.passed),
        String(b.failed),
        String(b.skipped),
        b.passRate,
      ]),
      model.playwright.available
        ? 'browsers[] was not present on reports/playwright/generated-check/summary.json'
        : 'generated-check results.json was not present — section 2.6 is NOT_AVAILABLE'
    )}
    ${heading('playwright-executions')}
    ${t(
      ['Test Case ID', 'Spec File', 'Test Scenario', 'Browser', 'Status', 'Duration (ms)', 'Started At'],
      model.playwright.executions.map((row) => [
        row.testCaseId,
        row.specFile,
        row.scenario,
        row.browser,
        row.status,
        String(row.durationMs),
        row.startedAt,
      ]),
      'no Playwright executions were present in the sourced results.json'
    )}
    ${heading('coverage-breakdown')}
    <p>Checks the discovery engine could not run to a PLANNED conclusion are never silently omitted —
    they appear above as SKIPPED with one of the reasons below, distinguishing an intentional safety
    boundary from an actual gap.</p>
    ${
      model.coverageBreakdown.items.length > 0
        ? `${t(
            ['Category', 'Count'],
            [
              ['BLOCKED (navigation/discovery failure)', String(model.coverageBreakdown.blocked)],
              ['REQUIRES_CONFIGURATION (no stable locator)', String(model.coverageBreakdown.requiresConfiguration)],
              ['NOT_TESTED (deliberate safety boundary)', String(model.coverageBreakdown.notTested)],
              ['Other skipped', String(model.coverageBreakdown.otherSkipped)],
            ],
            'coverage breakdown counts were not populated'
          )}
          ${t(
            ['Test Case ID', 'Scenario', 'Category', 'Reason'],
            model.coverageBreakdown.items.map((item) => [item.testCaseId, item.scenario, item.category, item.reason]),
            'no skipped discovery-generated checks were recorded'
          )}`
        : `${t(
            ['Test Case ID', 'Scenario', 'Category', 'Reason'],
            [],
            'no discovery-generated checks were skipped in this execution'
          )}`
    }
    ${heading('failure-detail')}
    ${t(
      ['Title', 'Spec', 'Project', 'Error', 'Expected', 'Actual', 'Stack', 'Retry', 'Screenshot', 'Trace', 'Video'],
      model.playwright.failureDetails.map((row) => [
        row.title,
        row.specFile,
        row.projectName,
        row.errorMessage || NOT_AVAILABLE,
        row.assertion.expected,
        row.assertion.actual,
        row.firstRepoStackFrame,
        String(row.retryCount),
        row.screenshotPath,
        row.tracePath,
        row.videoPath,
      ]),
      model.playwright.failureDetailsAvailable
        ? 'no failed Playwright executions were present in generated-check failureDetails'
        : 'failureDetails was not present — NOT_AVAILABLE'
    )}

    ${heading('api')}
    <p><strong>${escapeHtml(model.api.terminology)}</strong></p>
    ${t(
      ['Metric', 'Value'],
      model.api.available
        ? [
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
        : [],
      'API results were not available in the current execution data'
    )}
    ${heading('api-requests')}
    ${t(
      ['Test ID', 'Method', 'Endpoint', 'Status Code', 'Response Time (ms)', 'Assertion', 'Result'],
      model.api.requests.map((row) => [
        row.testId,
        row.method,
        row.endpoint,
        row.statusCode,
        String(row.responseTimeMs),
        row.assertion,
        row.result,
      ]),
      'no API request-level rows were present'
    )}

    ${heading('performance')}
    <p><strong>${escapeHtml(model.performance.terminology)}</strong></p>
    <p>${escapeHtml(model.performance.slaNote)}</p>
    ${t(
      ['Metric', 'Value'],
      model.performance.available
        ? [
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
            ['p50 (ms)', String(model.performance.p50Ms)],
            ['p90 (ms)', String(model.performance.p90Ms)],
            ['p95 (ms)', String(model.performance.p95Ms)],
            ['p99 (ms)', String(model.performance.p99Ms)],
            ['TTFB (ms)', String(model.performance.ttfbMs)],
            ['Throughput (per sec)', String(model.performance.throughputPerSec)],
            ['Sample URL', model.performance.sampleUrl],
            ['Run status', model.performance.runStatus],
            ['Threshold status', model.performance.thresholdStatus],
            ['Profile', model.performance.profile],
          ]
        : [],
      'Performance results were not available in the current execution data'
    )}
    ${heading('performance-samples')}
    ${t(
      ['#', 'Thread', 'Label', 'URL', 'Status Code', 'Time (ms)', 'Result'],
      model.performance.samples.map((row) => [
        String(row.index),
        row.thread,
        row.label,
        row.url,
        row.statusCode,
        String(row.elapsedMs),
        row.result,
      ]),
      'no performance sample rows were present'
    )}
    ${heading('lighthouse')}
    <p>Separate from JMeter. Source: ${escapeHtml(model.lighthouse.source)}. Status: ${escapeHtml(model.lighthouse.status)}. ${escapeHtml(model.lighthouse.skipReason)}</p>
    ${t(
      ['Metric', 'Value'],
      model.lighthouse.available
        ? [
            ['Status', model.lighthouse.status],
            ['Skip / not-executed reason', model.lighthouse.skipReason],
            ['Page source', model.lighthouse.pageSource],
            ['Chrome path', model.lighthouse.chromePath],
            ['Lighthouse CLI', model.lighthouse.lighthouseCommand],
            ['Threshold status', model.lighthouse.thresholdStatus],
            ['Threshold note', model.lighthouse.thresholdNote],
          ]
        : [],
      model.lighthouse.missingReason || 'reports/lighthouse/summary.json was not present'
    )}
    ${t(
      ['URL', 'Status', 'LCP (ms)', 'CLS', 'INP (ms)', 'TBT (ms)', 'Perf', 'A11y', 'BP', 'SEO', 'Reason'],
      model.lighthouse.pages.map((row) => [
        row.url,
        row.status,
        row.lcpMs,
        row.cls,
        row.inpMs,
        row.tbtMs,
        row.performanceScore,
        row.accessibilityScore,
        row.bestPracticesScore,
        row.seoScore,
        row.reason,
      ]),
      model.lighthouse.missingReason || 'no Lighthouse page rows were present'
    )}
    ${t(
      ['Metric', 'Limit', 'Actual', 'Status'],
      model.lighthouse.comparisons.map((row) => [row.metric, row.limit, row.actual, row.status]),
      'Lighthouse threshold comparisons were not present (NOT_AVAILABLE — no invented SLAs)'
    )}

    ${heading('artifacts')}
    ${t(
      ['Artifact', 'Location'],
      model.artifacts.map((item) => [item.name, item.location]),
      'no artifact locations were recorded'
    )}

    ${heading('discovery')}
    ${t(
      ['Metric', 'Value'],
      model.discovery.available
        ? [
            ['Seed URL', model.discovery.seedUrl],
            ['Pages discovered (raw crawl rows)', String(model.discovery.pagesDiscoveredRaw)],
            ['Pages discovered (unique after dedupe)', String(model.discovery.pagesDiscoveredUnique)],
            [
              'Pages discovered (reported figure)',
              `${model.discovery.pagesDiscovered} — unique when formula is present; otherwise raw crawl rows`,
            ],
            ['Pages With Errors', String(model.discovery.pagesWithErrors)],
            ['Broken Links', String(model.discovery.brokenLinks)],
            ['Console Errors Observed', String(model.discovery.totalConsoleErrors)],
            ['Crawl Truncated', model.discovery.truncated ? 'Yes' : 'No'],
            ['Crawled At', model.discovery.crawledAt],
            ['Interactive Elements Inventoried', String(model.inventory.totalElements)],
          ]
        : [],
      'No discovery run is associated with this execution'
    )}
    ${heading('elements-by-type')}
    ${t(
      ['Type', 'Count'],
      model.inventory.byType.map((row) => [row.label, String(row.count)]),
      'no inventoried elements were available to group by type'
    )}
    ${heading('elements-by-risk')}
    <p>Risk labels are report-only classifications — see docs/UPGRADE_ROADMAP.md for how they
    relate to the safety policy. No generated check ever submits a form or clicks a destructive
    control regardless of this label.</p>
    ${t(
      ['Risk', 'Count'],
      model.inventory.byRisk.map((row) => [row.label, String(row.count)]),
      'risk labels were not present on the inventory payload after classifyElements plumbing'
    )}
    ${heading('discovered-pages')}
    ${t(
      ['URL', 'Status', 'Title', 'Console Errors', 'Depth'],
      model.discovery.pages.map((page) => [
        page.url,
        page.status,
        page.title,
        String(page.consoleErrors),
        String(page.depth),
      ]),
      'no discovered pages were present'
    )}

    ${heading('seo')}
    ${t(
      ['Metric', 'Value'],
      model.seo.available
        ? [
            ['Pages Analyzed', String(model.seo.pagesAnalyzed)],
            ['Unique findings', String(model.seo.uniqueFindingCount)],
            ['Raw findings (pre-dedupe)', String(model.seo.rawFindingCount)],
            ['High Severity', String(model.seo.high)],
            ['Medium Severity', String(model.seo.medium)],
            ['Low Severity', String(model.seo.low)],
          ]
        : [],
      'No SEO analysis is associated with this execution. reports/seo/results.json was not written; summary.json is used when present.'
    )}
    ${t(
      ['Rule', 'Severity', 'Page', 'Detail'],
      model.seo.findings.map((f) => [f.rule, f.severity, f.page, f.detail]),
      model.seo.available ? 'No SEO findings were raised for the analyzed pages.' : 'SEO findings were not available'
    )}

    ${heading('accessibility')}
    <p>${escapeHtml(model.accessibility.disclaimer || 'Automated axe checks are not a WCAG conformance audit.')}</p>
    <p>Scanned pages: ${escapeHtml(String(model.accessibility.pagesAnalyzed))} / unique pages: ${escapeHtml(String(model.accessibility.uniquePageCount))}. Source: ${escapeHtml(model.accessibility.source)}. Status: ${escapeHtml(model.accessibility.status)}.</p>
    ${t(
      ['Metric', 'Value'],
      model.accessibility.available
        ? [
            ['Suite result', model.accessibility.status],
            ['Pages scanned', String(model.accessibility.pagesAnalyzed)],
            ['Unique pages', String(model.accessibility.uniquePageCount)],
            ['Violations', String(model.accessibility.violationCount)],
            ['Incomplete', String(model.accessibility.incompleteCount)],
            ['Critical', String(model.accessibility.byImpact.critical)],
            ['Serious', String(model.accessibility.byImpact.serious)],
            ['Moderate', String(model.accessibility.byImpact.moderate)],
            ['Minor', String(model.accessibility.byImpact.minor)],
          ]
        : [],
      model.accessibility.missingReason || 'Accessibility artifact was not present'
    )}
    ${t(
      ['Impact', 'Count'],
      Object.entries(model.accessibility.byImpact).map(([impact, count]) => [impact, String(count)]),
      'accessibility impact totals were not present'
    )}
    ${t(
      ['Page', 'Violations'],
      model.accessibility.byPage.map((row) => [row.page, String(row.violations)]),
      'no per-page violation counts were present'
    )}
    ${t(
      ['Axe rule ID', 'Impact', 'WCAG 2.1', 'Selector', 'HTML snippet', 'Node count', 'Help URL', 'Page'],
      model.accessibility.violations.map((row) => [
        row.ruleId,
        row.impact,
        row.wcag,
        row.selector,
        row.html,
        row.nodeCount,
        row.helpUrl,
        row.page,
      ]),
      model.accessibility.missingReason || 'no per-violation axe rows were present'
    )}

    ${heading('security')}
    <p>${escapeHtml(model.security.disclaimer || 'QA-level observation, not a pentest.')}</p>
    <p>Source: ${escapeHtml(model.security.source)}. Status: ${escapeHtml(model.security.status)}.</p>
    ${t(
      ['Page', 'Control', 'Status', 'Observed value'],
      model.security.checklist.map((row) => [row.page, row.control, row.status, row.observed]),
      model.security.missingReason || 'no per-page security control observations were present'
    )}
    ${t(
      ['Rule', 'Severity', 'Status', 'Page', 'Expected', 'Observed'],
      model.security.findings.map((row) => [row.rule, row.severity, row.status, row.page, row.expected, row.actual]),
      model.security.missingReason || 'no security findings were present'
    )}

    ${heading('content')}
    <p>${escapeHtml(model.content.disclaimer || 'Business claims are not fact-checked without an authoritative expected value.')}</p>
    <p>Source: ${escapeHtml(model.content.source)}. Status: ${escapeHtml(model.content.status)}.</p>
    ${t(
      ['Page', 'Rule', 'Status', 'Expected', 'Observed'],
      model.content.findings.map((row) => [row.page, row.rule, row.status, row.expected, row.actual]),
      model.content.missingReason || 'no content QA findings were present'
    )}

    ${heading('visual')}
    <p>Status: ${escapeHtml(model.visual.status)}. Source: ${escapeHtml(model.visual.source)}. ${escapeHtml(model.visual.note || model.visual.missingReason)}</p>
    ${t(
      ['Metric', 'Value'],
      [
        ['Baseline count', String(model.visual.baselineCount)],
        ['Compared count', String(model.visual.comparedCount)],
        ['New-baseline count', String(model.visual.newBaselineCount)],
      ],
      model.visual.missingReason || 'visual metrics were not present'
    )}
    ${t(
      ['Page', 'Diff %', 'Threshold', 'Baseline', 'Actual', 'Diff'],
      model.visual.diffs.map((row) => [
        row.page,
        row.diffPercent,
        row.threshold,
        row.baselinePath,
        row.actualPath,
        row.diffPath,
      ]),
      model.visual.missingReason || 'no per-page visual diffs were present'
    )}

    ${heading('failure-analysis')}
    <p><strong>Classifications are evidence-based and are not defect tickets.</strong></p>
    <p>${escapeHtml(model.failureAnalysis.disclaimer)}</p>
    <p>Status: ${escapeHtml(model.failureAnalysis.status)}. Source: ${escapeHtml(model.failureAnalysis.source)}.</p>
    ${t(
      ['Class', 'Count'],
      Object.entries(model.failureAnalysis.byClass).map(([label, count]) => [label, String(count)]),
      model.failureAnalysis.missingReason || 'failure analysis recorded no class counts'
    )}
    ${t(
      ['Test ID', 'Classification', 'Evidence excerpt', 'Rule fired'],
      model.failureAnalysis.rows.map((row) => [
        row.testId,
        row.classification,
        row.evidenceExcerpt,
        row.ruleFired,
      ]),
      model.failureAnalysis.missingReason || 'no classified failures were present'
    )}

    ${heading('retest')}
    <p>${escapeHtml(model.retest.disclaimer)}</p>
    <p>Status: ${escapeHtml(model.retest.status)}. ${escapeHtml(model.retest.reason)}</p>
    ${t(
      ['Test ID', 'Original status', 'Retest status', 'Run count', 'Stability verdict'],
      model.retest.items.map((row) => [
        row.testId,
        row.originalStatus,
        row.retestStatus,
        String(row.runCount),
        row.stabilityVerdict,
      ]),
      model.retest.missingReason || model.retest.reason || 'no retest items were present'
    )}

    ${heading('layer-3', 'h1')}
    <p>This layer interprets the evidence. It does not invent requirements, defects, or acceptance criteria.</p>
    ${heading('coverage-analysis')}
    <p><strong>${escapeHtml(model.coverage.coverageNote)}</strong></p>
    ${t(
      ['Coverage Dimension', 'Value'],
      [
        ['Unique UI Test Scenarios (Test Cases)', String(model.coverage.uniqueUiScenarios)],
        ['UI Test Executions', String(model.coverage.uiExecutions)],
        ['Browser Coverage', model.coverage.browsers.join(', ') || NOT_AVAILABLE],
        ['API Requests Executed', String(model.coverage.apiRequests)],
        ['Performance Samples', String(model.coverage.performanceSamples)],
        ['Functional Areas Covered', model.coverage.functionalAreas.join('; ') || NOT_AVAILABLE],
        [
          'Pages discovered raw',
          model.coverage.advanced.available ? String(model.coverage.advanced.pagesDiscoveredRaw) : NOT_AVAILABLE,
        ],
        [
          'Pages discovered unique',
          model.coverage.advanced.available ? String(model.coverage.advanced.pagesDiscoveredUnique) : NOT_AVAILABLE,
        ],
        ['Coverage formula', model.coverage.formula?.coverageDefinition ?? NOT_AVAILABLE],
        ['Element coverage', model.coverage.formula
          ? `${model.coverage.formula.figures.elementCoverage.covered}/${model.coverage.formula.figures.elementCoverage.testable} (${model.coverage.formula.figures.elementCoverage.coveragePercent}%)`
          : NOT_AVAILABLE],
        ['Functional-area coverage', model.coverage.formula
          ? `${model.coverage.formula.figures.functionalAreaCoverage.covered}/${model.coverage.formula.figures.functionalAreaCoverage.testable} (${model.coverage.formula.figures.functionalAreaCoverage.coveragePercent}%)`
          : NOT_AVAILABLE],
        ['Exclusions', model.coverage.formula
          ? String(model.coverage.formula.excludedItems.length)
          : NOT_AVAILABLE],
        ['Coverage ≠ pass rate', model.coverage.formula?.warning ?? NOT_AVAILABLE],
      ],
      'coverage dimensions were not populated'
    )}
    ${heading('traceability')}
    <p>${escapeHtml(model.requirementTraceabilityNote)}</p>
    ${heading('defect-summary')}
    <p>${escapeHtml(model.defects.note)}</p>
    ${t(
      ['Severity', 'Count'],
      [
        ['Critical', String(model.defects.critical)],
        ['High', String(model.defects.high)],
        ['Medium', String(model.defects.medium)],
        ['Low', String(model.defects.low)],
      ],
      'defect severity counts were not populated'
    )}
    ${heading('distribution')}
    <div class="bar">
      <div class="p" style="width:${passedPct}%"></div>
      <div class="f" style="width:${failedPct}%"></div>
      <div class="s" style="width:${skippedPct}%"></div>
    </div>
    ${t(
      ['Status', 'Count', 'Percentage'],
      [
        ['Passed', String(model.distribution.passed), `${passedPct.toFixed(1)}%`],
        ['Failed', String(model.distribution.failed), `${failedPct.toFixed(1)}%`],
        ['Skipped', String(model.distribution.skipped), `${skippedPct.toFixed(1)}%`],
      ],
      'distribution rows were not populated'
    )}
    ${heading('analytical-findings')}
    ${bulletsResolved(model.qaAnalysis)}
    ${heading('quality-checks')}
    ${t(
      ['Check', 'Result', 'Detail'],
      model.qualityCheckRows.map((row) => [row.id, row.result, row.detail]),
      'quality checks were not evaluated'
    )}
    ${t(
      ['Type', 'Severity', 'URL', 'Healthy suites', 'Broken suites', 'Detail'],
      model.crossSuite.findings.map((row) => [
        row.type,
        row.severity,
        row.url,
        row.healthySuites,
        row.brokenSuites,
        row.detail,
      ]),
      model.crossSuite.missingReason
    )}
    ${heading('analysis-conclusion')}
    ${model.conclusion.map((textLine) => `<p>${line(textLine)}</p>`).join('')}
    ${heading('trend')}
    <p>${escapeHtml(model.trend.note)}</p>
    ${t(
      ['Metric', 'Current', 'Previous', 'Delta'],
      model.trend.rows.map((row) => [row.metric, row.current, row.previous, row.delta]),
      'no trend KPIs were persisted'
    )}

    ${heading('layer-4', 'h1')}
    <p>A high automated pass rate does not mean the full application is defect-free. The following limitations are supported by the available execution scope.</p>
    ${bulletsResolved(model.risks)}

    ${heading('layer-5', 'h1')}
    ${heading('entry-exit-criteria')}
    ${t(
      ['Kind', 'Definition'],
      [
        ...model.criteria.entry.map((row) => ['Entry', row]),
        ...model.criteria.exit.map((row) => ['Exit', row]),
        ...Object.entries(model.criteria.severity).map(([key, value]) => [`Severity ${key}`, value]),
        ['Release-blocking threshold', model.criteria.releaseBlocking.join(', ') || NOT_AVAILABLE],
      ],
      'entry/exit criteria were not present in qa.config.json'
    )}
    ${heading('release-verdict')}
    <div class="status-banner ${statusClass(model.releaseRecommendation.status)}">QA Status: ${escapeHtml(model.releaseRecommendation.status)}</div>
    <p><strong>Release Decision:</strong> ${escapeHtml(model.releaseRecommendation.decision)}</p>
    <p>${escapeHtml(model.releaseRecommendation.summary)}</p>
    ${t(
      ['Exit criterion', 'Result', 'Detail'],
      model.criteriaEvaluation.map((row) => [row.criterion, row.result, row.detail]),
      'no exit-criterion evaluation rows were produced'
    )}
    ${bulletsResolved(model.releaseRecommendation.bullets)}
    <p><em>This recommendation is evidence-based and scoped. It must be read together with Layers 2–4 and must not be interpreted as an unrestricted production-readiness certificate.</em></p>

    <footer class="report-footer">
      Version ${escapeHtml(model.meta.reportVersion)} |
      Generated ${escapeHtml(model.meta.generatedAt)} |
      Timezone ${escapeHtml(model.meta.timezone)} |
      ${escapeHtml(model.meta.preparedBy)} |
      ${escapeHtml(model.meta.reviewedBy)}
    </footer>
  </div>
</body>
</html>`;
}

export function writeEnterpriseHtml(
  model: EnterpriseReportModel,
  outputPath: string,
  registry: SectionRegistry = new SectionRegistry(),
  audit: TableAudit = new TableAudit()
): string {
  const html = generateEnterpriseHtml(model, registry, audit);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');
  return outputPath;
}
