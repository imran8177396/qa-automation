import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';

const loginUrl = process.env.QA_LOGIN_URL ?? 'https://your-website.com/login';
const username = process.env.QA_USERNAME ?? 'test@example.com';
const password = process.env.QA_PASSWORD ?? 'Password123';

test('User should be able to login', async ({ page }) => {
  test.skip(
    loginUrl.includes('your-website.com'),
    'Update urls.login in qa.config.json to run this test.'
  );

  const loginPage = new LoginPage(page);

  await page.goto(loginUrl);

  await loginPage.login(username, password);

  await expect(page).toHaveURL(/dashboard/);
});
