import { test, expect } from '@playwright/test';
import { SignupPage } from '../../pages/SignupPage';
import users from '../../test-data/users.json';

test('Signup should reject empty required fields', async ({ page }) => {
  const signupPage = new SignupPage(page);

  await signupPage.goto();
  await signupPage.signup(
    users.boundaryUser.firstName,
    users.boundaryUser.lastName,
    users.boundaryUser.username,
    users.boundaryUser.password,
    { expectSuccess: false }
  );

  await expect(page).toHaveURL(/addUser/);
  await expect(signupPage.errorMessage).not.toBeEmpty();
});

test('Signup cancel should return to login page', async ({ page }) => {
  const signupPage = new SignupPage(page);

  await signupPage.goto();
  await signupPage.cancelButton.click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Contact List App' })).toBeVisible();
});
