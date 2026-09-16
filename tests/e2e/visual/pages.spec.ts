import { test, expect } from '../../../fixtures/qa-test';
import { resolveVisualPages } from '../../../scripts/visual/pages';

const resolved = resolveVisualPages();

/**
 * Full-page visual checks. Live targets use discovery pages; fixture HTML is
 * not substituted when a live origin is configured.
 */
test.describe('visual pages @visual', () => {
  test(`visual page source is ${resolved.source}`, () => {
    expect(resolved.pages.length, resolved.reason ?? 'visual page list is empty').toBeGreaterThan(0);
  });

  for (const pageDef of resolved.pages) {
    test(`${pageDef.name} layout is consistent`, async ({ visualPage }) => {
      await visualPage.open(pageDef.path);
      await visualPage.expectPageScreenshot(`${resolved.source}-${pageDef.name}-full.png`);
    });
  }

  if (resolved.source !== 'fixture') {
    for (const pageDef of resolved.pages) {
      test(`${pageDef.name} layout at 375px is consistent`, async ({ visualPage }) => {
        await visualPage.open(pageDef.path, { width: 375, height: 667 });
        await visualPage.expectPageScreenshot(`${resolved.source}-${pageDef.name}-full-375.png`);
      });
    }
  }
});
