import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { startFixtureServer } from './serve-fixture-site';
import { crawl } from '../discovery/crawler';
import { resolveDiscoveryConfig } from '../core/scope';
import { resolveSafetyConfig } from '../core/safety-policy';
import { inventoryPage } from '../inventory/element-inventory';
import { classifyElements } from '../inventory/classify-elements';
import { generateChecks } from '../planning/generate-checks';
import type { ElementRecord } from '../inventory/types';

/**
 * End-to-end regression proof for the safety policy: boot the real fixture site (which models the
 * near-incident this framework must never repeat — a live "Delete account" button and newsletter
 * form), run the actual crawl + inventory + check-planning + boundary-check execution against it
 * with a real browser, and assert zero non-GET requests ever reached the server. This is a stronger
 * guarantee than unit-testing safety-policy.ts in isolation, so both exist.
 */
test(
  'discovery pipeline never sends a state-changing request to the fixture site',
    { timeout: 120000 },
  async () => {
    const server = await startFixtureServer();

    try {
      const safety = resolveSafetyConfig();
      const discoveryOptions = resolveDiscoveryConfig();

      const discovery = await crawl(server.url, { ...discoveryOptions, safety });
      assert.ok(discovery.pages.length >= 3, `expected multiple pages discovered, got ${discovery.pages.length}`);

      const browser = await chromium.launch();
      try {
        const elements: ElementRecord[] = [];
        for (const page of discovery.pages) {
          if (page.error || page.status === null || page.status >= 400) continue;
          const browserPage = await browser.newPage();
          try {
            await browserPage.goto(page.url, { waitUntil: 'load' });
            elements.push(...classifyElements(await inventoryPage(browserPage, page.url), safety));
          } finally {
            await browserPage.close();
          }
        }

        const inventory = { generatedAt: new Date().toISOString(), pages: discovery.pages.length, elements };
        const checks = generateChecks(discovery, inventory);

        assert.ok(
          checks.some((c) => c.status === 'NOT_TESTED' && /destructive/.test(c.reason ?? '')),
          'expected the danger-zone delete button to be classified destructive and NOT_TESTED'
        );

        // Execute exactly what the generated Playwright spec would for every PLANNED form check —
        // fill/blur, never a submit click — the same way tests/e2e/generated/discovery-checks.spec.ts does.
        for (const check of checks) {
          if (check.status !== 'PLANNED' || check.kind !== 'form-boundary') continue;
          const selector = check.expect?.locator;
          if (!selector) continue;

          const page = await browser.newPage();
          try {
            await page.goto(check.targetUrl, { waitUntil: 'load' });
            const locator = page.locator(selector).first();
            await locator.fill('').catch(() => undefined);
            await locator.blur().catch(() => undefined);
          } finally {
            await page.close();
          }
        }
      } finally {
        await browser.close();
      }

      const nonGetHits = server.requestLog.filter((entry) => entry.method !== 'GET' && entry.method !== 'HEAD');
      assert.deepEqual(nonGetHits, [], `expected zero non-GET requests, got: ${JSON.stringify(nonGetHits)}`);

      const dangerEndpoints = new Set(['/delete-account', '/subscribe', '/contact-submit']);
      const dangerHits = server.requestLog.filter((entry) => dangerEndpoints.has(entry.path));
      assert.deepEqual(dangerHits, [], `expected zero hits on destructive endpoints, got: ${JSON.stringify(dangerHits)}`);
    } finally {
      await server.close();
    }
  }
);
