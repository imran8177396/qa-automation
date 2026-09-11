import { test, expect } from '../../fixtures/qa-test';

test('homepage loads through the HomePage object @cross-browser', async ({ homePage }) => {
  await homePage.open();
  await homePage.expectLoaded();
});

test('Homepage should expose at least one navigable link @cross-browser', async ({ homePage }) => {
  await homePage.open();
  await expect(homePage.firstLink).toBeVisible();
});
