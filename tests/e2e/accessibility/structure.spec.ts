import { test } from '../../../fixtures/qa-test';
import { resolveAccessibilityPages } from '../../../scripts/accessibility/pages';

const PAGES = resolveAccessibilityPages();

test.describe('labels, headings, ARIA, absent chrome @accessibility', () => {
  for (const pageDef of PAGES) {
    test(`${pageDef.name} programmatic form labels`, async ({ openAccessibility }) => {
      const a11y = await openAccessibility(pageDef);
      await a11y.expectProgrammaticLabels();
    });

    test(`${pageDef.name} heading structure`, async ({ openAccessibility }) => {
      const a11y = await openAccessibility(pageDef);
      await a11y.expectHeadingStructure();
    });

    test(`${pageDef.name} landmarks and ARIA`, async ({ openAccessibility }) => {
      const a11y = await openAccessibility(pageDef);
      await a11y.expectLandmarksAndAria();
    });

    test(`${pageDef.name} form errors without submit`, async ({ openAccessibility }) => {
      const a11y = await openAccessibility(pageDef);
      await a11y.expectFormErrorsWithoutSubmit();
    });

    test(`${pageDef.name} undiscovered chrome is NOT_APPLICABLE`, async ({ openAccessibility }) => {
      const a11y = await openAccessibility(pageDef);
      await a11y.recordAbsentChrome();
      await a11y.expectImageAltsWhenPresent();
    });
  }
});
