import { test } from '../../../fixtures/qa-test';
import { resolveResponsivePages } from '../../../scripts/responsive/pages';

const RESPONSIVE_PAGES = resolveResponsivePages();

/**
 * Layout behavior across emulated viewports.
 * Failures include page, viewport, element, expected vs actual, and a screenshot.
 */
test.describe('responsive layout @responsive', () => {
  for (const pageDef of RESPONSIVE_PAGES) {
    test(`${pageDef.name} has no horizontal overflow`, async ({ openResponsive }) => {
      const page = await openResponsive(pageDef);
      await page.expectNoHorizontalOverflow();
    });

    test(`${pageDef.name} landmarks stay in viewport`, async ({ openResponsive }) => {
      const page = await openResponsive(pageDef);
      await page.expectLandmarksInViewport();
    });

    test(`${pageDef.name} has no collapsed containers`, async ({ openResponsive }) => {
      const page = await openResponsive(pageDef);
      await page.expectNoBrokenContainers();
    });

    test(`${pageDef.name} does not clip landmark content`, async ({ openResponsive }) => {
      const page = await openResponsive(pageDef);
      await page.expectNoClippedLandmarks();
    });

    test(`${pageDef.name} cards/grids do not overlap`, async ({ openResponsive }) => {
      const page = await openResponsive(pageDef);
      await page.expectSiblingGroupsDoNotOverlap();
      await page.expectRegionPairDoesNotOverlap('header', 'hero');
      await page.expectRegionPairDoesNotOverlap('hero', 'footer');
      await page.expectRegionPairDoesNotOverlap('header', 'footer');
    });
  }
});
