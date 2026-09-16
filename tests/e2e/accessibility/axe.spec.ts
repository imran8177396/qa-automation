import { test, expect } from '../../../fixtures/qa-test';
import { resolveAccessibilityPages } from '../../../scripts/accessibility/pages';
import { resolveAccessibilityRoutes } from '../../../scripts/accessibility/routes';

const PAGES = resolveAccessibilityPages();
const ROUTES = resolveAccessibilityRoutes();

test('accessibility route list is not empty', () => {
  expect(ROUTES.length, 'REQUIRES_CONFIGURATION: no accessibility routes resolved').toBeGreaterThan(0);
});

for (const pageDef of PAGES) {
  test(`axe scan ${pageDef.path}`, async ({ openAccessibility }) => {
    const a11y = await openAccessibility(pageDef);
    await a11y.expectLoaded();
    await a11y.expectNoAxeViolations();
  });
}

test('keyboard — first tab moves focus', async ({ openAccessibility }) => {
  const a11y = await openAccessibility(PAGES[0] ?? { path: '/', name: 'home' });
  await a11y.expectFirstTabMovesFocus();
});
