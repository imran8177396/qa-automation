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
 * Region screenshots catch alignment, typography, clipping, and missing images.
 * Fixture-only locators (logo, danger zone, contact.html) are recorded as
 * NOT_APPLICABLE on a live origin. Swag Labs brand / Sauce Demo login-form
 * screenshots run only on the example origin. Other live origins use discovery
 * landing helpers (form + observed heading) — no invented example locators.
 */
test.describe('visual components @visual', () => {
  if (isFixtureUiTarget()) {
    test('home heading typography', async ({ visualPage }) => {
      await visualPage.open('/');
      await visualPage.expectElementScreenshot(visualPage.heading, 'home-heading.png');
    });

    test('home navigation alignment', async ({ visualPage }) => {
      await visualPage.open('/');
      await visualPage.expectElementScreenshot(visualPage.nav, 'home-nav.png');
    });

    test('home logo is present and unclipped', async ({ visualPage }) => {
      await visualPage.open('/');
      await visualPage.expectElementScreenshot(visualPage.logo, 'home-logo.png');
    });

    test('contact form container', async ({ visualPage }) => {
      await visualPage.open('/contact.html');
      await visualPage.expectElementScreenshot(visualPage.firstForm, 'contact-form.png');
    });

    test('danger-zone section does not overlap newsletter', async ({ visualPage }) => {
      await visualPage.open('/danger.html');
      await visualPage.expectElementScreenshot(visualPage.dangerZone, 'danger-zone.png');
    });
    return;
  }

  if (isExampleWebsiteTarget()) {
    test('login heading typography', async ({ visualPage }) => {
      await visualPage.open('/');
      await visualPage.expectHeadingHasTypography();
      await visualPage.expectElementScreenshot(visualPage.observedHeading, 'live-login-heading.png');
    });

    test('login form container alignment', async ({ visualPage }) => {
      await visualPage.open('/');
      await visualPage.expectLoginFieldsStacked();
      await visualPage.expectElementScreenshot(visualPage.loginForm.root, 'live-login-form.png');
    });

    test('login brand is present and unclipped', async ({ visualPage }) => {
      await visualPage.open('/');
      await visualPage.expectRegionIntact(visualPage.brand, 'login brand');
      await visualPage.expectElementScreenshot(visualPage.brand, 'live-login-brand.png');
    });

    test('fixture-only visual components recorded as NOT_APPLICABLE on live origin', () => {
      const reason =
        'NOT_APPLICABLE: fixture locators (Fixture logo, /contact.html, /danger.html) do not apply to the live origin. Live login form, heading, and brand screenshots still execute.';
      test.info().annotations.push({ type: 'NOT_APPLICABLE', description: reason });
      expect('NOT_APPLICABLE').toBe('NOT_APPLICABLE');
    });
    return;
  }

  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  if (discoveryLandingHasLoginForm(ui)) {
    test('discovered login heading typography', async ({ visualPage }) => {
      await visualPage.open('/');
      await visualPage.expectHeadingHasTypography();
      await visualPage.expectElementScreenshot(visualPage.observedHeading, 'live-login-heading.png');
    });

    test('discovered login form container', async ({ visualPage }) => {
      await visualPage.open('/');
      await visualPage.expectRegionIntact(visualPage.firstForm, 'discovered login form');
      await visualPage.expectElementScreenshot(visualPage.firstForm, 'live-login-form.png');
    });
  } else {
    test('Sauce Demo visual brand/form checks are NOT_APPLICABLE on non-example origin', () => {
      test.info().annotations.push({
        type: 'NOT_APPLICABLE',
        description: EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON,
      });
      expect('NOT_APPLICABLE').toBe('NOT_APPLICABLE');
    });
  }

  test('fixture-only visual components recorded as NOT_APPLICABLE on live origin', () => {
    const reason =
      'NOT_APPLICABLE: fixture locators (Fixture logo, /contact.html, /danger.html) do not apply to the live origin.';
    test.info().annotations.push({ type: 'NOT_APPLICABLE', description: reason });
    expect('NOT_APPLICABLE').toBe('NOT_APPLICABLE');
  });
});
