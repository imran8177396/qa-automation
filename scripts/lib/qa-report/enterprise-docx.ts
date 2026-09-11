import fs from 'fs';
import path from 'path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from 'docx';
import type { EnterpriseReportModel } from './enterprise-model';
import { sanitizeDocxText } from '../../../npm-docs/sanitize-text';
import { SectionRegistry, resolveRefTokens } from './section-manifest';
import { TableAudit, prepareTableRows } from './empty-table';
import { NOT_AVAILABLE } from '../suite-origin';

const COLORS = {
  navy: '1F3864',
  slate: '334155',
  muted: '64748B',
  border: 'CBD5E1',
  headerBg: 'E8EEF7',
  pass: '166534',
  fail: '991B1B',
  conditional: '92400E',
  white: 'FFFFFF',
};

function t(text: string): string {
  return sanitizeDocxText(text);
}

function p(
  text: string,
  options: {
    bold?: boolean;
    size?: number;
    color?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spacingAfter?: number;
    spacingBefore?: number;
  } = {}
): Paragraph {
  return new Paragraph({
    alignment: options.align,
    spacing: {
      after: options.spacingAfter ?? 120,
      before: options.spacingBefore ?? 0,
      line: 276,
    },
    children: [
      new TextRun({
        text: t(text),
        bold: options.bold,
        size: options.size ?? 20,
        color: options.color ?? COLORS.slate,
        font: 'Calibri',
      }),
    ],
  });
}

function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 280, after: 160 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 12, color: COLORS.navy, space: 4 },
    },
    children: [
      new TextRun({
        text: t(text),
        bold: true,
        color: COLORS.navy,
        size: 28,
        font: 'Calibri',
      }),
    ],
  });
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 120 },
    children: [
      new TextRun({
        text: t(text),
        bold: true,
        color: COLORS.navy,
        size: 24,
        font: 'Calibri',
      }),
    ],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [
      new TextRun({
        text: t(text),
        size: 20,
        color: COLORS.slate,
        font: 'Calibri',
      }),
    ],
  });
}

function statusColor(status: string): string {
  const upper = status.toUpperCase();
  if (upper.includes('CONDITIONAL')) return COLORS.conditional;
  if (upper.includes('BLOCKED') || upper.includes('REQUIRES_CONFIGURATION')) return COLORS.conditional;
  if (upper.includes('PASS') && !upper.includes('FAIL')) return COLORS.pass;
  if (upper.includes('FAIL')) return COLORS.fail;
  return COLORS.slate;
}

function cell(
  text: string,
  options: { bold?: boolean; fill?: string; color?: string; width?: number } = {}
): TableCell {
  return new TableCell({
    width: { size: options.width ?? 2000, type: WidthType.DXA },
    shading: options.fill ? { fill: options.fill } : undefined,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
    },
    children: [
      new Paragraph({
        spacing: { after: 40, before: 40 },
        children: [
          new TextRun({
            text: t(text),
            bold: options.bold,
            size: 18,
            color: options.color ?? COLORS.slate,
            font: 'Calibri',
          }),
        ],
      }),
    ],
  });
}

function table(
  headers: string[],
  rows: string[][],
  colWidth = 1800,
  audit?: TableAudit,
  emptyReason = 'no rows were available for this table'
): Table {
  const widths = headers.map(() => colWidth);
  const prepared = audit
    ? prepareTableRows(headers, rows, audit, emptyReason)
    : { rows: rows.length > 0 ? rows : [[`${NOT_AVAILABLE} — ${emptyReason}`]], placeholder: rows.length ? null : { cells: [`${NOT_AVAILABLE} — ${emptyReason}`], reason: emptyReason, colSpan: headers.length } };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    rows: [
      new TableRow({
        children: headers.map((header, index) =>
          cell(header, { bold: true, fill: COLORS.headerBg, color: COLORS.navy, width: widths[index] })
        ),
      }),
      ...prepared.rows.map(
        (row) =>
          new TableRow({
            children: prepared.placeholder
              ? [
                  new TableCell({
                    columnSpan: headers.length,
                    width: { size: widths[0], type: WidthType.DXA },
                    borders: {
                      top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
                      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
                      left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
                      right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
                    },
                    children: [
                      new Paragraph({
                        spacing: { after: 40, before: 40 },
                        children: [
                          new TextRun({
                            text: t(prepared.placeholder.cells[0] ?? ''),
                            size: 18,
                            color: COLORS.slate,
                            font: 'Calibri',
                          }),
                        ],
                      }),
                    ],
                  }),
                ]
              : row.map((value, index) => {
                  const isStatusCol =
                    headers[index]?.toLowerCase().includes('status') ||
                    headers[index]?.toLowerCase().includes('result');
                  return cell(value, {
                    width: widths[index],
                    color: isStatusCol ? statusColor(value) : COLORS.slate,
                    bold: isStatusCol,
                  });
                }),
          })
      ),
    ],
  });
}

