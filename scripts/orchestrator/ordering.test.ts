import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executionGate, isExecutionStage } from './ordering';
import type { StageResult } from './types';

function stage(partial: Partial<StageResult> & Pick<StageResult, 'key' | 'status'>): StageResult {
  return {
    id: 2,
    name: partial.key,
    exitCode: 0,
    startedAt: '2026-09-09T10:00:00.000Z',
    finishedAt: '2026-09-09T10:01:00.000Z',
    completedAt: '2026-09-09T10:01:00.000Z',
    durationMs: 1000,
    ...partial,
  };
}

describe('executionGate', () => {
  it('blocks execution when discovery did not run', () => {
    const gate = executionGate([
      stage({ key: 'discovery', name: 'Discovery', status: 'NOT_EXECUTED' }),
    ]);
    assert.equal(gate.ok, false);
    assert.match(gate.reason, /Discovery has not completed/);
  });

  it('treats e2e as an execution stage', () => {
    assert.equal(isExecutionStage('e2e'), true);
    assert.equal(isExecutionStage('discovery'), false);
  });
});
