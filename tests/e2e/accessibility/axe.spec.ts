import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolveAccessibilityRoutes } from '../../../scripts/accessibility/routes';

const ROUTES = resolveAccessibilityRoutes();

test('accessibility route list is not empty', () => {
  expect(ROUTES.length, 'REQUIRES_CONFIGURATION: no accessibility routes resolved').toBeGreaterThan(0);
});

for (const route of ROUTES) {
  test(`axe scan ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((row) => row.impact === 'critical' || row.impact === 'serious');
    expect(blocking).toEqual([]);
  });
}

test('keyboard — first tab moves focus', async ({ page }) => {
  await page.goto(ROUTES[0] ?? '/');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});
