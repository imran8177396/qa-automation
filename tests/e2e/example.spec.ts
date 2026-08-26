import { test, expect } from '@playwright/test';

const websiteUrl = process.env.QA_WEBSITE_URL ?? 'https://example.com';

test('Verify Example website', async ({ page }) => {
  await page.goto(websiteUrl);

  await expect(page).toHaveTitle(/Example/);

  await expect(
    page.getByRole('heading', { name: 'Example Domain' })
  ).toBeVisible();
});
