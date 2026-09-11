import { test, expect } from '../../../fixtures/qa-test';
import { isFixtureUiTarget } from '../../../scripts/lib/ui-target';

/**
 * Visual state change: empty vs filled contact form.
 * Fill only — never submit (safety policy).
 * Fixture contact.html is NOT_TESTED on a live origin.
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

  test('fixture contact-form states recorded as NOT_TESTED on live origin', () => {
    test.info().annotations.push({
      type: 'NOT_TESTED',
      description:
        'NOT_TESTED: /contact.html filled/empty visual states are fixture-only. Live UI visual pages still execute from discovery.',
    });
    expect(
      isFixtureUiTarget(),
      'NOT_TESTED: fixture contact-form states are not executed against a live origin.'
    ).toBe(false);
  });
});
