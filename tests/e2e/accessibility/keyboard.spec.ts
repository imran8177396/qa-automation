import { test } from '../../../fixtures/qa-test';
import { resolveAccessibilityPages } from '../../../scripts/accessibility/pages';

const PAGES = resolveAccessibilityPages();

test.describe('keyboard, focus, zoom, touch @accessibility', () => {
  for (const pageDef of PAGES) {
    test(`${pageDef.name} tab order and focus visibility`, async ({ openAccessibility }) => {
      const a11y = await openAccessibility(pageDef);
      await a11y.expectTabOrderAndFocusVisibility();
    });

    test(`${pageDef.name} keyboard interaction without submit`, async ({ openAccessibility }) => {
      const a11y = await openAccessibility(pageDef);
      await a11y.expectKeyboardInteractionWithoutSubmit();
    });

    test(`${pageDef.name} remains usable at 200% Chromium CSS zoom`, async ({ openAccessibility }) => {
      const a11y = await openAccessibility(pageDef);
      await a11y.expectZoomReadable();
    });

    test(`${pageDef.name} touch targets meet 24px minimum where measurable`, async ({ openAccessibility }) => {
      const a11y = await openAccessibility(pageDef);
      await a11y.expectTouchTargets();
    });
  }
});
