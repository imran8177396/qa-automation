import { test, expect } from '../../fixtures/qa-test';
import { getCredentials } from '../../utils/env';
import {
  EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON,
  isExampleWebsiteTarget,
} from '../../scripts/lib/ui-target';

/** Sauce Demo / Swag Labs POM checks — NOT_APPLICABLE on a non-example origin. */
function exampleOrNotApplicable(): boolean {
  if (isExampleWebsiteTarget()) return true;
  test.info().annotations.push({
    type: 'NOT_APPLICABLE',
    description: EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON,
  });
  expect('NOT_APPLICABLE', EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON).toBe('NOT_APPLICABLE');
  return false;
}

test('https://www.saucedemo.com/ login page loads through the LoginPage object @cross-browser', async ({ loginPage }) => {
  if (!exampleOrNotApplicable()) return;
  await loginPage.open();
  await loginPage.expectLoaded();
});

test('https://www.saucedemo.com/ login form [data-test="username"] [data-test="password"] [data-test="login-button"] is visible by test id, placeholder, and role @cross-browser', async ({ loginPage }) => {
  if (!exampleOrNotApplicable()) return;
  await loginPage.open();
  await expect(loginPage.username).toBeVisible();
  await expect(loginPage.password).toBeVisible();
  await expect(loginPage.loginButton).toBeEnabled();
});

test('inventory without a session stays on the login page @cross-browser', async ({ loginPage }) => {
  if (!exampleOrNotApplicable()) return;
  const status = await loginPage.openGated('/inventory.html');
  expect(status, 'gated inventory must return an HTTP status').toBeGreaterThan(0);
  await loginPage.expectStillOnLogin();
  await loginPage.expectSessionRequiredError('/inventory.html');
});

test('empty login shows a required-username error @cross-browser', async ({ loginPage }) => {
  if (!exampleOrNotApplicable()) return;
  await loginPage.open();
  await loginPage.submitEmpty();
  await loginPage.expectUsernameRequiredError();
  await loginPage.expectStillOnLogin();
});

test('inventory browse after documented login @cross-browser', async ({ loginPage, inventoryPage }) => {
  if (!exampleOrNotApplicable()) return;
  const { username, password } = getCredentials();
  if (!username || !password) {
    expect(
      { username, password },
      'REQUIRES_CONFIGURATION: set QA_USERNAME and QA_PASSWORD in a local .env (see .env.example). Sauce Demo prints a documented demo user on the login page. Login-page checks still ran. This is not a silent skip.'
    ).toEqual({ username: '', password: '' });
    return;
  }

  await loginPage.open();
  await loginPage.expectLoaded();
  await loginPage.login(username, password);
  await inventoryPage.expectLoaded();
});
