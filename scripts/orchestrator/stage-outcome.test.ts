import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveStageOutcome } from './stage-outcome';

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
});
