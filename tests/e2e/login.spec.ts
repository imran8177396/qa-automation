import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { SignupPage } from '../../pages/SignupPage';
import { ContactListPage } from '../../pages/ContactListPage';
import { createUniqueTestUser } from '../../utils/test-user';
import users from '../../test-data/users.json';

test('User should sign up and log in to Contact List App', async ({ page }) => {
  const signupPage = new SignupPage(page);
  const loginPage = new LoginPage(page);
  const contactList = new ContactListPage(page);
  const user = createUniqueTestUser();

  await signupPage.goto();
  await signupPage.signup(user.firstName, user.lastName, user.email, user.password);

  await expect(page).toHaveURL(/contactList/);
  await contactList.expectLoaded();

  await contactList.logout();
  await expect(page).toHaveURL(/\/(login)?$/);

  await loginPage.login(user.email, user.password);
  await expect(page).toHaveURL(/contactList/);
  await contactList.expectLoaded();
});

test('Login should fail with invalid credentials', async ({ page }) => {
  const loginPage = new LoginPage(page);

  await loginPage.goto();
  await loginPage.login(users.invalidUser.username, users.invalidUser.password, {
    expectSuccess: false,
  });

  await expect(page).toHaveURL(/\/(login)?$/);
  await expect(loginPage.errorMessage).toHaveText('Incorrect username or password');
});
