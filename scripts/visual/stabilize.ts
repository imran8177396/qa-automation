import type { Page } from '@playwright/test';

/**
 * Reduce screenshot flake from animation, caret blink, and webfont swap.
 * Does not hide application content or invent a different layout.
 */
export async function stabilizeForVisual(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('domcontentloaded');
}
