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

const COLORS = {
  navy: '1F3864',
  slate: '334155',
  muted: '64748B',
  border: 'CBD5E1',
  headerBg: 'E8EEF7',
  pass: '166534',
  fail: '991B1B',
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

function table(headers: string[], rows: string[][], colWidth = 1800): Table {
  const widths = headers.map(() => colWidth);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    rows: [
      new TableRow({
        children: headers.map((header, index) =>
          cell(header, { bold: true, fill: COLORS.headerBg, color: COLORS.navy, width: widths[index] })
        ),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: row.map((value, index) => {
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
    ['Pass Rate', model.kpi.passRate],
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
  outputPath: string
): Promise<string> {
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
        ['Prepared By', model.meta.preparedBy],
        ['Reviewed By', model.meta.reviewedBy],
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
  children.push(h1('LAYER 1 — Executive Summary'));
  for (const line of model.executiveSummary) {
    children.push(p(line));
  }
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
    h1('LAYER 2 — Test Evidence'),
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

  children.push(
    h2('2.6 Playwright — UI / E2E Evidence'),
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
    table(
      ['Browser', 'Tests', 'Passed', 'Failed', 'Skipped', 'Pass Rate'],
      model.playwright.browsers.map((b) => [
        b.browser,
        String(b.total),
        String(b.passed),
        String(b.failed),
        String(b.skipped),
        b.passRate,
      ]),
      1500
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
    h2('2.9 Test Artifacts'),
    table(
      ['Artifact', 'Location'],
      model.artifacts.map((item) => [item.name, item.location]),
      4500
    ),
    pageBreak()
  );

  // ===================== LAYER 3 =====================
  children.push(
    h1('LAYER 3 — QA Analysis'),
    p(
      'This layer interprets the evidence. It does not invent requirements, defects, or acceptance criteria.'
    ),
    h2('3.1 Coverage Analysis'),
    p(model.coverage.coverageNote, { bold: true }),
    table(
      ['Coverage Dimension', 'Value'],
      [
        ['Unique UI Test Scenarios (Test Cases)', String(model.coverage.uniqueUiScenarios)],
        ['UI Test Executions', String(model.coverage.uiExecutions)],
        ['Browser Coverage', model.coverage.browsers.join(', ') || 'Not Provided'],
        ['API Requests Executed', String(model.coverage.apiRequests)],
        ['Performance Samples', String(model.coverage.performanceSamples)],
        ['Functional Areas Covered', model.coverage.functionalAreas.join('; ') || 'Not Provided'],
      ],
      4500
    ),
    h2('3.2 Requirement Traceability'),
    p(model.requirementTraceabilityNote),
    h2('3.3 Defect Summary'),
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
    h2('3.4 Test Result Distribution (UI Executions)'),
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
    h2('3.5 Analytical Findings')
  );
  for (const item of model.qaAnalysis) children.push(bullet(item));

  children.push(h2('3.6 Automated Quality Check'));
  for (const check of model.qualityChecks) children.push(bullet(check));

  children.push(h2('3.7 Analysis Conclusion'));
  for (const line of model.conclusion) children.push(p(line));
  children.push(pageBreak());

  // ===================== LAYER 4 =====================
  children.push(
    h1('LAYER 4 — Risks & Limitations'),
    p(
      'A high automated pass rate does not mean the full application is defect-free. The following limitations are supported by the available execution scope.'
    )
  );
  for (const risk of model.risks) children.push(bullet(risk));
  children.push(pageBreak());

  // ===================== LAYER 5 =====================
  children.push(
    h1('LAYER 5 — Release Recommendation'),
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
