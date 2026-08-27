import { test, expect } from '@playwright/test';

test('Swag Labs homepage should load', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Swag Labs/);
  await expect(page.locator('[data-test="login-button"]')).toBeVisible();
});
