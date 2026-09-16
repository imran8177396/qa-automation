import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVisualPages } from './pages';
import { isFixtureUiTarget } from '../lib/ui-target';

test('live discovery names the login landing page login, not a fixture route', () => {
  const resolved = resolveVisualPages();
  assert.ok(resolved.pages.length > 0, resolved.reason ?? 'no visual pages');
  if (isFixtureUiTarget()) {
    assert.equal(resolved.source, 'fixture');
    assert.ok(resolved.pages.some((page) => page.path === '/' && page.name === 'home'));
    return;
  }
  if (resolved.source === 'discovery') {
    assert.ok(resolved.pages.some((page) => page.path === '/' && page.name === 'login'));
    assert.ok(!resolved.pages.some((page) => /inventory|cart/i.test(page.path)));
  }
});
