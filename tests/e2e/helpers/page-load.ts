import { expect, type Page, type Response } from '@playwright/test';

export async function expectPageLoads(
  page: Page,
  path: string,
  options: {
    heading?: RegExp;
    title?: RegExp;
    waitUntil?: 'load' | 'networkidle';
  } = {}
): Promise<Response | null> {
  const response = await page.goto(path, { waitUntil: options.waitUntil ?? 'load' });
  expect(response?.ok(), `${path} should return a successful status`).toBeTruthy();

  if (options.title) {
    await expect(page).toHaveTitle(options.title);
  }

  if (options.heading) {
    await expect(page.locator('h1').first()).toContainText(options.heading);
  }

  return response;
}
