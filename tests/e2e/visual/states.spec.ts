import { test } from '../../../fixtures/qa-test';
import { isFixtureUiTarget } from '../../../scripts/lib/ui-target';

/**
 * Visual state change: empty vs filled form.
 * Fill only — never submit (safety policy).
 * Fixture contact.html is NOT_APPLICABLE on a live origin; the discovered
 * login form empty/filled states still run.
 */
test.describe('visual states @visual', () => {
  if (isFixtureUiTarget()) {
    test('contact form empty state', async ({ visualPage }) => {
      await visualPage.open('/contact.html');
      await visualPage.expectElementScreenshot(visualPage.firstForm, 'contact-form-empty.png');
    });

    test('contact form filled state without submit', async ({ visualPage }) => {
      await visualPage.open('/contact.html');
      await visualPage.fillContactPreview();
      await visualPage.expectElementScreenshot(visualPage.firstForm, 'contact-form-filled.png');
    });
    return;
  }

  test('login form empty state', async ({ visualPage }) => {
    await visualPage.open('/');
    await visualPage.expectElementScreenshot(visualPage.loginForm.root, 'live-login-form-empty.png');
  });

  test('login form filled state without submit', async ({ visualPage }) => {
    await visualPage.open('/');
    await visualPage.fillLoginPreview();
    await visualPage.expectElementScreenshot(visualPage.loginForm.root, 'live-login-form-filled.png');
  });

  test('fixture contact-form states recorded as NOT_APPLICABLE on live origin', () => {
    const reason =
      'NOT_APPLICABLE: /contact.html filled/empty visual states are fixture-only. Live login form empty/filled still execute from discovery.';
    test.info().annotations.push({ type: 'NOT_APPLICABLE', description: reason });
    test.skip(true, reason);
  });
});
