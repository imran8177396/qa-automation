import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVisualPages } from './pages';
import { discoveryLandingHasLoginForm } from '../lib/discovered-page-targets';
import { isFixtureUiTarget } from '../lib/ui-target';
import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { UiInventory } from '../discovery/ui-scan';

test('live discovery names the login landing page login, not a fixture route', () => {
  const resolved = resolveVisualPages();
  assert.ok(resolved.pages.length > 0, resolved.reason ?? 'no visual pages');
  if (isFixtureUiTarget()) {
    assert.equal(resolved.source, 'fixture');
    assert.ok(resolved.pages.some((page) => page.path === '/' && page.name === 'home'));
    return;
  }
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
