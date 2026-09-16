import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveResponsivePageSet, resolveResponsivePages } from './pages';
import { isFixtureUiTarget } from '../lib/ui-target';

test('live discovery names the login landing page login, not a fixture route', () => {
  const resolved = resolveResponsivePageSet();
  assert.ok(resolved.pages.length > 0, resolved.reason ?? 'no responsive pages');
  assert.deepEqual(
    resolveResponsivePages().map((page) => page.path),
    resolved.pages.map((page) => page.path)
  );
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
