import { test, expect } from '@playwright/test';
import { expectPageLoads } from './helpers/page-load';
import {
  EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON,
  isExampleWebsiteTarget,
} from '../../scripts/lib/ui-target';

/** Public Sauce Demo routes that load without a session. Inventory is login-gated. */
const staticPages: Array<{ path: string; title: RegExp }> = [
  { path: '/', title: /Swag Labs/ },
];

function exampleOrNotApplicable(): boolean {
  if (isExampleWebsiteTarget()) return true;
  test.info().annotations.push({
    type: 'NOT_APPLICABLE',
    description: EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON,
  });
  expect('NOT_APPLICABLE', EXAMPLE_WEBSITE_NOT_APPLICABLE_REASON).toBe('NOT_APPLICABLE');
  return false;
}

test('static page list is ready for a target site @cross-browser', async () => {
  if (!exampleOrNotApplicable()) return;
  expect(
    staticPages.length,
    'REQUIRES_CONFIGURATION: add entries in staticPages when a real site is configured. Not a silent skip.'
  ).toBeGreaterThan(0);
});

for (const { path, title } of staticPages) {
  test(`${path} should load with expected title @cross-browser`, async ({ page }) => {
    if (!exampleOrNotApplicable()) return;
    await expectPageLoads(page, path, { title });
  });
}
