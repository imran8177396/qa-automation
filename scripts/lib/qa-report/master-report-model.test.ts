import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { generateMasterQaReport } from '../../reporting/generate-master-report';
import {
  archiveToHistory,
  MASTER_QA_REPORT_HTML,
  MASTER_QA_REPORT_JSON,
  type ExecutionIdentity,
} from './execution-archive';
import { generateMasterReportHtml } from './master-report-html';
import { MASTER_NUMBERED_SECTION_COUNT, MASTER_SECTION_DEFS, buildMasterReportModel } from './master-report-model';
import { PKT_OFFSET, PKT_TIMEZONE } from './timestamps';

function tmpDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `qa-master-report-${label}-`));
}

function identity(folderPath: string): ExecutionIdentity {
  return {
    executionId: 'QA-Automation_2026-09-18_17-59-36_PKT',
    folderName: 'QA-Automation_2026-09-18_17-59-36_PKT',
    folderPath,
    projectName: 'QA Automation',
    websiteName: 'QA Automation',
    baseUrl: 'https://schiwo.intactinternational.ae/',
    projectNameSource: 'config',
    websiteNameSource: 'config',
    hostnameFallback: false,
    startTime: '2026-09-18T17:59:36+05:00',
    timestamp: '2026-09-18_17-59-36',
    timezone: PKT_TIMEZONE,
    timezoneOffset: PKT_OFFSET,
    testSuite: 'qa:all',
    startedAtMs: Date.parse('2026-09-18T12:59:36.000Z'),
  };
}

