import { test, expect } from '@playwright/test';
import { expectPageLoads } from './helpers/page-load';

/** Placeholder public pages. Replace with discovered routes after configuring a target URL. */
const staticPages: Array<{ path: string; title: RegExp }> = [
  { path: '/', title: /.+/ },
];

test('static page list is ready for a target site @cross-browser', async () => {
  expect(
    staticPages.length,
    'REQUIRES_CONFIGURATION: add entries in staticPages when a real site is configured. Not a silent skip.'
  ).toBeGreaterThan(0);
});

for (const { path, title } of staticPages) {
  test(`${path} should load with expected title @cross-browser`, async ({ page }) => {
    await expectPageLoads(page, path, { title });
  });
}
