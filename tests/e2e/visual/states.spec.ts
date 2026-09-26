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
 * Visual state change: empty vs filled form.
 * Fill only — never submit (safety policy).
 * Fixture contact.html is NOT_APPLICABLE on a live origin.
 * Sauce Demo login-form states run only on the example origin.
 * Other live origins use a discovered form when present.
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

  if (isExampleWebsiteTarget()) {
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
      expect('NOT_APPLICABLE').toBe('NOT_APPLICABLE');
    });
    return;
  }

  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  if (discoveryLandingHasLoginForm(ui)) {
    test('discovered form empty state', async ({ visualPage }) => {
      await visualPage.open('/');
      await visualPage.expectElementScreenshot(visualPage.firstForm, 'live-login-form-empty.png');
    });
  } else {
    test('Sauce Demo login-form visual states are NOT_APPLICABLE on non-example origin', () => {
      test.info().annotations.push({
        type: 'NOT_APPLICABLE',
        description: EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON,
      });
      expect('NOT_APPLICABLE').toBe('NOT_APPLICABLE');
    });
  }

  test('fixture contact-form states recorded as NOT_APPLICABLE on live origin', () => {
    const reason =
      'NOT_APPLICABLE: /contact.html filled/empty visual states are fixture-only.';
    test.info().annotations.push({ type: 'NOT_APPLICABLE', description: reason });
    expect('NOT_APPLICABLE').toBe('NOT_APPLICABLE');
  });
});
