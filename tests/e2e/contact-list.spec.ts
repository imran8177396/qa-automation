import { test, expect } from '@playwright/test';
import { SignupPage } from '../../pages/SignupPage';
import { ContactListPage } from '../../pages/ContactListPage';
import { createUniqueTestUser } from '../../utils/test-user';

test('Contact list page should load after signup', async ({ page }) => {
  const signupPage = new SignupPage(page);
  const contactList = new ContactListPage(page);
  const user = createUniqueTestUser('contact');

  await signupPage.goto();
  await signupPage.signup(user.firstName, user.lastName, user.email, user.password);

  await contactList.expectLoaded();
  await expect(page.getByText('Click on any contact to view the Contact Details')).toBeVisible();
  await expect(contactList.contactsContainer).toBeVisible();
});
