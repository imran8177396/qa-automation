import { chromium } from '@playwright/test';
import { startFixtureServer } from '../testing/serve-fixture-site';
import {
  FIXTURE_SELF_CHECK_ID,
  FIXTURE_SELF_CHECK_NOTE,
  FIXTURE_SELF_CHECK_PAIR,
} from './applicability';
import type { RuntimeCorrelationEvidence } from './evidence';

/**
 * Framework self-check: local fixture page clicks Load status → GET /api/status → UI shows ok.
 * Never claimed as Sauce Demo coverage. Never invents a Sauce Demo REST path.
 */
export async function runFixtureCorrelationSelfCheck(): Promise<RuntimeCorrelationEvidence> {
  const server = await startFixtureServer();
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${server.url}${FIXTURE_SELF_CHECK_PAIR.uiPath}`, { waitUntil: 'load' });

      const pending = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' && response.url().includes(FIXTURE_SELF_CHECK_PAIR.apiPath)
      );
      await page.locator(FIXTURE_SELF_CHECK_PAIR.uiAction ?? '[data-qa="load-status"]').click();
      const apiResponse = await pending;
      const result = page.locator(FIXTURE_SELF_CHECK_PAIR.uiResult ?? '[data-qa="status-result"]');
      await result.waitFor({ state: 'visible' });
      const actual = (await result.textContent())?.trim() ?? '';
      const status = apiResponse.status();
      const passed = status === (FIXTURE_SELF_CHECK_PAIR.expectedStatus ?? 200) && actual === 'ok';

      return {
        id: FIXTURE_SELF_CHECK_ID,
        name: FIXTURE_SELF_CHECK_PAIR.name,
        scope: 'framework-self-check',
        status: passed ? 'PASS' : 'FAIL',
        request: {
          url: apiResponse.url(),
          method: apiResponse.request().method(),
          status,
        },
        uiAssertion: {
          locator: FIXTURE_SELF_CHECK_PAIR.uiResult ?? '[data-qa="status-result"]',
          expected: 'ok',
          actual,
        },
        note: FIXTURE_SELF_CHECK_NOTE,
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    return {
      id: FIXTURE_SELF_CHECK_ID,
      name: FIXTURE_SELF_CHECK_PAIR.name,
      scope: 'framework-self-check',
      status: 'REQUIRES_CONFIGURATION',
      reason: `REQUIRES_CONFIGURATION: fixture self-check could not run (${error instanceof Error ? error.message : String(error)}).`,
      request: null,
      uiAssertion: null,
      note: FIXTURE_SELF_CHECK_NOTE,
    };
  } finally {
    await server.close();
  }
}