function spacer(): Paragraph {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [], pageBreakBefore: true });
}

function kpiTable(model: EnterpriseReportModel): Table {
  const items: Array<[string, string]> = [
    ['Total UI Executions', String(model.kpi.totalUiExecutions)],
    ['Passed', String(model.kpi.passed)],
    ['Failed', String(model.kpi.failed)],
    ['Skipped', String(model.kpi.skipped)],
    ['UI execution pass rate', model.passRates.uiFormatted],
    ['Assertion pass rate', model.passRates.assertionFormatted],
    ['Unique UI Scenarios', String(model.kpi.uniqueUiScenarios)],
    ['Browser Coverage', model.kpi.browserCoverage],
    ['API Requests', String(model.kpi.apiRequests)],
    ['Performance Samples', String(model.kpi.performanceSamples)],
    ['Defects Recorded', String(model.kpi.defects)],
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: Array.from({ length: Math.ceil(items.length / 2) }, (_, rowIndex) => {
      const left = items[rowIndex * 2];
      const right = items[rowIndex * 2 + 1];
      return new TableRow({
        children: [
          cell(left[0], { bold: true, fill: COLORS.headerBg, width: 2600 }),
          cell(left[1], { width: 2600, bold: true, color: statusColor(left[1]) }),
          cell(right?.[0] ?? '', { bold: true, fill: COLORS.headerBg, width: 2600 }),
          cell(right?.[1] ?? '', { width: 2600, bold: true, color: right ? statusColor(right[1]) : COLORS.slate }),
        ],
      });
    }),
  });
}

function kvTable(rows: Array<{ label: string; value: string }>): Table {
  return table(
    ['Field', 'Value'],
    rows.map((row) => [row.label, row.value]),
    4500
  );
}

