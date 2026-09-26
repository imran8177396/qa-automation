import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planVisualChecks } from './applicability';
import { discoveryLandingHasLoginForm } from '../lib/discovered-page-targets';
import { isFixtureUiTarget } from '../lib/ui-target';
import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { UiInventory } from '../discovery/ui-scan';

test('live origin plans login visuals and does not invent cart/inventory', () => {
  if (isFixtureUiTarget()) {
    const plan = planVisualChecks();
    assert.ok(plan.some((row) => row.id === 'VIS-fixture-pages' && row.status === 'APPLICABLE'));
    assert.ok(plan.some((row) => row.id === 'VIS-login-live' && row.status === 'NOT_APPLICABLE'));
    return;
  }

  const plan = planVisualChecks();
  const byId = Object.fromEntries(plan.map((row) => [row.id, row]));
  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);

  assert.equal(byId['VIS-login-full']?.status, 'APPLICABLE');
  if (discoveryLandingHasLoginForm(ui)) {
    assert.equal(byId['VIS-login-form']?.status, 'APPLICABLE');
  } else {
    assert.equal(
      byId['VIS-login-form']?.status,
      'NOT_APPLICABLE',
      'NOT_APPLICABLE: last live inventory has no login form — Sauce Demo login-form visuals are not invented'
    );
  }
  assert.equal(byId['VIS-inventory']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['VIS-cart']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['VIS-navigation']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['VIS-images']?.status, 'NOT_APPLICABLE');
  assert.match(byId['VIS-inventory']?.reason ?? '', /not discovered|auth/i);
  assert.ok(!plan.some((row) => /inventory|cart/i.test(row.name) && row.status === 'APPLICABLE'));
});
