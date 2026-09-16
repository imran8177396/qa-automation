import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAccessibilityChecks, plannedNotApplicableReason } from './applicability';
import { isFixtureUiTarget } from '../lib/ui-target';

test('live origin plans login a11y and does not invent nav/tables/images or WCAG certification', () => {
  if (isFixtureUiTarget()) {
    const plan = planAccessibilityChecks();
    assert.ok(plan.some((row) => row.id === 'A11Y-axe' && row.status === 'APPLICABLE'));
    assert.ok(plan.some((row) => row.id === 'A11Y-login-live' && row.status === 'NOT_APPLICABLE'));
    assert.ok(plan.some((row) => row.id === 'A11Y-wcag-certification' && row.status === 'NOT_APPLICABLE'));
    assert.match(plan.find((row) => row.id === 'A11Y-wcag-certification')?.reason ?? '', /not a complete manual WCAG/i);
    return;
  }

  const plan = planAccessibilityChecks();
  const byId = Object.fromEntries(plan.map((row) => [row.id, row]));

  assert.equal(byId['A11Y-axe']?.status, 'APPLICABLE');
  assert.equal(byId['A11Y-keyboard']?.status, 'APPLICABLE');
  assert.equal(byId['A11Y-focus']?.status, 'APPLICABLE');
  assert.equal(byId['A11Y-contrast']?.status, 'APPLICABLE');
  assert.equal(byId['A11Y-navigation']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['A11Y-tables']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['A11Y-images']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['A11Y-form-errors']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['A11Y-wcag-certification']?.status, 'NOT_APPLICABLE');
  assert.match(byId['A11Y-wcag-certification']?.reason ?? '', /not a complete manual WCAG/i);
  assert.match(byId['A11Y-form-errors']?.reason ?? '', /does not click Login/i);
  assert.match(plannedNotApplicableReason('navigation') ?? '', /nav|navigation/i);
  assert.match(plannedNotApplicableReason('table') ?? '', /table/i);
  assert.match(plannedNotApplicableReason('image') ?? '', /img|image/i);
  assert.ok(!plan.some((row) => /inventory|cart/i.test(row.name) && row.status === 'APPLICABLE'));
});