export async function generateEnterpriseDocx(
  model: EnterpriseReportModel,
  outputPath: string,
  registry: SectionRegistry = new SectionRegistry(),
  audit: TableAudit = new TableAudit()
): Promise<string> {
  const h = (id: string) => h2(registry.emit(id));
  const H = (id: string) => h1(registry.emit(id));
  const text = (value: string) => resolveRefTokens(value, registry);
  const tbl = (headers: string[], rows: string[][], colWidth = 1800, emptyReason = 'no rows were available for this table') =>
    table(headers, rows, colWidth, audit, emptyReason);
  const children: Array<Paragraph | Table> = [];

  // Cover
  children.push(
    new Paragraph({ spacing: { before: 1200 }, children: [] }),
    p(model.meta.reportTitle, {
      bold: true,
      size: 40,
      color: COLORS.navy,
      align: AlignmentType.CENTER,
      spacingAfter: 200,
    }),
    p(model.meta.projectName, {
      bold: true,
      size: 28,
      color: COLORS.slate,
      align: AlignmentType.CENTER,
      spacingAfter: 400,
    }),
    spacer(),
    table(
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
      4500
    ),
    spacer(),
    p(
      'This document is a professional QA Test Execution / Test Summary Report generated from automation execution artifacts. It preserves original test results without modification.',
      { align: AlignmentType.CENTER, size: 18, color: COLORS.muted, spacingBefore: 400 }
    ),
    pageBreak()
  );

  // Five-layer map
  children.push(
    h1('Report Structure — Five QA Layers'),
    p(
      'This report is organized into five professional QA layers for stakeholders, management, and delivery teams.'
    ),
    table(
      ['Layer', 'Title', 'Purpose'],
      model.layers.map((layer) => [layer.id, layer.title, layer.purpose]),
      3000
    ),
    pageBreak()
  );

  // ===================== LAYER 1 =====================
  children.push(H('layer-1'));
  if (model.meta.pendingReview) {
    children.push(p('PENDING REVIEW — reviewer name is unset. This report is not approved.', { bold: true, color: COLORS.conditional, size: 24 }));
  }
  for (const line of model.executiveSummary) {
    children.push(p(text(line)));
  }
  children.push(
    tbl(
      ['Passed stages', 'Failed stages', 'Not-executed stages'],
      [
        [
          model.suiteGroups.passed.join(', ') || 'none',
          model.suiteGroups.failed.join(', ') || 'none',
          model.suiteGroups.notExecuted.join(', ') || 'none',
        ],
      ],
      2400,
      'orchestrator stage groups were not present'
    )
  );
  children.push(h2('1.1 KPI Dashboard'), kpiTable(model), spacer());
  children.push(
    p(`Overall QA Status: ${model.meta.overallStatus}`, {
      bold: true,
      color: statusColor(model.meta.overallStatus),
      size: 24,
    }),
    p(`Release Decision Preview: ${model.releaseRecommendation.decision}`, {
      bold: true,
      size: 20,
    }),
    pageBreak()
  );

  // ===================== LAYER 2 =====================
  children.push(
    H('layer-2'),
    p(
      'This layer presents factual execution evidence only. Values are taken from automation artifacts without alteration.'
    ),
    h2('2.1 Project & Test Information'),
    kvTable(model.projectInfo)
  );

  children.push(h2('2.2 Test Scope — In Scope'));
  for (const item of model.inScope) children.push(bullet(item));
  children.push(h2('2.3 Test Scope — Out of Scope'));
  for (const item of model.outOfScope) children.push(bullet(item));

  children.push(
    h2('2.4 Testing Types Executed'),
    table(
      ['Testing Type', 'Tool', 'Coverage', 'Result'],
      model.testingTypes.map((row) => [row.type, row.tool, row.coverage, row.result]),
      2400
    ),
    h2('2.5 Test Environment'),
    kvTable(model.environment)
  );

  children.push(h2('2.5.1 Full Pipeline Stage Results (qa:all)'));
  if (model.stageTimeline.available) {
    children.push(
      p(`Command: ${model.pipeline.command}  |  URL: ${model.pipeline.url}  |  Overall: ${model.pipeline.overallStatus}`, {
        bold: true,
      }),
      p(model.pipeline.evidenceIntegrityNote),
      tbl(
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
        1400,
        'stage timeline rows were empty'
      )
    );
  } else {
    children.push(
      tbl(
        ['#', 'Stage', 'Status', 'Started', 'Completed', 'Duration (ms)', 'Reason'],
        [],
        1400,
        model.pipeline.available
          ? 'orchestrator summary existed but no timestamped timeline rows were present'
          : 'reports/orchestrator/stages.md and timeline.json were not present'
      )
    );
  }

  children.push(
    h2('2.6 Playwright — UI / E2E Evidence'),
    p(`Source: ${model.playwright.sourceFile}. Available: ${model.playwright.available ? 'yes' : 'NOT_AVAILABLE'}. Origin: ${model.playwright.originStatus} (expected ${model.playwright.configuredBaseUrl}, actual ${model.playwright.targetOrigin}).`),
    p(model.pipeline.evidenceIntegrityNote),
    p(model.playwright.engineCaveats.join(' ')),
    h2('2.6.1 Execution Summary'),
    table(
      ['Metric', 'Value'],
      [
        ['Total Executions', String(model.playwright.total)],
        ['Passed', String(model.playwright.passed)],
        ['Failed', String(model.playwright.failed)],
        ['Skipped', String(model.playwright.skipped)],
        ['Pass Rate', model.playwright.passRate],
        ['Total Duration (ms)', String(model.playwright.durationMs)],
      ],
      4500
    ),
    h2('2.6.2 Browser Summary'),
    p(model.playwright.engineCaveats.join(' ')),
    tbl(
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
      1300,
      model.playwright.available
        ? 'browsers[] was not present on reports/playwright/generated-check/summary.json'
        : 'generated-check results.json was not present — section 2.6 is NOT_AVAILABLE'
    ),
    h2('2.6.3 Detailed Test Executions'),
    table(
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
      1300
    )
  );

  children.push(
    h2('2.6.4 Discovery-Generated Check Coverage Breakdown'),
    p(
      'Checks the discovery engine could not run to a PLANNED conclusion are never silently omitted — they appear above as SKIPPED with one of the reasons below, distinguishing an intentional safety boundary from an actual gap.'
    )
  );
  if (model.coverageBreakdown.items.length > 0) {
    children.push(
      table(
        ['Category', 'Count'],
        [
          ['BLOCKED (navigation/discovery failure)', String(model.coverageBreakdown.blocked)],
          ['REQUIRES_CONFIGURATION (no stable locator)', String(model.coverageBreakdown.requiresConfiguration)],
          ['NOT_TESTED (deliberate safety boundary)', String(model.coverageBreakdown.notTested)],
          ['Other skipped', String(model.coverageBreakdown.otherSkipped)],
        ],
        3000
      ),
      table(
        ['Test Case ID', 'Scenario', 'Category', 'Reason'],
        model.coverageBreakdown.items.map((item) => [item.testCaseId, item.scenario, item.category, item.reason]),
        1600
      )
    );
  } else {
    children.push(p('No discovery-generated checks were skipped in this execution.'));
  }

  children.push(
    h('failure-detail'),
    tbl(
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
      900,
      model.playwright.failureDetailsAvailable
        ? 'no failed Playwright executions were present in generated-check failureDetails'
        : 'failureDetails was not present — NOT_AVAILABLE'
    )
  );

  children.push(h2('2.7 API Smoke Test Evidence'), p(model.api.terminology, { bold: true }));
  if (model.api.available) {
    children.push(
      table(
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
        ],
        4500
      ),
      h2('2.7.1 Request-Level Results'),
      table(
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
        1300
      )
    );
  } else {
    children.push(p('API results were not available in the current execution data.'));
  }

  children.push(
    h2('2.8 Performance Validation Evidence'),
    p(model.performance.terminology, { bold: true }),
    p(model.performance.slaNote)
  );
  if (model.performance.available) {
    children.push(
      table(
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
        ],
        4500
      ),
      h2('2.8.1 Sample Results'),
      table(
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
        1300
      )
    );
  } else {
    children.push(p('Performance results were not available in the current execution data.'));
  }

  children.push(
    h('lighthouse'),
    p(`Separate from JMeter. Source: ${model.lighthouse.source}. Status: ${model.lighthouse.status}. ${model.lighthouse.skipReason}`),
    tbl(
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
      4500,
      model.lighthouse.missingReason || 'reports/lighthouse/summary.json was not present'
    ),
    tbl(
      ['URL', 'Status', 'LCP (ms)', 'CLS', 'INP (ms)', 'TBT (ms)', 'Perf', 'A11y', 'BP', 'SEO'],
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
      ]),
      1200,
      model.lighthouse.missingReason || 'no Lighthouse page rows were present'
    )
  );

  children.push(
    h2('2.9 Test Artifacts'),
    table(
      ['Artifact', 'Location'],
      model.artifacts.map((item) => [item.name, item.location]),
      4500
    )
  );

  children.push(h2('2.10 Discovery & Element Inventory Evidence'));
  if (model.discovery.available) {
    children.push(
      table(
        ['Metric', 'Value'],
        [
          ['Seed URL', model.discovery.seedUrl],
          ['Pages discovered (raw crawl rows)', String(model.discovery.pagesDiscoveredRaw)],
          ['Pages discovered (unique after dedupe)', String(model.discovery.pagesDiscoveredUnique)],
          ['Pages discovered (reported figure)', String(model.discovery.pagesDiscovered)],
          ['Pages With Errors', String(model.discovery.pagesWithErrors)],
          ['Broken Links', String(model.discovery.brokenLinks)],
          ['Console Errors Observed', String(model.discovery.totalConsoleErrors)],
          ['Crawl Truncated', model.discovery.truncated ? 'Yes' : 'No'],
          ['Crawled At', model.discovery.crawledAt],
          ['Interactive Elements Inventoried', String(model.inventory.totalElements)],
        ],
        4500
      ),
      h2('2.10.1 Elements by Type'),
      table(
        ['Type', 'Count'],
        model.inventory.byType.map((row) => [row.label, String(row.count)]),
        3000
      ),
      h2('2.10.2 Elements by Risk Label'),
      p(
        'Risk labels are report-only classifications — see docs/UPGRADE_ROADMAP.md for how they relate to the safety policy. No generated check ever submits a form or clicks a destructive control regardless of this label.'
      ),
      table(
        ['Risk', 'Count'],
        model.inventory.byRisk.map((row) => [row.label, String(row.count)]),
        3000
      ),
      h2('2.10.3 Discovered Pages'),
      table(
        ['URL', 'Status', 'Title', 'Console Errors', 'Depth'],
        model.discovery.pages.map((page) => [
          page.url,
          page.status,
          page.title,
          String(page.consoleErrors),
          String(page.depth),
        ]),
        1800
      )
    );
  } else {
    children.push(
      p(
        'No discovery run is associated with this execution — this report reflects the config-driven pipeline only. Run "npm run qa:test -- <url>" to add discovery evidence.'
      )
    );
  }

  children.push(h2('2.11 SEO Analysis'));
  if (model.seo.available) {
    children.push(
      table(
        ['Metric', 'Value'],
        [
          ['Pages Analyzed', String(model.seo.pagesAnalyzed)],
          ['Findings', String(model.seo.uniqueFindingCount)],
          ['High Severity', String(model.seo.high)],
          ['Medium Severity', String(model.seo.medium)],
          ['Low Severity', String(model.seo.low)],
        ],
        3000
      )
    );
    if (model.seo.findings.length > 0) {
      children.push(
        table(
          ['Rule', 'Severity', 'Page', 'Detail'],
          model.seo.findings.map((f) => [f.rule, f.severity, f.page, f.detail]),
          1600
        )
      );
    } else {
      children.push(p('No SEO findings were raised for the analyzed pages.'));
    }
  } else {
    children.push(
      p('No SEO analysis is associated with this execution. Run "npm run qa:test -- <url>" to add SEO evidence.')
    );
  }

  children.push(
    h('accessibility'),
    p(model.accessibility.disclaimer || 'Automated axe checks are not a WCAG conformance audit.'),
    p(
      `Scanned pages: ${model.accessibility.pagesAnalyzed} / unique pages: ${model.accessibility.uniquePageCount}. Source: ${model.accessibility.source}. Status: ${model.accessibility.status}.`
    ),
    tbl(
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
      1200,
      model.accessibility.missingReason || 'no per-violation axe rows were present'
    ),
    h('security'),
    p(model.security.disclaimer || 'QA-level observation, not a pentest.'),
    tbl(
      ['Page', 'Control', 'Status', 'Observed value'],
      model.security.checklist.map((row) => [row.page, row.control, row.status, row.observed]),
      1800,
      model.security.missingReason || 'no per-page security control observations were present'
    ),
    h('content'),
    p(model.content.disclaimer || 'Business claims are not fact-checked without an authoritative expected value.'),
    tbl(
      ['Page', 'Rule', 'Status', 'Expected', 'Observed'],
      model.content.findings.map((row) => [row.page, row.rule, row.status, row.expected, row.actual]),
      1600,
      model.content.missingReason || 'no content QA findings were present'
    ),
    h('visual'),
    p(`Status: ${model.visual.status}. ${model.visual.note || model.visual.missingReason}`),
    tbl(
      ['Metric', 'Value'],
      [
        ['Baseline count', String(model.visual.baselineCount)],
        ['Compared count', String(model.visual.comparedCount)],
        ['New-baseline count', String(model.visual.newBaselineCount)],
      ],
      3000,
      model.visual.missingReason || 'visual metrics were not present'
    ),
    tbl(
      ['Page', 'Diff %', 'Threshold', 'Baseline', 'Actual', 'Diff'],
      model.visual.diffs.map((row) => [
        row.page,
        row.diffPercent,
        row.threshold,
        row.baselinePath,
        row.actualPath,
        row.diffPath,
      ]),
      1400,
      model.visual.missingReason || 'no per-page visual diffs were present'
    ),
    h('failure-analysis'),
    p('Classifications are evidence-based and are not defect tickets.', { bold: true }),
    p(model.failureAnalysis.disclaimer),
    p(`Status: ${model.failureAnalysis.status}. Source: ${model.failureAnalysis.source}.`),
    tbl(
      ['Class', 'Count'],
      Object.entries(model.failureAnalysis.byClass).map(([label, count]) => [label, String(count)]),
      3000,
      model.failureAnalysis.missingReason || 'failure analysis recorded no class counts'
    ),
    tbl(
      ['Test ID', 'Classification', 'Evidence excerpt', 'Rule fired'],
      model.failureAnalysis.rows.map((row) => [
        row.testId,
        row.classification,
        row.evidenceExcerpt,
        row.ruleFired,
      ]),
      1400,
      model.failureAnalysis.missingReason || 'no classified failures were present'
    ),
    h('retest'),
    p(model.retest.disclaimer),
    p(`Status: ${model.retest.status}. ${model.retest.reason}`),
    tbl(
      ['Test ID', 'Original status', 'Retest status', 'Run count', 'Stability verdict'],
      model.retest.items.map((row) => [
        row.testId,
        row.originalStatus,
        row.retestStatus,
        String(row.runCount),
        row.stabilityVerdict,
      ]),
      1600,
      model.retest.missingReason || model.retest.reason || 'no retest items were present'
    )
  );

  children.push(pageBreak());

  // ===================== LAYER 3 =====================
  if (false) {
  children.push(h2('legacy-removed'));
  if (model.security.available) {
    children.push(
      p(model.security.disclaimer || 'QA-level header and exposure checks only. Not a penetration test.'),
      table(
        ['Metric', 'Value'],
        [
          ['Suite result', model.security.suitePassed ? 'PASS' : 'FAIL'],
          ['Pages analyzed', String(model.security.pagesAnalyzed)],
          ['Failures', String(model.security.failCount)],
          ['Passes', String(model.security.passCount)],
          ['High', String(model.security.bySeverity.high)],
          ['Medium', String(model.security.bySeverity.medium)],
          ['Low', String(model.security.bySeverity.low)],
        ],
        3000
      )
    );
    if (model.security.findings.length > 0) {
      children.push(
        table(
          ['Rule', 'Severity', 'Status', 'Page', 'Detail'],
          model.security.findings.map((row) => [row.rule, row.severity, row.status, row.page, row.actual || row.expected]),
          1500
        )
      );
    }
  } else {
    children.push(p('Security suite summary was not available for this execution.'));
  }

  children.push(h2('2.14 Content QA Evidence'));
  if (model.content.available) {
    children.push(
      p(model.content.disclaimer || 'Structural content QA only. Marketing claims were not fact-checked.'),
      table(
        ['Metric', 'Value'],
        [
          ['Suite result', model.content.suitePassed ? 'PASS' : 'FAIL'],
          ['Pages analyzed', String(model.content.pagesAnalyzed)],
          ['Failures', String(model.content.failCount)],
          ['Passes', String(model.content.passCount)],
          ['High', String(model.content.bySeverity.high)],
          ['Medium', String(model.content.bySeverity.medium)],
          ['Low', String(model.content.bySeverity.low)],
        ],
        3000
      )
    );
    if (model.content.findings.length > 0) {
      children.push(
        table(
          ['Rule', 'Severity', 'Page', 'Expected', 'Actual'],
          model.content.findings.map((row) => [row.rule, row.severity, row.page, row.expected, row.actual]),
          1500
        )
      );
    }
  } else {
    children.push(p('Content QA summary was not available for this execution.'));
  }

  children.push(h2('legacy-failure-analysis'));
  children.push(h2('legacy-coverage'));
  if (model.coverage.advanced.available) {
    children.push(
      p(model.coverage.coverageNote, { bold: true }),
      table(
        ['Metric', 'Value'],
        [
          ['Testable items', String(model.coverage.advanced.testable)],
          ['Covered (TESTED + FAILED)', String(model.coverage.advanced.covered)],
          ['Uncovered', String(model.coverage.advanced.uncovered)],
          ['Item coverage', `${model.coverage.advanced.itemCoveragePercent}%`],
          [
            'Pass rate (not coverage)',
            model.coverage.advanced.passRatePercent == null
              ? 'n/a'
              : `${model.coverage.advanced.passRatePercent}%`,
          ],
        ],
        3000
      ),
      table(
        ['Dimension', 'Discovered', 'Testable', 'Covered', 'Uncovered', 'Coverage %'],
        model.coverage.advanced.dimensions.map((row) => [
          row.label,
          String(row.discovered),
          String(row.testable),
          String(row.covered),
          String(row.uncovered),
          `${row.coveragePercent}%`,
        ]),
        1400
      ),
      p(
        'Uncovered and non-TESTED items are listed in docs/uncovered-test-items.md. They are not omitted from the coverage record.'
      )
    );
  } else {
    children.push(p(model.coverage.coverageNote));
  }

  } // end unused legacy block

  children.push(pageBreak());

  // ===================== LAYER 3 =====================
  children.push(
    H('layer-3'),
    p(
      'This layer interprets the evidence. It does not invent requirements, defects, or acceptance criteria.'
    ),
    h('coverage-analysis'),
    p(model.coverage.coverageNote, { bold: true }),
    table(
      ['Coverage Dimension', 'Value'],
      [
        ['Unique UI Test Scenarios (Test Cases)', String(model.coverage.uniqueUiScenarios)],
        ['UI Test Executions', String(model.coverage.uiExecutions)],
        ['Browser Coverage', model.coverage.browsers.join(', ') || 'Not Provided'],
        ['API Requests Executed', String(model.coverage.apiRequests)],
        ['Performance Samples', String(model.coverage.performanceSamples)],
        ['Functional Areas Covered', model.coverage.functionalAreas.join('; ') || NOT_AVAILABLE],
        ['Pages discovered raw', String(model.coverage.advanced.pagesDiscoveredRaw)],
        ['Pages discovered unique', String(model.coverage.advanced.pagesDiscoveredUnique)],
        ['Coverage formula', model.coverage.formula?.coverageDefinition ?? NOT_AVAILABLE],
        [
          'Element coverage',
          model.coverage.formula
            ? `${model.coverage.formula.figures.elementCoverage.covered}/${model.coverage.formula.figures.elementCoverage.testable} (${model.coverage.formula.figures.elementCoverage.coveragePercent}%)`
            : NOT_AVAILABLE,
        ],
        [
          'Functional-area coverage',
          model.coverage.formula
            ? `${model.coverage.formula.figures.functionalAreaCoverage.covered}/${model.coverage.formula.figures.functionalAreaCoverage.testable} (${model.coverage.formula.figures.functionalAreaCoverage.coveragePercent}%)`
            : NOT_AVAILABLE,
        ],
        ['Coverage ≠ pass rate', model.coverage.formula?.warning ?? NOT_AVAILABLE],
      ],
      4500
    ),
    h('traceability'),
    p(model.requirementTraceabilityNote),
    h('defect-summary'),
    p(model.defects.note),
    table(
      ['Severity', 'Count'],
      [
        ['Critical', String(model.defects.critical)],
        ['High', String(model.defects.high)],
        ['Medium', String(model.defects.medium)],
        ['Low', String(model.defects.low)],
      ],
      4500
    ),
    h('distribution'),
    table(
      ['Status', 'Count', 'Percentage'],
      [
        [
          'Passed',
          String(model.distribution.passed),
          model.kpi.totalUiExecutions
            ? `${((model.distribution.passed / model.kpi.totalUiExecutions) * 100).toFixed(1)}%`
            : '0%',
        ],
        [
          'Failed',
          String(model.distribution.failed),
          model.kpi.totalUiExecutions
            ? `${((model.distribution.failed / model.kpi.totalUiExecutions) * 100).toFixed(1)}%`
            : '0%',
        ],
        [
          'Skipped',
          String(model.distribution.skipped),
          model.kpi.totalUiExecutions
            ? `${((model.distribution.skipped / model.kpi.totalUiExecutions) * 100).toFixed(1)}%`
            : '0%',
        ],
      ],
      3000
    ),
    h('analytical-findings')
  );
  for (const item of model.qaAnalysis) children.push(bullet(item));

  children.push(
    h('quality-checks'),
    tbl(
      ['Check', 'Result', 'Detail'],
      model.qualityCheckRows.map((row) => [row.id, row.result, row.detail]),
      2000,
      'quality checks were not evaluated'
    ),
    tbl(
      ['Type', 'Severity', 'URL', 'Healthy suites', 'Broken suites', 'Detail'],
      model.crossSuite.findings.map((row) => [
        row.type,
        row.severity,
        row.url,
        row.healthySuites,
        row.brokenSuites,
        row.detail,
      ]),
      1400,
      model.crossSuite.missingReason
    )
  );

  children.push(h('analysis-conclusion'));
  for (const line of model.conclusion) children.push(p(line));
  children.push(h('trend'), p(model.trend.note), tbl(
    ['Metric', 'Current', 'Previous', 'Delta'],
    model.trend.rows.map((row) => [row.metric, row.current, row.previous, row.delta]),
    2000,
    'no trend KPIs were persisted'
  ));
  children.push(pageBreak());

  // ===================== LAYER 4 =====================
  children.push(
    H('layer-4'),
    p(
      'A high automated pass rate does not mean the full application is defect-free. The following limitations are supported by the available execution scope.'
    )
  );
  for (const risk of model.risks) children.push(bullet(text(risk)));
  children.push(pageBreak());

  // ===================== LAYER 5 =====================
  children.push(
    H('layer-5'),
    h('entry-exit-criteria'),
    tbl(
      ['Kind', 'Definition'],
      [
        ...model.criteria.entry.map((row) => ['Entry', row]),
        ...model.criteria.exit.map((row) => ['Exit', row]),
        ...Object.entries(model.criteria.severity).map(([key, value]) => [`Severity ${key}`, value]),
        ['Release-blocking threshold', model.criteria.releaseBlocking.join(', ') || NOT_AVAILABLE],
      ],
      4500,
      'entry/exit criteria were not present in qa.config.json'
    ),
    h('release-verdict'),
    tbl(
      ['Exit criterion', 'Result', 'Detail'],
      model.criteriaEvaluation.map((row) => [row.criterion, row.result, row.detail]),
      3000,
      'no exit-criterion evaluation rows were produced'
    ),
    p(`QA Status: ${model.releaseRecommendation.status}`, {
      bold: true,
      color: statusColor(model.releaseRecommendation.status),
      size: 24,
    }),
    p(`Release Decision: ${model.releaseRecommendation.decision}`, {
      bold: true,
      size: 22,
    }),
    p(model.releaseRecommendation.summary)
  );
  for (const item of model.releaseRecommendation.bullets) children.push(bullet(item));
  children.push(
    spacer(),
    p(
      'This recommendation is evidence-based and scoped. It must be read together with Layers 2–4 and must not be interpreted as an unrestricted production-readiness certificate.',
      { color: COLORS.muted, size: 18 }
    )
  );

  const doc = new Document({
    creator: model.meta.preparedBy,
    title: `${model.meta.reportTitle} — ${model.meta.projectName}`,
    description: 'Enterprise QA Test Execution Report',
    compatibility: { version: 15 },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.8),
              right: convertInchesToTwip(0.75),
              bottom: convertInchesToTwip(0.8),
              left: convertInchesToTwip(0.75),
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: t(`${model.meta.reportTitle} | ${model.meta.projectName}`),
                    italics: true,
                    size: 16,
                    color: COLORS.muted,
                    font: 'Calibri',
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: t(
                      `Version ${model.meta.reportVersion} | Generated ${model.meta.generatedAt.slice(0, 19)} | Page `
                    ),
                    size: 16,
                    color: COLORS.muted,
                    font: 'Calibri',
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: COLORS.muted,
                    font: 'Calibri',
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, outputPath);
  return outputPath;
}
