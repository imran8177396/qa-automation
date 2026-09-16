import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureServer } from '../testing/serve-fixture-site';
import { crawl } from './crawler';
import { resolveDiscoveryConfig } from '../core/scope';
import { resolveSafetyConfig } from '../core/safety-policy';

test(
  'crawl() with credentials discovers the post-login page; without credentials it does not invent it',
  { timeout: 90000 },
  async () => {
    const server = await startFixtureServer();
    const options = {
      ...resolveDiscoveryConfig({ maxPages: 10, maxDepth: 2, useSitemap: false }),
      safety: resolveSafetyConfig(),
    };

    try {
      const publicOnly = await crawl(`${server.url}/login.html`, options);
      assert.equal(
        publicOnly.pages.some((page) => /authed\.html/.test(page.url)),
        false,
        'must not invent the authenticated inventory page'
      );
      assert.equal(publicOnly.auth?.succeeded, false);

      const authed = await crawl(`${server.url}/login.html`, {
        ...options,
        credentials: { username: 'fixture-user', password: 'fixture-pass' },
      });
      assert.equal(authed.auth?.succeeded, true);
      assert.ok(
        authed.pages.some((page) => /authed\.html/.test(page.url) && page.access === 'authenticated'),
        'post-login inventory must be observed, not invented'
      );
      assert.equal(
        authed.pages.some((page) => /checkout/.test(page.url)),
        false,
        'must not invent checkout'
      );
    } finally {
      await server.close();
    }
  }
);
