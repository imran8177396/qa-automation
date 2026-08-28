import { Page, Locator } from '@playwright/test';

export class ContactListPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly addContactButton: Locator;
  readonly logoutButton: Locator;
  readonly contactsContainer: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Contact List' });
    this.addContactButton = page.locator('#add-contact');
    this.logoutButton = page.locator('#logout');
    this.contactsContainer = page.locator('.contacts');
  }

  async expectLoaded() {
    await this.heading.waitFor({ state: 'visible' });
    await this.addContactButton.waitFor({ state: 'visible' });
  }

  async logout() {
    await this.logoutButton.click();
  }
}
