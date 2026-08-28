import { test, expect } from '@playwright/test';

test('Contact List App homepage should load', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Contact List App/);
  await expect(page.getByRole('heading', { name: 'Contact List App' })).toBeVisible();
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.locator('#submit')).toBeVisible();
});
