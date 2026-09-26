import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { compareExecutions } from './history';
import {
  appendRunRecord,
  buildRunRecord,
  loadRunRecords,
  renderExecutionComparison,
  resolveRunRecordHistoryDir,
} from './execution-history';
import { createExecutionId } from './observability';
import { projectStores } from './project';
import { NOT_AVAILABLE } from '../../lib/suite-origin';

const tempRoots: string[] = [];

function makeTempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `qa-exec-hist-${label}-`));
  tempRoots.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('execution history records', () => {
  it('two records get different runIds from createExecutionId / builder', () => {
    const a = buildRunRecord({
      runId: createExecutionId(),
      tests: [{ testEngine: 'e2e', testId: 't1', status: 'PASS', durationMs: null }],
    });
    const b = buildRunRecord({
      tests: [{ testEngine: 'e2e', testId: 't1', status: 'PASS', durationMs: null }],
    });
    assert.notEqual(a.runId, b.runId);
    assert.ok(a.runId.length > 0);
    assert.ok(b.runId.length > 0);
    assert.equal(a.branch, NOT_AVAILABLE);
  });

  it('append + load round-trip in os.tmpdir(); project app-a not under app-b', () => {
    const root = makeTempDir('iso');
    const dirA = path.join(root, 'app-a-history');
    const dirB = path.join(root, 'app-b-history');

    const recordA = buildRunRecord({
      runId: 'run-app-a-1',
      projectId: 'app-a',
      environment: 'local',
      branch: 'main',
      commit: 'abc',
      build: '1',
      timestamp: '2026-01-01T00:00:00.000Z',
      tests: [{ testEngine: 'api', testId: 'login', status: 'PASS', durationMs: 10 }],
    });
    const recordB = buildRunRecord({
      runId: 'run-app-b-1',
      projectId: 'app-b',
      environment: 'local',
      timestamp: '2026-01-02T00:00:00.000Z',
      tests: [{ testEngine: 'api', testId: 'login', status: 'FAIL', durationMs: null }],
    });

    appendRunRecord(recordA, { dir: dirA });
    appendRunRecord(recordB, { dir: dirB });

    const loadedA = loadRunRecords(dirA);
    const loadedB = loadRunRecords(dirB);
    assert.equal(loadedA.length, 1);
    assert.equal(loadedA[0].runId, 'run-app-a-1');
    assert.equal(loadedA[0].projectId, 'app-a');
    assert.equal(loadedB.length, 1);
    assert.equal(loadedB[0].runId, 'run-app-b-1');

    assert.equal(fs.existsSync(path.join(dirB, 'run-run-app-a-1.json')), false);
    assert.equal(fs.existsSync(path.join(dirA, 'run-run-app-b-1.json')), false);

    const storesA = projectStores('app-a');
    const storesB = projectStores('app-b');
    assert.notEqual(storesA.history, storesB.history);
    assert.equal(resolveRunRecordHistoryDir('app-a'), storesA.history);
    assert.equal(resolveRunRecordHistoryDir('app-b'), storesB.history);

    assert.deepEqual(loadRunRecords(path.join(root, 'missing-dir')), []);
  });

  it('same runId appended twice throws', () => {
    const dir = makeTempDir('dup');
    const record = buildRunRecord({
      runId: 'dup-run',
      timestamp: '2026-01-01T00:00:00.000Z',
      tests: [{ testEngine: 'e2e', testId: 'x', status: 'PASS', durationMs: null }],
    });
    appendRunRecord(record, { dir });
    assert.throws(() => appendRunRecord(record, { dir }), /already exists/);
  });
});

