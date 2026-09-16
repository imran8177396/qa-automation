import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planVisualChecks } from './applicability';
import { isFixtureUiTarget } from '../lib/ui-target';

test('live origin plans login visuals and does not invent cart/inventory', () => {
  if (isFixtureUiTarget()) {
    const plan = planVisualChecks();
    assert.ok(plan.some((row) => row.id === 'VIS-fixture-pages' && row.status === 'APPLICABLE'));
    assert.ok(plan.some((row) => row.id === 'VIS-login-live' && row.status === 'NOT_APPLICABLE'));
    return;
  }

  const plan = planVisualChecks();
  const byId = Object.fromEntries(plan.map((row) => [row.id, row]));

  assert.equal(byId['VIS-login-full']?.status, 'APPLICABLE');
  assert.equal(byId['VIS-login-form']?.status, 'APPLICABLE');
  assert.equal(byId['VIS-login-heading']?.status, 'APPLICABLE');
  assert.equal(byId['VIS-inventory']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['VIS-cart']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['VIS-navigation']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['VIS-images']?.status, 'NOT_APPLICABLE');
  assert.match(byId['VIS-inventory']?.reason ?? '', /not discovered|auth/i);
  assert.ok(!plan.some((row) => /inventory|cart/i.test(row.name) && row.status === 'APPLICABLE'));
});