describe('master report sections', () => {
  it('defines the 24 numbered sections plus appendices A–F in the release-readiness order', () => {
    assert.equal(MASTER_NUMBERED_SECTION_COUNT, 24);
    assert.equal(MASTER_SECTION_DEFS.length, 30);
    assert.deepEqual(
      MASTER_SECTION_DEFS.map((row) => row.title),
      [
        'EXECUTIVE SUMMARY',
        'KEY FINDINGS',
        'QA EXECUTION INFORMATION',
        'TEST SCOPE & ENVIRONMENT',
        'APPLICATION DISCOVERY',
        'COVERAGE',
        'FUNCTIONAL UI / E2E',
        'RESPONSIVE TESTING',
        'CROSS-BROWSER TESTING',
        'VISUAL TESTING',
        'ACCESSIBILITY TESTING',
        'API TESTING',
        'UI/API CORRELATION',
        'PERFORMANCE TESTING',
        'SECURITY QA',
        'SEO QA',
        'CONTENT QA',
        'WORKFLOW TESTING',
        'DEFECT / RISK SUMMARY',
        'FAILURE ANALYSIS',
        'RETEST RESULTS',
        'RECOMMENDED ACTIONS',
        'FINAL COVERAGE MATRIX',
        'RELEASE QUALITY ASSESSMENT',
        'APPENDIX A — TEST CASE DETAILS',
        'APPENDIX B — FAILURE EVIDENCE',
        'APPENDIX C — SCREENSHOTS / VISUAL EVIDENCE',
        'APPENDIX D — API EVIDENCE',
        'APPENDIX E — BROWSER / VIEWPORT MATRIX',
        'APPENDIX F — CONFIGURATION & METHODOLOGY',
      ]
    );
  });

  it('marks missing modules NOT_EXECUTED and does not invent a product name or coverage', () => {
    const folder = tmpDir('empty');
    const reportsRoot = tmpDir('empty-reports');
    const model = buildMasterReportModel({
      identity: identity(folder),
      folderPath: folder,
      reportsRoot,
    });
    assert.equal(model.projectName, 'QA Automation');
    assert.equal(model.projectNameSource, 'config');
    assert.notEqual(model.projectName, 'Schiwo');
    assert.equal(model.timezone, 'Asia/Karachi');
    assert.equal(model.timezoneOffset, '+05:00');
    assert.equal(model.sections.length, 30);
    assert.equal(model.summary.kpis.totalTests, null);
    assert.equal(model.sections.find((row) => row.id === 'release-quality-assessment')?.title, 'RELEASE QUALITY ASSESSMENT');
    const discovery = model.sections.find((row) => row.id === 'application-discovery');
    const coverage = model.sections.find((row) => row.id === 'coverage');
    const api = model.sections.find((row) => row.id === 'api-testing');
    assert.equal(discovery?.status, 'NOT_EXECUTED');
    assert.equal(discovery?.dataAvailable, false);
    assert.match(discovery?.unavailableReason ?? '', /not present|not invented/i);
    assert.equal(coverage?.status, 'NOT_EXECUTED');
    assert.equal(api?.status, 'NOT_EXECUTED');
    const html = generateMasterReportHtml(model);
    for (const title of MASTER_SECTION_DEFS.map((row) => row.title)) {
      const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;');
      assert.match(html, new RegExp(escaped));
    }
    assert.doesNotMatch(html, /defect-free website/i);
  });

  it('embeds real module findings when artifacts exist', () => {
    const folder = tmpDir('real');
    const reportsRoot = tmpDir('real-reports');
    fs.mkdirSync(path.join(reportsRoot, 'security'), { recursive: true });
    fs.mkdirSync(path.join(reportsRoot, 'coverage'), { recursive: true });
    fs.writeFileSync(
      path.join(reportsRoot, 'security', 'summary.json'),
      JSON.stringify({
        passed: false,
        failCount: 1,
        passCount: 0,
        findings: [
          {
            status: 'FAIL',
            rule: 'content-security-policy',
            severity: 'medium',
            page: 'https://example.test/',
            expected: 'content-security-policy',
            actual: 'absent',
          },
        ],
      }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(reportsRoot, 'coverage', 'coverage.json'),
      JSON.stringify({
        totals: {
          testableItems: 2,
          testedItems: 1,
          testedCount: 0,
          failedCount: 1,
          blockedCount: 0,
          uncoveredItems: 1,
          itemCoveragePercent: 50,
          complete: false,
          passedExecutions: 0,
          failedExecutions: 1,
          skippedExecutions: 0,
          byStatus: {
            TESTED: 0,
            FAILED: 1,
            BLOCKED: 0,
            SKIPPED: 0,
            'NOT APPLICABLE': 0,
            UNTESTABLE: 0,
            UNCOVERED: 1,
          },
        },
        dimensions: [],
        records: [
          {
            id: 'PAGE-0001',
            page: '/',
            element: 'home',
            type: 'page',
            status: 'FAILED',
            reason: 'recorded failure',
            recommendedTest: 'page-load',
          },
        ],
        riskAreas: [{ id: 'failed-security', title: 'security executed and FAILED', severity: 'high', category: 'failed', reason: 'documented', itemIds: ['SEC'], itemCount: 1 }],
      }),
      'utf8'
    );

    const model = buildMasterReportModel({
      identity: identity(folder),
      folderPath: folder,
      reportsRoot,
    });
    const security = model.sections.find((row) => row.id === 'security-qa');
    const exec = model.sections.find((row) => row.id === 'qa-execution-information');
    assert.equal(security?.dataAvailable, true);
    assert.equal(security?.status, 'FAIL');
    assert.ok(security?.tables.some((table) => table.rows.some((row) => row.includes('content-security-policy'))));
    assert.equal(exec?.fields.find((row) => row.label === 'Project name')?.value, 'QA Automation');
    const html = generateMasterReportHtml(model);
    assert.match(html, /content-security-policy/);
    assert.match(html, /PAGE-0001/);
    assert.match(html, /RELEASE QUALITY ASSESSMENT/);
    assert.match(html, /KEY FINDINGS/);
    assert.match(html, /RECOMMENDED ACTIONS/);
    assert.doesNotMatch(html, /FINAL QA VERDICT/);
    const executive = model.sections.find((row) => row.id === 'executive-summary');
    const matrix = model.sections.find((row) => row.id === 'final-coverage-matrix');
    const assessment = model.sections.find((row) => row.id === 'release-quality-assessment');
    assert.equal(executive?.fields.find((row) => row.label === 'Total Tests')?.value, String(model.summary.kpis.totalTests));
    assert.equal(matrix?.fields.find((row) => row.label === 'Total Tests')?.value, String(model.summary.kpis.totalTests));
    assert.equal(assessment?.fields.find((row) => row.label === 'Failed')?.value, String(model.summary.kpis.failed));
    assert.equal(model.summary.kpis.passed, 0);
    assert.equal(model.summary.kpis.failed, 1);
    assert.equal(model.summary.kpis.notTested, 1);
    assert.ok(model.summary.defects.some((row) => row.id === 'PAGE-0001' || row.description.includes('recorded failure') || row.id === 'failed-security'));
    assert.ok(model.summary.recommendedActions.every((row) => row.defectOrTestId && row.problem));
  });

  it('writes MASTER-QA-REPORT files into the history folder after archiveToHistory', () => {
    const historyRoot = tmpDir('hist');
    const reportsRoot = tmpDir('reports');
    fs.mkdirSync(path.join(reportsRoot, 'seo'), { recursive: true });
    fs.writeFileSync(
      path.join(reportsRoot, 'seo', 'summary.json'),
      JSON.stringify({
        passed: false,
        failCount: 1,
        findings: [{ id: 'SEO-0004', rule: 'robots-txt', severity: 'medium', status: 'FAIL', detail: 'robots.txt returned 404.' }],
      }),
      'utf8'
    );
    const folderPath = path.join(historyRoot, 'QA-Automation_2026-09-18_17-59-36_PKT');
    fs.mkdirSync(folderPath, { recursive: true });
    archiveToHistory({
      identity: identity(folderPath),
      reportsRoot,
      overallStatus: 'FAIL',
      env: { NODE_ENV: 'test' },
    });
    const result = generateMasterQaReport({
      identity: identity(folderPath),
      folderPath,
      reportsRoot,
      preferHistoryModules: true,
    });
    assert.equal(path.basename(result.htmlPath), MASTER_QA_REPORT_HTML);
    assert.equal(path.basename(result.jsonPath), MASTER_QA_REPORT_JSON);
    assert.equal(fs.existsSync(result.htmlPath), true);
    assert.equal(fs.existsSync(result.jsonPath), true);
    const html = fs.readFileSync(result.htmlPath, 'utf8');
    assert.match(html, /SEO QA/);
    assert.match(html, /SEO-0004|robots\.txt returned 404/);
    const parsed = JSON.parse(fs.readFileSync(result.jsonPath, 'utf8')) as {
      sections: Array<{ title: string }>;
      summary: { kpis: { failed: number | null } };
    };
    assert.equal(parsed.sections.length, 30);
    assert.ok(parsed.sections.some((row) => row.title === 'RELEASE QUALITY ASSESSMENT'));
    assert.ok(!parsed.sections.some((row) => row.title === 'FINAL QA VERDICT'));
  });
});
