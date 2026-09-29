import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  ENGINE_RESULT_COLUMN_LABELS,
  collectEngineResults,
  gatedCheckOutcomesToTestResults,
  mapEngineStatusToAllure,
  mapTestResultToReportRow,
  renderEngineResultsTableHtml,
  type EngineSummarySource,
} from './collect-engine-results';
import type { EngineSummary, TestResult } from '../../core/engine-contract';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-engine-report-'));
const failDir = path.join(tmpRoot, 'smoke');
const notTestedDir = path.join(tmpRoot, 'deployment');
const missingDir = path.join(tmpRoot, 'missing-engine');

function writeSummary(dir: string, summary: EngineSummary): string {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'summary.json');
  fs.writeFileSync(filePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return filePath;
}

const failResult: TestResult = {
  id: 'smoke-home',
  testType: 'smoke',
  category: 'functional',
  name: 'GET home',
  status: 'FAIL',
  severity: 'high',
  durationMs: 42,
  target: 'https://example.test/',
  assertion: { expected: '2xx/3xx', actual: 500 },
  error: { message: 'HTTP 500' },
  evidence: { screenshot: 'reports/smoke/evidence/home.png', log: 'reports/smoke/run.log' },
  metadata: { reason: 'upstream returned 500' },
};

const notTestedResult: TestResult = {
  id: 'deploy-rollback',
  testType: 'deployment',
  category: 'functional',
  name: 'Deployment rollback',
  status: 'NOT_TESTED',
  severity: 'medium',
  target: '',
  metadata: { reason: 'not authorized' },
  error: { message: 'destructive catalog only — not executed' },
};

