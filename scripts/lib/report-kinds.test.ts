import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PATHS } from './paths';
import {
  allocateAllureHistoryDir,
  allureResultsPresent,
  defaultReportKindRoots,
  inspectReportKinds,
  listPlaywrightHtmlReports,
  shouldArchiveAllureReport,
} from './report-kinds';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-report-kinds-'));
}

describe('report-kinds paths', () => {
  it('maps Allure results and report under reports/allure without hardcoded drive letters', () => {
    assert.match(PATHS.allureResults.replace(/\\/g, '/'), /reports\/allure\/results$/);
    assert.match(PATHS.allureReport.replace(/\\/g, '/'), /reports\/allure\/report$/);
    assert.match(PATHS.allureHistory.replace(/\\/g, '/'), /reports\/allure\/history$/);
    assert.match(PATHS.reports.allure.replace(/\\/g, '/'), /reports\/allure$/);
    assert.match(PATHS.reportIndexJson.replace(/\\/g, '/'), /reports\/summary\/report-index\.json$/);
    assert.equal(PATHS.allureResults.startsWith(PATHS.root), true);
    const roots = defaultReportKindRoots();
    assert.equal(roots.allureResults, PATHS.allureResults);
  });
});

describe('report-kinds inspection', () => {
  it('marks missing tool reports NOT_EXECUTED and does not invent scores', () => {
    const root = makeTempDir();
    const roots = {
      root,
      allureResults: path.join(root, 'reports', 'allure', 'results'),
      allureReport: path.join(root, 'reports', 'allure', 'report'),
      playwright: path.join(root, 'reports', 'playwright'),
      postman: path.join(root, 'reports', 'postman'),
      jmeter: path.join(root, 'reports', 'jmeter'),
      summary: path.join(root, 'reports', 'summary'),
    };
    fs.mkdirSync(roots.summary, { recursive: true });
    const kinds = inspectReportKinds(roots);
    assert.equal(kinds.find((row) => row.id === 'allure')?.status, 'NOT_EXECUTED');
    assert.equal(kinds.find((row) => row.id === 'playwrightHtml')?.status, 'NOT_EXECUTED');
    assert.equal(kinds.find((row) => row.id === 'postman')?.status, 'NOT_EXECUTED');
    assert.equal(kinds.find((row) => row.id === 'jmeter')?.status, 'NOT_EXECUTED');
    assert.equal(kinds.find((row) => row.id === 'finalCombined')?.status, 'NOT_EXECUTED');
    assert.equal(kinds.find((row) => row.id === 'jsonSummary')?.status, 'PRESENT');
    assert.match(kinds.find((row) => row.id === 'jmeter')?.reason ?? '', /not invented/i);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('marks HTML/JSON artifacts PRESENT when they exist on disk', () => {
    const root = makeTempDir();
    const roots = {
      root,
      allureResults: path.join(root, 'reports', 'allure', 'results'),
      allureReport: path.join(root, 'reports', 'allure', 'report'),
      playwright: path.join(root, 'reports', 'playwright'),
      postman: path.join(root, 'reports', 'postman'),
      jmeter: path.join(root, 'reports', 'jmeter'),
      summary: path.join(root, 'reports', 'summary'),
    };
    fs.mkdirSync(path.join(roots.playwright, 'e2e', 'html'), { recursive: true });
    fs.writeFileSync(path.join(roots.playwright, 'e2e', 'html', 'index.html'), '<html></html>');
    fs.mkdirSync(roots.postman, { recursive: true });
    fs.writeFileSync(path.join(roots.postman, 'report.json'), '{}');
    fs.mkdirSync(path.join(roots.jmeter, 'html'), { recursive: true });
    fs.writeFileSync(path.join(roots.jmeter, 'html', 'index.html'), '<html></html>');
    fs.mkdirSync(roots.summary, { recursive: true });
    fs.writeFileSync(path.join(roots.summary, 'final-qa-report.md'), '# Final\n');
    fs.mkdirSync(roots.allureReport, { recursive: true });
    fs.writeFileSync(path.join(roots.allureReport, 'index.html'), '<html></html>');

    const kinds = inspectReportKinds(roots);
    assert.equal(kinds.find((row) => row.id === 'allure')?.status, 'PRESENT');
    assert.equal(kinds.find((row) => row.id === 'playwrightHtml')?.status, 'PRESENT');
    assert.equal(kinds.find((row) => row.id === 'postman')?.status, 'PRESENT');
    assert.equal(kinds.find((row) => row.id === 'jmeter')?.status, 'PRESENT');
    assert.equal(kinds.find((row) => row.id === 'finalCombined')?.status, 'PRESENT');
    assert.deepEqual(listPlaywrightHtmlReports(roots.playwright, root).map((row) => row.suite), ['e2e']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('honors an Allure BLOCKED override and archives only when index.html exists', () => {
    const root = makeTempDir();
    const reportDir = path.join(root, 'report');
    const historyRoot = path.join(root, 'history');
    fs.mkdirSync(reportDir, { recursive: true });
    assert.equal(shouldArchiveAllureReport(reportDir), false);
    fs.writeFileSync(path.join(reportDir, 'index.html'), '<html></html>');
    assert.equal(shouldArchiveAllureReport(reportDir), true);
    const first = allocateAllureHistoryDir(historyRoot);
    fs.mkdirSync(first, { recursive: true });
    const second = allocateAllureHistoryDir(historyRoot);
    assert.notEqual(first, second);
    const kinds = inspectReportKinds(defaultReportKindRoots(), {
      status: 'BLOCKED',
      reason: 'Allure CLI missing',
    });
    assert.equal(kinds.find((row) => row.id === 'allure')?.status, 'BLOCKED');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('detects raw Allure result files without treating empty folders as results', () => {
    const root = makeTempDir();
    const resultsDir = path.join(root, 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    assert.equal(allureResultsPresent(resultsDir), false);
    fs.writeFileSync(path.join(resultsDir, 'readme.txt'), 'not a result');
    assert.equal(allureResultsPresent(resultsDir), false);
    fs.writeFileSync(path.join(resultsDir, 'demo-result.json'), '{}');
    assert.equal(allureResultsPresent(resultsDir), true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
