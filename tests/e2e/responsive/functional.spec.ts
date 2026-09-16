import { test, expect } from '../../../fixtures/qa-test';
import { resolveResponsivePages } from '../../../scripts/responsive/pages';
import { isFixtureUiTarget } from '../../../scripts/lib/ui-target';

const RESPONSIVE_PAGES = resolveResponsivePages();

/**
 * Functional behavior at each emulated viewport. Forms are filled, never submitted.
 * This is Chromium viewport emulation — not a real device.
 */
test.describe('responsive functional @responsive', () => {
  for (const pageDef of RESPONSIVE_PAGES) {
    test(`${pageDef.name} in-scope navigation works`, async ({ openResponsive }) => {
      const page = await openResponsive(pageDef);
      await page.expectInScopeNavigation();
    });

    test(`${pageDef.name} form is fillable without submit`, async ({ openResponsive }) => {
      const page = await openResponsive(pageDef);
      await page.expectFormFillableWithoutSubmit();
    });
  }

  if (isFixtureUiTarget()) {
    test('mobile menu opens and closes on compact viewports', async ({ openResponsive }) => {
      const page = await openResponsive({ path: '/responsive.html', name: 'responsive-showcase' });
      await page.expectMobileMenuBehavior();
    });

    test('modal opens and closes without a submit', async ({ openResponsive }) => {
      const page = await openResponsive({ path: '/responsive.html', name: 'responsive-showcase' });
      await page.expectModalOpenClose();
    });

    test('dropdown changes value without a submit', async ({ openResponsive }) => {
      const page = await openResponsive({ path: '/responsive.html', name: 'responsive-showcase' });
      await page.expectDropdownChange();
    });
    return;
  }

  test('fixture-only responsive chrome recorded as NOT_TESTED on live origin', () => {
    test.info().annotations.push({
      type: 'NOT_TESTED',
      description:
        'NOT_TESTED: /responsive.html mobile menu, modal, and dropdown are fixture-only. Live responsive layout/functional page checks still execute from discovery. Emulated viewports only — not a real device.',
    });
    expect(
      isFixtureUiTarget(),
      'NOT_TESTED: fixture-only responsive chrome is not executed against a live origin.'
    ).toBe(false);
  });
});
