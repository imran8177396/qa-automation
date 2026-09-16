import { expect, test } from '../../../fixtures/qa-test';
import { isFixtureUiTarget } from '../../../scripts/lib/ui-target';
import { attachUiNetworkListener, collectUiTimings } from '../../../scripts/performance/ui-timing';
import { writeUiTimingEvidence } from '../../../scripts/performance/ui-evidence';
import { resolveUiPerformancePage } from '../../../scripts/performance/ui-pages';

const pageDef = resolveUiPerformancePage();

test('Playwright UI timing records login page load without inventing SLAs', async ({ page, loginPage }) => {
  expect(pageDef, 'REQUIRES_CONFIGURATION: no UI performance page was resolved').toBeTruthy();
  const target = pageDef!;
  const network = attachUiNetworkListener(page);

  try {
    if (isFixtureUiTarget()) {
      const response = await page.goto(target.path, { waitUntil: 'load' });
      expect(response, `expected a response for ${target.path}`).not.toBeNull();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const measurement = await collectUiTimings(page, {
        url: page.url(),
        pageName: target.name,
        httpStatus: response?.status() ?? null,
        network: network.entries,
      });
      writeUiTimingEvidence(measurement);
      expect(measurement.navigation, 'Navigation Timing should be present after load').not.toBeNull();
      expect(measurement.inpMs, 'INP is not measured — this suite does not interact').toBeNull();
      return;
    }

    const response = await page.goto(target.path, { waitUntil: 'load' });
    expect(response, `expected a response for ${target.path}`).not.toBeNull();
    await loginPage.expectLoaded();
    const measurement = await collectUiTimings(page, {
      url: page.url(),
      pageName: target.name,
      httpStatus: response?.status() ?? null,
      network: network.entries,
    });
    writeUiTimingEvidence(measurement);
    expect(measurement.navigation, 'Navigation Timing should be present after load').not.toBeNull();
    expect(measurement.inpMs, 'INP is not measured — Login is not clicked').toBeNull();
  } finally {
    network.detach();
  }
});
