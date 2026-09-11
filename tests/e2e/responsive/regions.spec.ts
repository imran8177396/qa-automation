import { test } from '../../../fixtures/qa-test';
import { resolveResponsivePages } from '../../../scripts/responsive/pages';

const RESPONSIVE_PAGES = resolveResponsivePages();

/**
 * Region presence + layout sanity. Missing chrome on a simple page is NOT_APPLICABLE, not a fail.
 */
test.describe('responsive regions @responsive', () => {
  for (const pageDef of RESPONSIVE_PAGES) {
    test(`${pageDef.name} header / nav / footer / hero / media`, async ({ openResponsive }) => {
      const page = await openResponsive(pageDef);
      await page.expectApplicableRegionVisible('header', page.header);
      await page.expectNavigationChrome();
      await page.expectApplicableRegionVisible('hero', page.hero);
      await page.expectApplicableRegionVisible('cards', page.cards);
      await page.expectApplicableRegionVisible('grid', page.grid);
      await page.expectApplicableRegionVisible('form', page.form);
      await page.expectApplicableRegionVisible('table', page.table);
      await page.expectApplicableRegionVisible('footer', page.footer);
      await page.expectImagesLoadedAndContained();
      await page.expectButtonsUsable();
      await page.expectReadableTypography();
    });
  }
});
