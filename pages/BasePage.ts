import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Shared navigation and assertions for Page Objects.
 * Specs should not call page.goto / raw locators when a page object exists.
 */
export class BasePage {
  constructor(protected readonly page: Page) {}

  async goto(path = '/'): Promise<void> {
    const response = await this.page.goto(path);
    expect(response, `expected a response for ${path}`).not.toBeNull();
    expect(response!.ok(), `${path} should return a successful status`).toBeTruthy();
  }

  async expectHeadingVisible(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  get heading(): Locator {
    return this.page.getByRole('heading', { level: 1 }).first();
  }

  get firstLink(): Locator {
    return this.page.getByRole('link').first();
  }
}
