import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveSuiteStatus, rollupStageGroups } from './suite-status';

describe('resolveSuiteStatus', () => {
  it('resolves zero executed items to NOT_EXECUTED and never PASS', () => {
    assert.equal(resolveSuiteStatus({ executedCount: 0 }), 'NOT_EXECUTED');
    assert.equal(resolveSuiteStatus({ executedCount: 0, passedCount: 0, failedCount: 0 }), 'NOT_EXECUTED');
    assert.notEqual(resolveSuiteStatus({ executedCount: 0, passedCount: 5 }), 'PASS');
  });

  it('resolves dry-run with zero selected to NOT_EXECUTED', () => {
    assert.equal(
      resolveSuiteStatus({ executedCount: 0, dryRun: true, selectedCount: 0 }),
      'NOT_EXECUTED'
    );
  });

  it('keeps DRY_RUN when candidates were selected but nothing ran', () => {
    assert.equal(
      resolveSuiteStatus({ executedCount: 0, dryRun: true, selectedCount: 3 }),
      'DRY_RUN'
    );
  });

  it('keeps RECORDED when items were recorded but nothing executed', () => {
    assert.equal(
      resolveSuiteStatus({ executedCount: 0, recorded: true, selectedCount: 2 }),
      'RECORDED'
    );
  });

  it('fails a zero-item suite when the process itself failed', () => {
    assert.equal(resolveSuiteStatus({ executedCount: 0, processFailed: true }), 'FAIL');
  });

  it('returns INVALID when marked invalid', () => {
    assert.equal(resolveSuiteStatus({ executedCount: 4, invalid: true }), 'INVALID');
  });

  it('returns PASS only when items executed and none failed', () => {
    assert.equal(resolveSuiteStatus({ executedCount: 3, passedCount: 3, failedCount: 0 }), 'PASS');
  });

  it('returns FAIL when every executed item failed', () => {
    assert.equal(resolveSuiteStatus({ executedCount: 2, passedCount: 0, failedCount: 2 }), 'FAIL');
  });

  it('returns PARTIAL when some executed items passed and some failed', () => {
    assert.equal(resolveSuiteStatus({ executedCount: 4, passedCount: 2, failedCount: 2 }), 'PARTIAL');
  });
});

describe('rollupStageGroups', () => {
  it('lists passed, failed, and not-executed as three separate groups', () => {
    const rollup = rollupStageGroups([
      { name: 'Playwright UI/E2E', status: 'PASS' },
      { name: 'API testing', status: 'FAIL' },
      { name: 'Visual testing', status: 'NOT_EXECUTED' },
      { name: 'Controlled retest', status: 'DRY_RUN' },
      { name: 'Failure analysis', status: 'RECORDED' },
      { name: 'SEO QA', status: 'PARTIAL' },
    ]);
    assert.deepEqual(rollup.passed, ['Playwright UI/E2E']);
    assert.deepEqual(rollup.failed, ['API testing', 'SEO QA']);
    assert.deepEqual(rollup.notExecuted, ['Visual testing', 'Controlled retest', 'Failure analysis']);
  });

  it('never counts NOT_EXECUTED toward passed stages', () => {
    const rollup = rollupStageGroups([
      { name: 'Visual testing', status: 'NOT_EXECUTED' },
      { name: 'Retest', status: 'DRY_RUN' },
    ]);
    assert.deepEqual(rollup.passed, []);
    assert.equal(rollup.notExecuted.length, 2);
  });
});
