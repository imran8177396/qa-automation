import { test } from '../../../fixtures/qa-test';
import { isFixtureUiTarget } from '../../../scripts/lib/ui-target';

/**
 * Region screenshots catch alignment, typography, clipping, and missing images.
 * Fixture-only locators (logo, danger zone, contact.html) are recorded as
 * NOT_APPLICABLE on a live origin. Live checks use the discovered login form
 * and observed headings — not an invented h1.
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
    test.skip(true, reason);
  });
});
