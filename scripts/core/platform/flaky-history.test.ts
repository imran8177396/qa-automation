import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyHistoricalRuns,
  detectFlakyFromHistory,
  type HistoricalRun,
} from './flaky';
import {
  ENGINE_REPORT_STATUS_FILTER,
  mapTestResultToReportRow,
} from '../../lib/qa-report/collect-engine-results';
import type { TestResult } from '../engine-contract';

const FIVE_RUN_EXAMPLE: HistoricalRun[] = [
  { run: 1, status: 'PASS' },
  { run: 2, status: 'FAIL' },
  { run: 3, status: 'PASS' },
  { run: 4, status: 'PASS' },
  { run: 5, status: 'FAIL' },
];

describe('classifyHistoricalRuns', () => {
  it('five-run PASS/FAIL mix → FLAKY with run listing and suppress false', () => {
    const result = classifyHistoricalRuns(FIVE_RUN_EXAMPLE);
    assert.equal(result.status, 'FLAKY');
    assert.notEqual(result.status, 'PASS');
    assert.match(result.reason ?? '', /run 2 FAIL/);
    assert.match(result.reason ?? '', /run 5 FAIL/);
    assert.match(result.reason ?? '', /run 1 PASS/);
    assert.equal(result.suppress, false);
    assert.equal(result.failures.length, 2);
  });

  it('five PASSes → PASS, not FLAKY', () => {
    const runs: HistoricalRun[] = [
      { run: 1, status: 'PASS' },
      { run: 2, status: 'PASS' },
      { run: 3, status: 'PASS' },
      { run: 4, status: 'PASS' },
      { run: 5, status: 'PASS' },
    ];
    const result = classifyHistoricalRuns(runs);
    assert.equal(result.status, 'PASS');
    assert.notEqual(result.status, 'FLAKY');
    assert.equal(result.suppress, false);
    assert.equal(result.failures.length, 0);
  });

  it('five FAILs → FAIL, not FLAKY, failures.length === 5', () => {
    const runs: HistoricalRun[] = [
      { run: 1, status: 'FAIL' },
      { run: 2, status: 'FAIL' },
      { run: 3, status: 'FAIL' },
      { run: 4, status: 'FAIL' },
      { run: 5, status: 'FAIL' },
    ];
    const result = classifyHistoricalRuns(runs);
    assert.equal(result.status, 'FAIL');
    assert.notEqual(result.status, 'FLAKY');
    assert.equal(result.failures.length, 5);
    assert.equal(result.suppress, false);
  });

  it('preserves FAIL evidence unchanged on the failure entry', () => {
    const evidence = { message: 'assert product id', screenshot: 'shot.png' };
    const runs: HistoricalRun[] = [
      { run: 1, status: 'PASS' },
      { run: 2, status: 'FAIL', evidence },
      { run: 3, status: 'PASS' },
    ];
    const result = classifyHistoricalRuns(runs);
    assert.equal(result.status, 'FLAKY');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].run, 2);
    assert.equal(result.failures[0].status, 'FAIL');
    assert.deepEqual(result.failures[0].evidence, evidence);
    assert.equal(result.failures[0].evidence?.message, 'assert product id');
    assert.equal(result.failures[0].evidence?.screenshot, 'shot.png');
  });

  it('empty history → NOT_TESTED, not FLAKY', () => {
    const result = classifyHistoricalRuns([]);
    assert.equal(result.status, 'NOT_TESTED');
    assert.equal(result.reason, 'no historical runs recorded');
    assert.notEqual(result.status, 'FLAKY');
    assert.equal(result.suppress, false);
  });

  it('BLOCKED alone is not FLAKY; PASS+FAIL with BLOCKED stays FLAKY and lists BLOCKED', () => {
    const blockedOnly = classifyHistoricalRuns([
      { run: 1, status: 'BLOCKED' },
      { run: 2, status: 'BLOCKED' },
    ]);
    assert.equal(blockedOnly.status, 'BLOCKED');
    assert.notEqual(blockedOnly.status, 'FLAKY');

    const mixed = classifyHistoricalRuns([
      { run: 1, status: 'PASS' },
      { run: 2, status: 'BLOCKED' },
      { run: 3, status: 'FAIL' },
    ]);
    assert.equal(mixed.status, 'FLAKY');
    assert.match(mixed.reason ?? '', /run 2 BLOCKED/);
  });

  it('TIMEOUT is not PASS; FAIL without PASS stays FAIL', () => {
    const result = classifyHistoricalRuns([
      { run: 1, status: 'FAIL' },
      { run: 2, status: 'TIMEOUT' },
      { run: 3, status: 'FAIL' },
    ]);
    assert.equal(result.status, 'FAIL');
    assert.notEqual(result.status, 'PASS');
    assert.notEqual(result.status, 'FLAKY');
    assert.match(result.reason ?? '', /run 2 TIMEOUT/);
  });
});

describe('detectFlakyFromHistory', () => {
  it('returns one classification per test id without suppressing', () => {
    const byId = detectFlakyFromHistory({
      'cart-checkout': FIVE_RUN_EXAMPLE,
      'always-pass': [
        { run: 1, status: 'PASS' },
        { run: 2, status: 'PASS' },
      ],
    });
    assert.equal(byId['cart-checkout']?.status, 'FLAKY');
    assert.equal(byId['cart-checkout']?.suppress, false);
    assert.equal(byId['always-pass']?.status, 'PASS');
    assert.equal(byId['always-pass']?.suppress, false);
  });
});

describe('FLAKY report status label', () => {
  it('mapTestResultToReportRow keeps status FLAKY, not PASS', () => {
    const flakyResult: TestResult = {
      id: 'hist-flaky',
      testType: 'smoke',
      category: 'functional',
      name: 'Historical flaky',
      status: 'FLAKY',
    };
    const row = mapTestResultToReportRow(flakyResult);
    assert.equal(row.status, 'FLAKY');
    assert.notEqual(row.status, 'PASS');
  });

  it('ENGINE_REPORT_STATUS_FILTER includes FLAKY next to PASS/FAIL/BLOCKED/NOT_TESTED', () => {
    assert.ok((ENGINE_REPORT_STATUS_FILTER as readonly string[]).includes('PASS'));
    assert.ok((ENGINE_REPORT_STATUS_FILTER as readonly string[]).includes('FAIL'));
    assert.ok((ENGINE_REPORT_STATUS_FILTER as readonly string[]).includes('BLOCKED'));
    assert.ok((ENGINE_REPORT_STATUS_FILTER as readonly string[]).includes('NOT_TESTED'));
    assert.ok((ENGINE_REPORT_STATUS_FILTER as readonly string[]).includes('FLAKY'));
  });
});

describe('historical flaky never suppresses', () => {
  it('suppress is always false and FAIL entries stay FAIL', () => {
    const result = classifyHistoricalRuns(FIVE_RUN_EXAMPLE);
    assert.equal(result.suppress, false);
    // quarantine is never called from classifyHistoricalRuns / detectFlakyFromHistory
    assert.ok(result.failures.every((row) => row.status === 'FAIL'));
  });
});
