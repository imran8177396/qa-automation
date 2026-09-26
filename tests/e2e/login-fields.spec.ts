import { test, expect } from '../../fixtures/qa-test';
import {
  EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON,
  isExampleWebsiteTarget,
} from '../../scripts/lib/ui-target';

/**
 * Non-destructive login-field checks through LoginForm / LoginPage.
 * Generated discovery checks cover the same locators; this spec keeps the POM
 * path exercised and puts locators in the title so coverage can match.
 *
 * Sauce Demo example only — NOT_APPLICABLE when the resolved origin is not
 * `urls.website`.
 */

function exampleOrNotApplicable(): boolean {
  if (isExampleWebsiteTarget()) return true;
  test.info().annotations.push({
    type: 'NOT_APPLICABLE',
    description: EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON,
  });
  expect('NOT_APPLICABLE', EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON).toBe('NOT_APPLICABLE');
  return false;
}

test(
  'https://www.saucedemo.com/ login username [data-test="username"] is visible, enabled, editable, and optional @cross-browser',
  async ({ loginPage, loginForm }) => {
    if (!exampleOrNotApplicable()) return;
    await loginPage.open();
    await expect(loginForm.username).toBeVisible();
    await expect(loginForm.username).toBeEnabled();
    await expect(loginForm.username).toBeEditable();
    await expect(loginForm.username).not.toHaveAttribute('required', /.*/);
  }
);

test(
  'https://www.saucedemo.com/ login password [data-test="password"] accepts fill without submit @cross-browser',
  async ({ loginPage, loginForm, page }) => {
    if (!exampleOrNotApplicable()) return;
    await loginPage.open();
    await loginForm.fillWithoutSubmit({ username: 'Sample text', password: 'SamplePass_qa' });
    await expect(loginForm.username).toHaveValue('Sample text');
    await expect(loginForm.password).toHaveValue('SamplePass_qa');
    const baseURL = test.info().project.use.baseURL;
    if (!baseURL) {
      throw new Error('Playwright project use.baseURL is required — refusing to assert against an unknown origin');
    }
    const expectedOrigin = new URL(baseURL).origin;
    await expect(page).toHaveURL((url) => url.origin === expectedOrigin && (url.pathname === '/' || url.pathname === ''));
  }
);

test(
  'https://www.saucedemo.com/ login button [data-test="login-button"] is visible and enabled — click not authorized here @cross-browser',
  async ({ loginPage, loginForm }) => {
    if (!exampleOrNotApplicable()) return;
    await loginPage.open();
    await expect(loginForm.submitButton).toBeVisible();
    await expect(loginForm.submitButton).toBeEnabled();
    await expect(loginForm.submitButton).toHaveAccessibleName(/login/i);
  }
);

test(
  'https://www.saucedemo.com/ login form [aria-label="Login"] is present — submission is blocked @cross-browser',
  async ({ loginPage, loginForm, page }) => {
    if (!exampleOrNotApplicable()) return;
    await loginPage.open();
    await loginForm.expectFieldsPresent();
    await expect(page.getByTestId('inventory-item')).toHaveCount(0);
  }
);
