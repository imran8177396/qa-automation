import { test } from '../../../fixtures/qa-test';
import { isFixtureUiTarget } from '../../../scripts/lib/ui-target';

/**
 * Region screenshots catch alignment, typography, clipping, and missing images.
 * Fixture-only locators (logo, danger zone, contact.html) are recorded as
 * NOT_TESTED on a live origin — live full-page visuals still run.
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

  test('fixture-only visual components recorded as NOT_TESTED on live origin', async ({ visualPage }) => {
    await visualPage.open('/');
    await visualPage.expectElementScreenshot(visualPage.heading, 'live-home-heading.png');
    test.info().annotations.push({
      type: 'NOT_TESTED',
      description:
        'NOT_TESTED: fixture locators (Fixture logo, /contact.html, /danger.html) do not apply to the live origin. Live heading screenshot still executed.',
    });
  });
});
