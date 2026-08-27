import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { DashboardPage } from '../../pages/DashboardPage';
import { getCredentials } from '../../utils/env';
import users from '../../test-data/users.json';

test('Inventory page should load after login', async ({ page }) => {
  const loginPage = new LoginPage(page);
  const dashboard = new DashboardPage(page);
  const { username, password } = getCredentials();

  await loginPage.goto();
  await loginPage.login(username || users.validUser.username, password || users.validUser.password);

  await dashboard.expectLoaded();
  await expect(page.locator('[data-test="title"]')).toHaveText('Products');
});
