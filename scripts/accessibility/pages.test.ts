import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_A11Y_PAGES, resolveAccessibilityPageSet, resolveAccessibilityPages } from './pages';
import { resolveAccessibilityRoutes } from './routes';
import { isFixtureUiTarget } from '../lib/ui-target';

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
    assert.ok(resolved.pages.some((page) => page.path === '/' && page.name === 'login'));
    assert.ok(!resolved.pages.some((page) => /inventory|cart/i.test(page.path)));
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
