import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NO_SKIP_POLICY_STATEMENT,
  isExplicitNonExecutionStatus,
  resolveExhaustiveExecutionPolicy,
} from './no-skip-policy';

describe('exhaustive execution policy', () => {
  it('defaults to enabled when pipeline flags are omitted', () => {
    const policy = resolveExhaustiveExecutionPolicy();
    assert.equal(policy.enabled, true);
    assert.equal(policy.honorConfiguredBrowsers, true);
    assert.equal(policy.requireLiveUiWhenConfigured, true);
    assert.match(NO_SKIP_POLICY_STATEMENT, /not silently skip/i);
  });

  it('disables only when exhaustiveExecution is explicitly false', () => {
    assert.equal(resolveExhaustiveExecutionPolicy({ exhaustiveExecution: false }).enabled, false);
  });

  it('treats BLOCKED / NOT_TESTED / REQUIRES_CONFIGURATION as explicit non-execution', () => {
    assert.equal(isExplicitNonExecutionStatus('BLOCKED'), true);
    assert.equal(isExplicitNonExecutionStatus('NOT_TESTED'), true);
    assert.equal(isExplicitNonExecutionStatus('REQUIRES_CONFIGURATION'), true);
    assert.equal(isExplicitNonExecutionStatus('SKIPPED'), false);
    assert.equal(isExplicitNonExecutionStatus('PASS'), false);
  });
});
