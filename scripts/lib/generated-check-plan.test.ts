import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveGeneratedCheckPlan } from './generated-check-plan';

describe('resolveGeneratedCheckPlan', () => {
  it('records an absent plan as NOT_EXECUTED with 0 checks', () => {
    const plan = resolveGeneratedCheckPlan(null);
    assert.equal(plan.execute, false);
    assert.equal(plan.checkCount, 0);
    assert.match(plan.reason ?? '', /NOT_EXECUTED/);
    assert.match(plan.reason ?? '', /absent/);
  });

  it('records an empty array as NOT_EXECUTED with 0 checks', () => {
    const plan = resolveGeneratedCheckPlan([]);
    assert.equal(plan.execute, false);
    assert.equal(plan.checkCount, 0);
    assert.match(plan.reason ?? '', /empty/);
  });

  it('records a non-array payload as NOT_EXECUTED, not a FAIL', () => {
    const plan = resolveGeneratedCheckPlan({ leftover: true });
    assert.equal(plan.execute, false);
    assert.equal(plan.checkCount, 0);
    assert.match(plan.reason ?? '', /not an array/);
  });

  it('executes when planned checks are present', () => {
    const plan = resolveGeneratedCheckPlan([{ id: 'CHK-1' }]);
    assert.equal(plan.execute, true);
    assert.equal(plan.checkCount, 1);
    assert.equal(plan.reason, undefined);
  });
});
