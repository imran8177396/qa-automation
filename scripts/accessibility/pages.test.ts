import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_A11Y_PAGES, resolveAccessibilityPageSet, resolveAccessibilityPages } from './pages';
import { resolveAccessibilityRoutes } from './routes';
import { discoveryLandingHasLoginForm } from '../lib/discovered-page-targets';
import { isFixtureUiTarget } from '../lib/ui-target';
import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { UiInventory } from '../discovery/ui-scan';

test('live discovery names the login landing page login, not a fixture route', () => {
  const resolved = resolveAccessibilityPageSet();
  assert.ok(resolved.pages.length > 0, resolved.reason ?? 'no accessibility pages');
  if (isFixtureUiTarget()) {
    assert.equal(resolved.source, 'fixture');
    assert.ok(resolved.pages.some((page) => page.path === '/' && page.name === 'home'));
    assert.ok(resolved.pages.some((page) => page.path === '/a11y-defects.html'));
    return;
  }
  assert.ok(!resolved.pages.some((page) => page.path === '/a11y-defects.html'));
  if (resolved.source === 'discovery') {
    const landing = resolved.pages.find((page) => page.path === '/' || page.path === '');
    assert.ok(landing, 'discovery must include the seed path');
    const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
    if (discoveryLandingHasLoginForm(ui)) {
      assert.equal(landing.name, 'login');
    } else {
      assert.notEqual(
        landing.name,
        'login',
        'do not invent a Sauce Demo login name when no login form was observed'
      );
    }
  }
});

test('resolveAccessibilityRoutes matches page paths', () => {
  const pages = resolveAccessibilityPages();
  assert.deepEqual(
    resolveAccessibilityRoutes(),
    pages.map((page) => page.path)
  );
  if (isFixtureUiTarget()) {
    assert.ok(FIXTURE_A11Y_PAGES.every((page) => pages.some((row) => row.path === page.path)));
  }
});
