import { type Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { stabilizeForVisual } from '../scripts/visual/stabilize';

const SCREENSHOT = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
};

/**
 * Visual assertions only. Functional "does it work?" checks belong in tests/e2e/, not here.
 */
export class VisualPage extends BasePage {
  async open(path: string): Promise<void> {
    await this.page.setViewportSize({ width: 1280, height: 720 });
    await this.goto(path);
    await stabilizeForVisual(this.page);
  }

  get nav(): Locator {
    return this.page.locator('nav').first();
  }

  get firstForm(): Locator {
    return this.page.locator('form').first();
  }

  get logo(): Locator {
    return this.page.getByRole('img', { name: 'Fixture logo' });
  }

  get dangerZone(): Locator {
    return this.page.locator('section').filter({ hasText: 'Danger zone' });
  }

  async expectPageScreenshot(name: string): Promise<void> {
    await expect(this.page).toHaveScreenshot(name, { ...SCREENSHOT, fullPage: true });
  }

  async expectElementScreenshot(locator: Locator, name: string): Promise<void> {
    await expect(locator).toBeVisible();
    await expect(locator).toHaveScreenshot(name, SCREENSHOT);
  }

  async fillContactPreview(): Promise<void> {
    await this.page.getByLabel('Name').fill('Visual Tester');
    await this.page.getByLabel('Email').fill('visual@example.com');
    await this.page.getByLabel('Message').fill('Filled-state screenshot. This form is not submitted.');
  }
}
