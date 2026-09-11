import { test, expect } from '@playwright/test';
import { expectPageLoads } from './helpers/page-load';

/** Blog/article routes. Empty until discovery observes them on a configured target. */
const contentPages: Array<{ path: string; title: RegExp }> = [];

test('content page list is ready for a target site @cross-browser', async () => {
  expect(
    contentPages,
    'NOT_TESTED: no observed blog/article routes on the target. Recorded explicitly — not a silent skip.'
  ).toEqual([]);
});

for (const { path, title } of contentPages) {
  test(`${path} should load with expected title @cross-browser`, async ({ page }) => {
    await expectPageLoads(page, path, { title, waitUntil: 'load' });
  });
}
