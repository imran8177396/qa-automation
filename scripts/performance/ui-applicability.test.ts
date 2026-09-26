import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoveryLandingHasLoginForm } from '../lib/discovered-page-targets';
import { isFixtureUiTarget } from '../lib/ui-target';
import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { ApiInventory } from '../discovery/api-observe';
import type { UiInventory } from '../discovery/ui-scan';
import { planUiPerformanceChecks } from './ui-applicability';
import { resolveUiPerformancePage } from './ui-pages';

test('Playwright UI performance applies to login page load and does not invent Sauce Demo REST', () => {
  const plan = planUiPerformanceChecks();
  const byId = Object.fromEntries(plan.map((row) => [row.id, row]));
  const page = resolveUiPerformancePage();

  assert.ok(page, 'a login or homepage target should resolve');
  assert.equal(byId['PERF-UI-page-load']?.status, 'APPLICABLE');
  assert.equal(byId['PERF-UI-navigation']?.status, 'APPLICABLE');
  assert.equal(byId['PERF-UI-resource']?.status, 'APPLICABLE');
  assert.equal(byId['PERF-UI-inp']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['PERF-UI-lighthouse']?.status, 'NOT_APPLICABLE');
  assert.equal(byId['PERF-UI-undocumented-rest']?.status, 'NOT_APPLICABLE');
  assert.match(byId['PERF-UI-undocumented-rest']?.reason ?? '', /urls\.api|undocumented|0 XHR|Fixture target|not invented/i);
  assert.match(byId['PERF-UI-lighthouse']?.reason ?? '', /never fabricated/i);

  if (isFixtureUiTarget()) {
    assert.equal(page?.name, 'login');
    assert.match(page?.path ?? '', /login/i);
    return;
  }

  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const api = readJsonIfExists<ApiInventory>(PATHS.apiInventoryFile);
  if (discoveryLandingHasLoginForm(ui)) {
    assert.equal(page?.name, 'login');
  } else {
    assert.notEqual(
      page?.name,
      'login',
      'do not invent a Sauce Demo login name when no login form was observed'
    );
  }

  const xhrCount =
    api?.calls.filter((call) => {
      const kind = call.resourceType.toLowerCase();
      return kind === 'xhr' || kind === 'fetch';
    }).length ?? 0;
  if (xhrCount > 0) {
    assert.equal(byId['PERF-UI-xhr']?.status, 'APPLICABLE');
  } else {
    assert.equal(byId['PERF-UI-xhr']?.status, 'NOT_APPLICABLE');
    assert.match(byId['PERF-UI-xhr']?.reason ?? '', /0 XHR|not invented/i);
  }
});
