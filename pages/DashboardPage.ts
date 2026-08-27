import { Page, Locator } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly inventoryContainer: Locator;
  readonly title: Locator;

  constructor(page: Page) {
    this.page = page;
    this.inventoryContainer = page.locator('[data-test="inventory-container"]');
    this.title = page.locator('[data-test="title"]');
  }

  async expectLoaded() {
    await this.inventoryContainer.waitFor({ state: 'visible' });
    await this.title.waitFor({ state: 'visible' });
  }

  async addFirstItemToCart() {
    await this.page.locator('[data-test^="add-to-cart"]').first().click();
  }
}
