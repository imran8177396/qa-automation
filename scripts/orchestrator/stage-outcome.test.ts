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

  it('does not treat a skipped stage as PASS', () => {
    const outcome = resolveStageOutcome({
      key: 'visual',
      processStatus: 'NOT_EXECUTED',
      processFailed: false,
    });
    assert.equal(outcome.status, 'NOT_EXECUTED');
  });

  it('resolves missing retest artifact (zero executed) to NOT_EXECUTED', () => {
    const outcome = resolveStageOutcome({
      key: 'retest',
      processStatus: 'PASS',
      processFailed: false,
    });
    assert.equal(outcome.status, 'NOT_EXECUTED');
    assert.equal(outcome.executedCount, 0);
  });
});
