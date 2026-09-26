import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planResponsiveChecks, plannedNotApplicableReason } from './applicability';
import { discoveryLandingHasLoginForm } from '../lib/discovered-page-targets';
import { isFixtureUiTarget } from '../lib/ui-target';
import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';

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
  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const formObserved =
    discoveryLandingHasLoginForm(ui) ||
    Boolean(ui?.categoryStatus.some((row) => row.category === 'form' && row.status === 'DISCOVERED'));
  const buttonObserved = Boolean(
    ui?.categoryStatus.some((row) => row.category === 'button' && row.status === 'DISCOVERED')
  );
  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  const headingObserved = Boolean(
    pageMap?.pages.some((page) => (page.headings && page.headings.length > 0) || page.h1s.length > 0)
  );
  assert.equal(byId['RESP-form']?.status, formObserved ? 'APPLICABLE' : 'NOT_APPLICABLE');
  assert.equal(byId['RESP-buttons']?.status, buttonObserved ? 'APPLICABLE' : 'NOT_APPLICABLE');
  assert.equal(
    byId['RESP-typography']?.status,
    headingObserved || formObserved ? 'APPLICABLE' : 'NOT_APPLICABLE'
  );
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
