import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertDiscoveryPrecedesExecution,
  buildStageTimeline,
  isExecutionStageKey,
  stagePhaseForKey,
  type StageTimelineRow,
} from './stage-timeline';

function row(partial: Partial<StageTimelineRow> & Pick<StageTimelineRow, 'key' | 'name' | 'phase'>): StageTimelineRow {
  return {
    id: partial.id ?? 1,
    status: partial.status ?? 'PASS',
    exitCode: partial.exitCode ?? 0,
    startedAt: partial.startedAt ?? '2026-09-09T10:00:00.000Z',
    completedAt: partial.completedAt ?? '2026-09-09T10:01:00.000Z',
    durationMs: partial.durationMs ?? 1000,
    ...partial,
  };
}

describe('stagePhaseForKey', () => {
  it('marks UI/API suites as execution and discovery as discovery', () => {
    assert.equal(stagePhaseForKey('discovery'), 'discovery');
    assert.equal(stagePhaseForKey('inventory'), 'inventory');
    assert.equal(isExecutionStageKey('e2e'), true);
    assert.equal(isExecutionStageKey('report'), false);
    assert.equal(stagePhaseForKey('report'), 'post');
  });
});

describe('assertDiscoveryPrecedesExecution', () => {
  it('passes when discovery completed before every execution start', () => {
    const result = assertDiscoveryPrecedesExecution([
      row({
        id: 2,
        key: 'discovery',
        name: 'Discovery',
        phase: 'discovery',
        startedAt: '2026-09-09T10:00:00.000Z',
        completedAt: '2026-09-09T10:05:00.000Z',
      }),
      row({
        id: 4,
        key: 'e2e',
        name: 'Playwright UI/E2E',
        phase: 'execution',
        startedAt: '2026-09-09T10:06:00.000Z',
        completedAt: '2026-09-09T10:20:00.000Z',
      }),
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.violations, []);
  });

  it('fails when discovery completedAt is after an execution startedAt', () => {
    const result = assertDiscoveryPrecedesExecution([
      row({
        id: 2,
        key: 'discovery',
        name: 'Discovery',
        phase: 'discovery',
        startedAt: '2026-09-09T10:10:00.000Z',
        completedAt: '2026-09-09T10:20:00.000Z',
      }),
      row({
        id: 4,
        key: 'e2e',
        name: 'Playwright UI/E2E',
        phase: 'execution',
        startedAt: '2026-09-09T10:00:00.000Z',
        completedAt: '2026-09-09T10:08:00.000Z',
      }),
    ]);
    assert.equal(result.ok, false);
    assert.match(result.violations[0] ?? '', /after Playwright UI\/E2E startedAt/);
  });

  it('ignores NOT_EXECUTED execution stages', () => {
    const result = assertDiscoveryPrecedesExecution([
      row({
        key: 'discovery',
        name: 'Discovery',
        phase: 'discovery',
        status: 'NOT_EXECUTED',
        startedAt: 'NOT_AVAILABLE',
        completedAt: 'NOT_AVAILABLE',
      }),
      row({
        key: 'e2e',
        name: 'Playwright UI/E2E',
        phase: 'execution',
        status: 'NOT_EXECUTED',
        startedAt: '2026-09-09T10:00:00.000Z',
        completedAt: '2026-09-09T10:00:00.000Z',
      }),
    ]);
    assert.equal(result.ok, true);
  });

  it('fails when execution started but discovery completedAt is missing', () => {
    const result = assertDiscoveryPrecedesExecution([
      row({
        key: 'discovery',
        name: 'Discovery',
        phase: 'discovery',
        status: 'NOT_EXECUTED',
        startedAt: 'NOT_AVAILABLE',
        completedAt: 'NOT_AVAILABLE',
      }),
      row({
        key: 'e2e',
        name: 'Playwright UI/E2E',
        phase: 'execution',
        status: 'PASS',
        startedAt: '2026-09-09T10:00:00.000Z',
        completedAt: '2026-09-09T10:08:00.000Z',
      }),
    ]);
    assert.equal(result.ok, false);
    assert.match(result.violations[0] ?? '', /NOT_AVAILABLE/);
  });
});

describe('buildStageTimeline', () => {
  it('embeds ordering on the exported timeline', () => {
    const timeline = buildStageTimeline([
      row({
        key: 'discovery',
        name: 'Discovery',
        phase: 'discovery',
        completedAt: '2026-09-09T10:05:00.000Z',
      }),
    ]);
    assert.equal(timeline.ordering.ok, true);
    assert.equal(timeline.stages.length, 1);
  });
});
