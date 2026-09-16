import { test } from '../../../fixtures/qa-test';
import { isFixtureUiTarget } from '../../../scripts/lib/ui-target';

/**
 * Geometry on the observed login page: overlap, clipping, collapsed containers,
 * unexpected movement. Missing <img>, cart, and inventory are NOT_APPLICABLE —
 * those pages were not discovered and are not invented.
 */
test.describe('visual layout @visual', () => {
  if (isFixtureUiTarget()) {
    test('live-origin login layout checks are not run against the fixture', () => {
      test.skip(true, 'Login-page layout assertions apply to the live discovery target.');
    });
    return;
  }

  test('login form and heading do not overlap or collapse', async ({ visualPage }) => {
    await visualPage.open('/');
    await visualPage.expectRegionIntact(visualPage.loginForm.root, 'login form');
    await visualPage.expectRegionIntact(visualPage.observedHeading, 'observed heading');
    await visualPage.expectRegionNotClipped(visualPage.loginForm.root, 'login form');
    await visualPage.expectRegionsDoNotOverlap(
      visualPage.loginForm.root,
      visualPage.observedHeading,
      'login form vs observed heading'
    );
  });

  test('login form does not move after stabilize', async ({ visualPage }) => {
    await visualPage.open('/');
    await visualPage.expectNoUnexpectedMovement(visualPage.loginForm.root, 'login form');
  });

  test('missing images recorded as NOT_APPLICABLE when no img is present', async ({ visualPage }) => {
    await visualPage.open('/');
    const count = await visualPage.countVisibleImages();
    if (count > 0) {
      await visualPage.expectVisibleImagesLoaded();
      return;
    }

    const reason =
      'NOT_APPLICABLE: no <img> observed on the discovered login page (bot artwork is a CSS background).';
    test.info().annotations.push({ type: 'NOT_APPLICABLE', description: reason });
    test.skip(true, reason);
  });
});
