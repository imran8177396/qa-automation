import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFixtureUiTarget } from '../lib/ui-target';
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
  assert.equal(byId['PERF-UI-saucedemo-rest']?.status, 'NOT_APPLICABLE');
  assert.match(byId['PERF-UI-saucedemo-rest']?.reason ?? '', /JSONPlaceholder|no Sauce Demo REST|0 XHR/i);
  assert.match(byId['PERF-UI-lighthouse']?.reason ?? '', /never fabricated/i);

  if (isFixtureUiTarget()) {
    assert.equal(page?.name, 'login');
    assert.match(page?.path ?? '', /login/i);
    return;
  }

  assert.equal(page?.name, 'login');
  assert.equal(byId['PERF-UI-xhr']?.status, 'NOT_APPLICABLE');
  assert.match(byId['PERF-UI-xhr']?.reason ?? '', /0 XHR|not invented/i);
});
