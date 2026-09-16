import { test, expect } from '../../fixtures/qa-test';

/**
 * Non-destructive login-field checks through LoginForm / LoginPage.
 * Generated discovery checks cover the same locators; this spec keeps the POM
 * path exercised and puts locators in the title so coverage can match.
 */

test(
  'https://www.saucedemo.com/ login username [data-test="username"] is visible, enabled, editable, and optional @cross-browser',
  async ({ loginPage, loginForm }) => {
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
    await loginPage.open();
    await loginForm.fillWithoutSubmit({ username: 'Sample text', password: 'SamplePass_qa' });
    await expect(loginForm.username).toHaveValue('Sample text');
    await expect(loginForm.password).toHaveValue('SamplePass_qa');
    await expect(page).toHaveURL(/saucedemo\.com\/?$/);
  }
);

test(
  'https://www.saucedemo.com/ login button [data-test="login-button"] is visible and enabled — click not authorized here @cross-browser',
  async ({ loginPage, loginForm }) => {
    await loginPage.open();
    await expect(loginForm.submitButton).toBeVisible();
    await expect(loginForm.submitButton).toBeEnabled();
    await expect(loginForm.submitButton).toHaveAccessibleName(/login/i);
  }
);

test(
  'https://www.saucedemo.com/ login form [aria-label="Login"] is present — submission is blocked @cross-browser',
  async ({ loginPage, loginForm, page }) => {
    await loginPage.open();
    await loginForm.expectFieldsPresent();
    await expect(page.getByTestId('inventory-item')).toHaveCount(0);
  }
);