describe('compareExecutions', () => {
  it('current FAIL / previous PASS → newFailures with evidence message', () => {
    const previous = buildRunRecord({
      runId: 'prev-pass',
      timestamp: '2026-01-01T00:00:00.000Z',
      tests: [{ testEngine: 'e2e', testId: 'checkout', status: 'PASS', durationMs: 50 }],
    });
    const current = buildRunRecord({
      runId: 'cur-fail',
      timestamp: '2026-01-02T00:00:00.000Z',
      tests: [
        {
          testEngine: 'e2e',
          testId: 'checkout',
          status: 'FAIL',
          durationMs: 60,
          evidence: { message: 'button not found' },
        },
      ],
    });
    const comparison = compareExecutions(current, previous);
    assert.equal(comparison.newFailures.length, 1);
    assert.equal(comparison.newFailures[0].testId, 'checkout');
    assert.equal(comparison.newFailures[0].status, 'FAIL');
    assert.equal(comparison.newFailures[0].evidence?.message, 'button not found');
    assert.equal(comparison.recoveredFailures.length, 0);

    const md = renderExecutionComparison(comparison);
    assert.match(md, /## newFailures/);
    assert.match(md, /checkout: FAIL — button not found/);
    assert.match(md, /cur-fail/);
    assert.match(md, /prev-pass/);
  });

  it('previous FAIL / current PASS → recoveredFailures', () => {
    const previous = buildRunRecord({
      runId: 'prev-fail',
      timestamp: '2026-01-01T00:00:00.000Z',
      tests: [{ testEngine: 'e2e', testId: 'search', status: 'FAIL', durationMs: null }],
    });
    const current = buildRunRecord({
      runId: 'cur-pass',
      timestamp: '2026-01-02T00:00:00.000Z',
      tests: [{ testEngine: 'e2e', testId: 'search', status: 'PASS', durationMs: null }],
    });
    const comparison = compareExecutions(current, previous);
    assert.equal(comparison.recoveredFailures.length, 1);
    assert.equal(comparison.recoveredFailures[0].testId, 'search');
    assert.equal(comparison.recoveredFailures[0].status, 'PASS');
    assert.equal(comparison.newFailures.length, 0);
  });

  it('id only in current → newTests; id only in previous → removedTests', () => {
    const previous = buildRunRecord({
      runId: 'prev',
      timestamp: '2026-01-01T00:00:00.000Z',
      tests: [
        { testEngine: 'e2e', testId: 'old-only', status: 'PASS', durationMs: null },
        { testEngine: 'e2e', testId: 'shared', status: 'PASS', durationMs: null },
      ],
    });
    const current = buildRunRecord({
      runId: 'cur',
      timestamp: '2026-01-02T00:00:00.000Z',
      tests: [
        { testEngine: 'e2e', testId: 'new-only', status: 'PASS', durationMs: null },
        { testEngine: 'e2e', testId: 'shared', status: 'PASS', durationMs: null },
      ],
    });
    const comparison = compareExecutions(current, previous);
    assert.deepEqual(comparison.newTests, [{ testId: 'new-only', status: 'PASS' }]);
    assert.deepEqual(comparison.removedTests, [{ testId: 'old-only', status: 'PASS' }]);
  });

  it('PASS, FAIL, PASS across three runs → flaky; five FAILs are not flaky', () => {
    const dir = makeTempDir('flaky');
    const r1 = buildRunRecord({
      runId: 'f1',
      timestamp: '2026-01-01T00:00:00.000Z',
      tests: [{ testEngine: 'e2e', testId: 'flicker', status: 'PASS', durationMs: null }],
    });
    const r2 = buildRunRecord({
      runId: 'f2',
      timestamp: '2026-01-02T00:00:00.000Z',
      tests: [{ testEngine: 'e2e', testId: 'flicker', status: 'FAIL', durationMs: null }],
    });
    const r3 = buildRunRecord({
      runId: 'f3',
      timestamp: '2026-01-03T00:00:00.000Z',
      tests: [{ testEngine: 'e2e', testId: 'flicker', status: 'PASS', durationMs: null }],
    });
    appendRunRecord(r1, { dir });
    appendRunRecord(r2, { dir });
    appendRunRecord(r3, { dir });
    const loaded = loadRunRecords(dir);
    assert.equal(loaded.length, 3);

    const flakyCompare = compareExecutions(loaded[2], loaded[1], loaded);
    assert.equal(flakyCompare.flakyTests.length, 1);
    assert.equal(flakyCompare.flakyTests[0].testId, 'flicker');
    assert.equal(flakyCompare.flakyTests[0].status, 'FLAKY');
    assert.equal(flakyCompare.recoveredFailures[0]?.testId, 'flicker');

    const fiveFail = [1, 2, 3, 4, 5].map((n) =>
      buildRunRecord({
        runId: `fail-${n}`,
        timestamp: `2026-02-0${n}T00:00:00.000Z`,
        tests: [{ testEngine: 'e2e', testId: 'always-bad', status: 'FAIL', durationMs: null }],
      })
    );
    const consistent = compareExecutions(fiveFail[4], fiveFail[3], fiveFail);
    assert.equal(consistent.flakyTests.length, 0);
    assert.equal(consistent.newFailures.length, 0);
    assert.equal(consistent.recoveredFailures.length, 0);
  });

  it('duration 100 → 250 → performanceRegressions delta 150; null duration → no row', () => {
    const previous = buildRunRecord({
      runId: 'd1',
      timestamp: '2026-01-01T00:00:00.000Z',
      tests: [
        { testEngine: 'e2e', testId: 'slow', status: 'PASS', durationMs: 100 },
        { testEngine: 'e2e', testId: 'unmeasured', status: 'PASS', durationMs: null },
      ],
    });
    const current = buildRunRecord({
      runId: 'd2',
      timestamp: '2026-01-02T00:00:00.000Z',
      tests: [
        { testEngine: 'e2e', testId: 'slow', status: 'PASS', durationMs: 250 },
        { testEngine: 'e2e', testId: 'unmeasured', status: 'PASS', durationMs: 40 },
      ],
    });
    const comparison = compareExecutions(current, previous);
    assert.equal(comparison.performanceRegressions.length, 1);
    assert.deepEqual(comparison.performanceRegressions[0], {
      testId: 'slow',
      previousMs: 100,
      currentMs: 250,
      deltaMs: 150,
    });
  });

  it('coverage 40 → null → NOT_MEASURED, delta null', () => {
    const previous = buildRunRecord({
      runId: 'c1',
      timestamp: '2026-01-01T00:00:00.000Z',
      coveragePct: 40,
      tests: [{ testEngine: 'e2e', testId: 't', status: 'PASS', durationMs: null }],
    });
    const current = buildRunRecord({
      runId: 'c2',
      timestamp: '2026-01-02T00:00:00.000Z',
      coveragePct: null,
      tests: [{ testEngine: 'e2e', testId: 't', status: 'PASS', durationMs: null }],
    });
    const comparison = compareExecutions(current, previous);
    assert.equal(comparison.coverageChanges.status, 'NOT_MEASURED');
    assert.equal(comparison.coverageChanges.delta, null);

    const md = renderExecutionComparison(comparison);
    assert.match(md, /## coverageChanges/);
    assert.match(md, /NOT_MEASURED/);
  });

  it('previous null: current FAILs as newFailures, no invented baseline', () => {
    const current = buildRunRecord({
      runId: 'solo',
      timestamp: '2026-01-01T00:00:00.000Z',
      tests: [
        { testEngine: 'e2e', testId: 'a', status: 'FAIL', durationMs: null },
        { testEngine: 'e2e', testId: 'b', status: 'PASS', durationMs: null },
        { testEngine: 'e2e', testId: 'c', status: 'BLOCKED', durationMs: null },
      ],
    });
    const comparison = compareExecutions(current, null);
    assert.equal(comparison.previousRunId, null);
    assert.deepEqual(
      comparison.newFailures.map((row) => row.testId),
      ['a']
    );
    assert.deepEqual(comparison.newTests, [
      { testId: 'a', status: 'FAIL' },
      { testId: 'b', status: 'PASS' },
      { testId: 'c', status: 'BLOCKED' },
    ]);
    assert.deepEqual(comparison.recoveredFailures, []);
    assert.deepEqual(comparison.removedTests, []);
    assert.deepEqual(comparison.flakyTests, []);
    assert.deepEqual(comparison.performanceRegressions, []);
    assert.equal(comparison.coverageChanges.status, 'NOT_MEASURED');
    assert.equal(comparison.coverageChanges.delta, null);

    const md = renderExecutionComparison(comparison);
    assert.match(md, /c: BLOCKED/);
    assert.match(md, /a: FAIL/);
    assert.match(md, /b: PASS/);
  });
});
