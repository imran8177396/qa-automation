import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class HomePage extends BasePage {
  /**
   * Defaults to the configured baseURL root. An absolute URL is accepted so the
   * same page object can drive a loopback fixture origin.
   */
  async open(target = '/'): Promise<void> {
    await this.goto(target);
  }

  async expectLoaded(): Promise<void> {
    await this.expectHeadingVisible();
    await expect(this.page).not.toHaveTitle('');
  }
}
