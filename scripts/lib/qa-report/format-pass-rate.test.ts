import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertionPassRate, uiExecutionPassRate } from '../pass-rate';
import { NOT_AVAILABLE, formatLabelledPassRate } from './format-pass-rate';

test('UI execution pass rate excludes skipped and names the denominator', () => {
  const formatted = formatLabelledPassRate(uiExecutionPassRate({ passed: 5, failed: 4, skipped: 1 }), {
    skipped: 1,
  });
  assert.equal(formatted, '55.6% (5/9 UI executions, 1 skipped excluded)');
});

test('assertion pass rate names assertion denominator', () => {
  const formatted = formatLabelledPassRate(assertionPassRate({ passed: 12, executed: 15 }));
  assert.equal(formatted, '80% (12/15 assertions)');
});

test('zero denominator is NOT_AVAILABLE', () => {
  assert.equal(formatLabelledPassRate(uiExecutionPassRate({ passed: 0, failed: 0, skipped: 3 })), NOT_AVAILABLE);
});
