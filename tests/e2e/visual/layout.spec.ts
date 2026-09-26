import { test, expect } from '../../../fixtures/qa-test';
import { PATHS } from '../../../scripts/lib/paths';
import { readJsonIfExists } from '../../../scripts/discovery/write-json';
import type { UiInventory } from '../../../scripts/discovery/ui-scan';
import { discoveryLandingHasLoginForm } from '../../../scripts/lib/discovered-page-targets';
import {
  EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON,
  isExampleWebsiteTarget,
  isFixtureUiTarget,
} from '../../../scripts/lib/ui-target';

/**
 * Geometry on the observed login page: overlap, clipping, collapsed containers,
 * unexpected movement. Missing <img>, cart, and inventory are NOT_APPLICABLE —
 * those pages were not discovered and are not invented.
 * Sauce Demo data-test login form layout runs only on the example origin.
 */
test.describe('visual layout @visual', () => {
  if (isFixtureUiTarget()) {
    test('live-origin login layout checks are NOT_APPLICABLE against the fixture', () => {
      const reason =
        'NOT_APPLICABLE: Login-page layout assertions apply to the live discovery / example target, not the fixture.';
      test.info().annotations.push({ type: 'NOT_APPLICABLE', description: reason });
      expect('NOT_APPLICABLE').toBe('NOT_APPLICABLE');
    });
    return;
  }

  if (isExampleWebsiteTarget()) {
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
      expect('NOT_APPLICABLE').toBe('NOT_APPLICABLE');
    });
    return;
  }

  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  if (discoveryLandingHasLoginForm(ui)) {
    test('discovered form and heading do not overlap or collapse', async ({ visualPage }) => {
      await visualPage.open('/');
      await visualPage.expectRegionIntact(visualPage.firstForm, 'discovered form');
      if ((await visualPage.observedHeading.count()) > 0) {
        await visualPage.expectRegionIntact(visualPage.observedHeading, 'observed heading');
        await visualPage.expectRegionsDoNotOverlap(
          visualPage.firstForm,
          visualPage.observedHeading,
          'form vs observed heading'
        );
      }
      await visualPage.expectRegionNotClipped(visualPage.firstForm, 'discovered form');
    });
  } else {
    test('Sauce Demo login layout checks are NOT_APPLICABLE on non-example origin', () => {
      test.info().annotations.push({
        type: 'NOT_APPLICABLE',
        description: EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON,
      });
      expect('NOT_APPLICABLE').toBe('NOT_APPLICABLE');
    });
  }
});
