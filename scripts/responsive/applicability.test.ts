import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planResponsiveChecks, plannedNotApplicableReason } from './applicability';
import { isFixtureUiTarget } from '../lib/ui-target';

test('live origin plans login viewports and does not invent header/nav/hero/devices', () => {
  if (isFixtureUiTarget()) {
    const plan = planResponsiveChecks();
    assert.ok(plan.some((row) => row.id === 'RESP-overflow' && row.status === 'APPLICABLE'));
    assert.ok(plan.some((row) => row.id === 'RESP-login-live' && row.status === 'NOT_APPLICABLE'));
    assert.ok(plan.some((row) => row.id === 'RESP-real-device' && row.status === 'NOT_APPLICABLE'));
    assert.match(plan.find((row) => row.id === 'RESP-real-device')?.reason ?? '', /not a real device/i);
    return;
  }

  const plan = planResponsiveChecks();
  const byId = Object.fromEntries(plan.map((row) => [row.id, row]));

  assert.equal(byId['RESP-overflow']?.status, 'APPLICABLE');
  assert.equal(byId['RESP-form']?.status, 'APPLICABLE');
  assert.equal(byId['RESP-buttons']?.status, 'APPLICABLE');
  assert.equal(byId['RESP-typography']?.status, 'APPLICABLE');
  assert.equal(byId['RESP-header']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['RESP-navigation']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['RESP-mobile-menu']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['RESP-hero']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['RESP-cards']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['RESP-grid']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['RESP-table']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['RESP-images']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['RESP-footer']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['RESP-modal']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['RESP-dropdown']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['RESP-inventory-cart']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['RESP-real-device']?.status, 'NOT_APPLICABLE');
  assert.match(byId['RESP-real-device']?.reason ?? '', /emulated viewport/i);
  assert.match(byId['RESP-real-device']?.reason ?? '', /not a real device/i);
  assert.doesNotMatch(byId['RESP-real-device']?.reason ?? '', /covered on a real iPhone|real Android device ran/i);
  assert.match(plannedNotApplicableReason('header') ?? '', /header|banner/i);
  assert.ok(!plan.some((row) => /inventory|cart/i.test(row.name) && row.status === 'APPLICABLE'));
});
