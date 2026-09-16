import { expect, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Sauce Demo inventory after a successful login. Browse-only: no cart,
 * checkout, or purchase actions — those are state-changing.
 */
export class InventoryPage extends BasePage {
  get title(): Locator {
    return this.page.getByTestId('title');
  }

  get items(): Locator {
    return this.page.getByTestId('inventory-item');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/inventory/);
    await expect(this.page).toHaveTitle(/Swag Labs/);
    await expect(this.title).toHaveText('Products');
    await expect(this.items.first()).toBeVisible();
    expect(await this.items.count(), 'inventory should list at least one product').toBeGreaterThan(0);
  }
}
