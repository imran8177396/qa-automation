import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildWorkflowExecutionPlan } from './execution-plan';
import type { QaConfig } from '../types';

describe('workflow execution plan', () => {
  it('records empty correlated workflows as UNCOVERED instead of skipping the stage', () => {
    const plan = buildWorkflowExecutionPlan({ workflows: { correlated: [] } } as unknown as QaConfig);
    const uncovered = plan.gated.find((row) => row.id === 'WF-CORRELATED');
    assert.equal(uncovered?.status, 'UNCOVERED');
    assert.match(uncovered?.reason ?? '', /empty/);
    assert.match(plan.note, /UNCOVERED/);
  });
});
