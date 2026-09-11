import { type Page, type TestInfo, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class AccessibilityPage extends BasePage {
  constructor(
    page: Page,
    private readonly testInfo: TestInfo,
    private readonly pageName: string
  ) {
    super(page);
  }

  async open(path: string): Promise<void> {
    await this.goto(path);
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await this.testInfo.attach(`a11y-${this.pageName}`, {
      body: `Loaded ${this.pageName} for accessibility checks.`,
      contentType: 'text/plain',
    });
  }
}