before(() => {
  writeSummary(failDir, {
    generatedAt: '2026-09-23T00:00:00.000Z',
    engine: 'smoke',
    testType: 'smoke',
    status: 'FAIL',
    passed: false,
    results: [failResult],
    passCount: 0,
    failCount: 1,
    skippedCount: 0,
    blockedCount: 0,
    notTestedCount: 0,
    requiresConfigurationCount: 0,
    notApplicableCount: 0,
    timeoutCount: 0,
    cancelledCount: 0,
    flakyCount: 0,
  });
  writeSummary(notTestedDir, {
    generatedAt: '2026-09-23T00:00:00.000Z',
    engine: 'deployment',
    testType: 'deployment',
    status: 'NOT_TESTED',
    passed: true,
    results: [notTestedResult],
    passCount: 0,
    failCount: 0,
    skippedCount: 0,
    blockedCount: 0,
    notTestedCount: 1,
    requiresConfigurationCount: 0,
    notApplicableCount: 0,
    timeoutCount: 0,
    cancelledCount: 0,
    flakyCount: 0,
  });
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function sourcesFor(...dirs: Array<{ engineId: string; dir: string }>): EngineSummarySource[] {
  return dirs.map(({ engineId, dir }) => ({
    engineId,
    summaryPath: path.join(dir, 'summary.json'),
    relativePath: path.join(path.basename(dir), 'summary.json').replace(/\\/g, '/'),
  }));
}

test('FAIL engine summary maps to report row with all 11 fields populated', () => {
  const collected = collectEngineResults({
    sources: sourcesFor({ engineId: 'smoke', dir: failDir }),
  });
  assert.equal(collected.rows.length, 1);
  assert.equal(collected.results.filter((row) => row.status === 'PASS').length, 0);
  const row = collected.rows[0];
  assert.equal(row.testType, 'smoke');
  assert.equal(row.category, 'functional');
  assert.equal(row.target, 'https://example.test/');
  assert.equal(row.status, 'FAIL');
  assert.equal(row.severity, 'high');
  assert.equal(row.duration, '42 ms');
  assert.equal(row.expected, '2xx/3xx');
  assert.equal(row.actual, '500');
  assert.equal(row.error, 'HTTP 500');
  assert.match(row.evidence, /reports\/smoke\/evidence\/home\.png/);
  assert.equal(row.configuration, 'upstream returned 500');

  const mapped = mapTestResultToReportRow(failResult);
  assert.deepEqual(
    Object.keys(mapped).sort(),
    [
      'actual',
      'category',
      'configuration',
      'duration',
      'error',
      'evidence',
      'expected',
      'severity',
      'status',
      'target',
      'testType',
    ].sort()
  );
});

test('NOT_TESTED row stays NOT_TESTED and is not remapped to PASS', () => {
  const collected = collectEngineResults({
    sources: sourcesFor({ engineId: 'deployment', dir: notTestedDir }),
  });
  assert.equal(collected.rows.length, 1);
  assert.equal(collected.rows[0].status, 'NOT_TESTED');
  assert.notEqual(collected.rows[0].status, 'PASS');
  assert.equal(mapEngineStatusToAllure('NOT_TESTED'), 'broken');
  assert.equal(mapEngineStatusToAllure('PASS'), 'passed');
  assert.equal(mapEngineStatusToAllure('BLOCKED'), 'broken');
  assert.equal(mapEngineStatusToAllure('REQUIRES_CONFIGURATION'), 'broken');
  assert.equal(mapEngineStatusToAllure('SKIPPED'), 'skipped');
  assert.equal(mapEngineStatusToAllure('TIMEOUT'), 'broken');
  assert.equal(mapEngineStatusToAllure('CANCELLED'), 'skipped');
  assert.equal(mapEngineStatusToAllure('FLAKY'), 'broken');
  assert.notEqual(mapEngineStatusToAllure('TIMEOUT'), 'passed');
  assert.notEqual(mapEngineStatusToAllure('CANCELLED'), 'passed');
  assert.notEqual(mapEngineStatusToAllure('FLAKY'), 'passed');
  assert.notEqual(mapEngineStatusToAllure('FLAKY'), 'failed');
});

test('missing summary file yields no row and does not increase pass count', () => {
  const collected = collectEngineResults({
    sources: sourcesFor({ engineId: 'ghost', dir: missingDir }),
  });
  assert.equal(collected.rows.length, 0);
  assert.equal(collected.results.length, 0);
  assert.equal(collected.available, false);
  assert.equal(collected.missing.length, 1);
  assert.equal(collected.missing[0].engineId, 'ghost');
  const passCount = collected.rows.filter((row) => row.status === 'PASS').length;
  assert.equal(passCount, 0);
});

test('FLAKY engine result stays FLAKY in the report row status column', () => {
  const flakyResult: TestResult = {
    id: 'smoke-flaky',
    testType: 'smoke',
    category: 'functional',
    name: 'Intermittent check',
    status: 'FLAKY',
    severity: 'medium',
    target: 'https://example.test/',
  };
  const row = mapTestResultToReportRow(flakyResult);
  assert.equal(row.status, 'FLAKY');
  assert.notEqual(row.status, 'PASS');
  assert.equal(mapEngineStatusToAllure('FLAKY'), 'broken');
});

test('required field labels appear in the HTML table renderer for a FAIL row', () => {
  const row = mapTestResultToReportRow(failResult);
  const html = renderEngineResultsTableHtml([row]);
  for (const label of ENGINE_RESULT_COLUMN_LABELS) {
    assert.match(html, new RegExp(`<th>${label}</th>`));
  }
  assert.match(html, /<td>FAIL<\/td>/);
  assert.match(html, /<td>smoke<\/td>/);
  assert.match(html, /<td>2xx\/3xx<\/td>/);
  assert.match(html, /<td>HTTP 500<\/td>/);
  assert.doesNotMatch(html, /<td>PASS<\/td>/);
});

test('gated-check-outcomes map to real statuses; missing/empty file adds no PASS rows', () => {
  assert.deepEqual(gatedCheckOutcomesToTestResults(null), []);
  assert.deepEqual(gatedCheckOutcomesToTestResults({ rows: [] }), []);
  assert.deepEqual(gatedCheckOutcomesToTestResults({}), []);

  const mapped = gatedCheckOutcomesToTestResults({
    rows: [
      {
        id: 'INV-0001',
        kind: 'form-submit',
        title: 'submit blocked',
        status: 'BLOCKED',
        reason: 'BLOCKED: form submission is not authorized',
        targetUrl: 'https://example.test/form',
      },
      {
        id: 'INV-0002',
        kind: 'visibility',
        title: 'not visible',
        status: 'NOT_TESTED',
        reason: 'NOT_TESTED: not visible',
        targetUrl: 'https://example.test/',
      },
      {
        id: 'INV-0003',
        kind: 'page-sanity',
        title: 'gated page',
        status: 'REQUIRES_CONFIGURATION',
        reason: 'REQUIRES_CONFIGURATION: login wall',
        targetUrl: 'https://example.test/account',
      },
      {
        id: 'INV-skip',
        kind: 'visibility',
        title: 'planned should not map',
        status: 'PLANNED',
        reason: 'should be ignored',
        targetUrl: 'https://example.test/',
      },
    ],
  });

  assert.equal(mapped.length, 3);
  assert.ok(mapped.every((row) => row.status !== 'PASS'));
  assert.equal(mapped[0]?.status, 'BLOCKED');
  assert.equal(mapped[1]?.status, 'NOT_TESTED');
  assert.equal(mapped[2]?.status, 'REQUIRES_CONFIGURATION');
  assert.equal(mapped[0]?.testType, 'ui');
  assert.match(mapped[0]?.error?.message ?? '', /form submission/i);
});

test('collectEngineResults with includeGatedCheckOutcomes false never invents gated PASS', () => {
  const collected = collectEngineResults({
    sources: sourcesFor({ engineId: 'smoke', dir: failDir }),
    includeGatedCheckOutcomes: false,
  });
  assert.equal(collected.results.filter((row) => row.status === 'PASS').length, 0);
  assert.ok(collected.results.every((row) => row.metadata?.source !== 'gated-check-outcomes'));
});
