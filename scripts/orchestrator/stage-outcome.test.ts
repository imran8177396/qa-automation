import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PATHS } from '../lib/paths';
import {
  countsFromEngineSummary,
  resolveStageOutcome,
} from './stage-outcome';

describe('countsFromEngineSummary', () => {
  it('does not treat NOT_TESTED / REQUIRES_CONFIGURATION-only tallies as PASS counts', () => {
    const counts = countsFromEngineSummary({
      passCount: 0,
      failCount: 0,
      notTestedCount: 3,
      requiresConfigurationCount: 2,
      blockedCount: 1,
      skippedCount: 1,
    });
    assert.equal(counts.executedCount, 0);
    assert.equal(counts.passedCount, 0);
    assert.equal(counts.failedCount, 0);
  });

  it('keeps FAIL and PASS rows as executed', () => {
    const failOnly = countsFromEngineSummary({ passCount: 0, failCount: 2 });
    assert.equal(failOnly.executedCount, 2);
    assert.equal(failOnly.failedCount, 2);
    assert.equal(failOnly.passedCount, 0);

    const passOnly = countsFromEngineSummary({ passCount: 4, failCount: 0 });
    assert.equal(passOnly.executedCount, 4);
    assert.equal(passOnly.passedCount, 4);
    assert.equal(passOnly.failedCount, 0);
  });
});

describe('resolveStageOutcome', () => {
  it('keeps INVALID when the process could not launch', () => {
    const outcome = resolveStageOutcome({
      key: 'e2e',
      processStatus: 'INVALID',
      processFailed: true,
    });
    assert.equal(outcome.status, 'INVALID');
  });

  it('records Allure generate failure as BLOCKED not PASS', () => {
    const outcome = resolveStageOutcome({
      key: 'allure',
      processStatus: 'FAIL',
      processFailed: true,
    });
    assert.notEqual(outcome.status, 'PASS');
    assert.ok(outcome.status === 'BLOCKED' || outcome.status === 'NOT_EXECUTED' || outcome.status === 'FAIL');
  });

  it('does not treat a skipped stage as PASS', () => {
    const outcome = resolveStageOutcome({
      key: 'visual',
      processStatus: 'NOT_EXECUTED',
      processFailed: false,
    });
    assert.equal(outcome.status, 'NOT_EXECUTED');
  });

  it('does not roll remaining retest FAILs up as PASS', () => {
    const outcome = resolveStageOutcome({
      key: 'retest',
      processStatus: 'PASS',
      processFailed: false,
    });
    if ((outcome.executedCount ?? 0) === 0) {
      assert.equal(outcome.status, 'NOT_EXECUTED');
      assert.equal(outcome.executedCount, 0);
      return;
    }
    assert.notEqual(outcome.status, 'PASS');
  });

  it('opt-in smoke without summary is NOT_EXECUTED, not PASS', () => {
    const summaryPath = path.join(PATHS.reports.smoke, 'summary.json');
    const previous = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath) : null;
    try {
      if (fs.existsSync(summaryPath)) fs.unlinkSync(summaryPath);
      const outcome = resolveStageOutcome({
        key: 'smoke',
        processStatus: 'PASS',
        processFailed: false,
      });
      assert.equal(outcome.status, 'NOT_EXECUTED');
      assert.notEqual(outcome.status, 'PASS');
    } finally {
      if (previous) {
        fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
        fs.writeFileSync(summaryPath, previous);
      }
    }
  });

  it('opt-in smoke NOT_TESTED-only summary is not PASS; FAIL stays FAIL; PASS stays PASS', () => {
    const summaryPath = path.join(PATHS.reports.smoke, 'summary.json');
    const previous = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath) : null;
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    try {
      fs.writeFileSync(
        summaryPath,
        JSON.stringify({
          passCount: 0,
          failCount: 0,
          notTestedCount: 4,
          requiresConfigurationCount: 1,
          blockedCount: 0,
          skippedCount: 0,
        })
      );
      const gated = resolveStageOutcome({
        key: 'smoke',
        processStatus: 'PASS',
        processFailed: false,
      });
      assert.notEqual(gated.status, 'PASS');
      assert.ok(gated.status === 'NOT_EXECUTED' || gated.status === 'BLOCKED');

      fs.writeFileSync(
        summaryPath,
        JSON.stringify({ passCount: 0, failCount: 2, notTestedCount: 1 })
      );
      const failed = resolveStageOutcome({
        key: 'smoke',
        processStatus: 'PASS',
        processFailed: false,
      });
      assert.equal(failed.status, 'FAIL');

      fs.writeFileSync(
        summaryPath,
        JSON.stringify({ passCount: 3, failCount: 0, notTestedCount: 1 })
      );
      const passed = resolveStageOutcome({
        key: 'smoke',
        processStatus: 'PASS',
        processFailed: false,
      });
      assert.equal(passed.status, 'PASS');
    } finally {
      if (previous) fs.writeFileSync(summaryPath, previous);
      else if (fs.existsSync(summaryPath)) fs.unlinkSync(summaryPath);
    }
  });

  it('security stage counts FAIL findings so the stage is not PASS', () => {
    const summaryPath = path.join(PATHS.reports.security, 'summary.json');
    const previous = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath) : null;
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    try {
      fs.writeFileSync(
        summaryPath,
        JSON.stringify({
          pagesAnalyzed: 2,
          passCount: 1,
          failCount: 3,
          findings: [{ status: 'FAIL' }, { status: 'FAIL' }, { status: 'FAIL' }, { status: 'PASS' }],
        })
      );
      const outcome = resolveStageOutcome({
        key: 'security',
        processStatus: 'PASS',
        processFailed: false,
      });
      assert.equal(outcome.status, 'PARTIAL');
      assert.notEqual(outcome.status, 'PASS');
    } finally {
      if (previous) fs.writeFileSync(summaryPath, previous);
      else if (fs.existsSync(summaryPath)) fs.unlinkSync(summaryPath);
    }
  });
});
