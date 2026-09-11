import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ASSERTION_PASS_RATE_SCOPE,
  UI_EXECUTION_PASS_RATE_SCOPE,
  assertNoConflictingRates,
  assertionPassRate,
  uiExecutionPassRate,
} from './pass-rate';

test('uiExecutionPassRate excludes skipped: 5 passed, 4 failed, 1 skipped → 5/9 ≈ 55.6%', () => {
  const rate = uiExecutionPassRate({ passed: 5, failed: 4, skipped: 1 });
  assert.equal(rate.scope, UI_EXECUTION_PASS_RATE_SCOPE);
  assert.equal(rate.numerator, 5);
  assert.equal(rate.denominator, 9);
  assert.equal(rate.excludesSkipped, true);
  assert.equal(rate.value, 55.6);
  assert.notEqual(rate.denominator, 10);
  assert.notEqual(rate.value, 50);
  assert.notEqual(rate.value, 50.0);
});

test('assertionPassRate uses assertion counts, not executions', () => {
  const executionsPassed = 5;
  const executionsFailed = 4;
  const executionsSkipped = 1;
  const assertionsPassed = 12;
  const assertionsExecuted = 15;

  const assertions = assertionPassRate({ passed: assertionsPassed, executed: assertionsExecuted });
  const executions = uiExecutionPassRate({
    passed: executionsPassed,
    failed: executionsFailed,
    skipped: executionsSkipped,
  });

  assert.equal(assertions.scope, ASSERTION_PASS_RATE_SCOPE);
  assert.equal(assertions.numerator, 12);
  assert.equal(assertions.denominator, 15);
  assert.equal(assertions.excludesSkipped, false);
  assert.equal(assertions.value, 80);
  assert.notEqual(assertions.numerator, executionsPassed);
  assert.notEqual(assertions.denominator, executionsPassed + executionsFailed);
  assert.notEqual(assertions.denominator, executionsPassed + executionsFailed + executionsSkipped);
  assert.notEqual(assertions.value, executions.value);
});

test('assertNoConflictingRates throws when the same scope label differs', () => {
  const a = uiExecutionPassRate({ passed: 5, failed: 4, skipped: 1 });
  const conflicting = uiExecutionPassRate({ passed: 5, failed: 5, skipped: 0 });
  assert.equal(a.scope, conflicting.scope);
  assert.notEqual(a.value, conflicting.value);
  assert.throws(
    () => assertNoConflictingRates([a, conflicting]),
    /Conflicting pass rates for scope "uiExecutionPassRate"/
  );
});

test('assertNoConflictingRates allows identical rates and different scopes', () => {
  const ui = uiExecutionPassRate({ passed: 5, failed: 4, skipped: 1 });
  const uiAgain = uiExecutionPassRate({ passed: 5, failed: 4, skipped: 1 });
  const assertions = assertionPassRate({ passed: 12, executed: 15 });
  assert.doesNotThrow(() => assertNoConflictingRates([ui, uiAgain, assertions]));
});
