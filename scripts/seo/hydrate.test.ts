import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveryFromPageMap } from './hydrate';
import type { PageMap } from '../discovery/page-map';
import { parseHtml } from '../lib/html-snapshot';

test('discoveryFromPageMap() copies title/headings and fills meta from HTML', () => {
  const pageMap = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    seedUrl: 'https://www.saucedemo.com/',
    scopeHost: 'www.saucedemo.com',
    truncated: false,
    pages: [
      {
        url: 'https://www.saucedemo.com/',
        finalUrl: 'https://www.saucedemo.com/',
        route: '/',
        title: 'Swag Labs',
        status: 200,
        ok: true,
        depth: 0,
        headings: [{ level: 'h4' as const, text: 'Accepted usernames are:' }],
        h1s: [],
        redirects: [],
        canonicalUrl: null,
        internalLinks: [],
        applicableTestTypes: [],
      },
    ],
    routes: [],
    navigation: [],
    skippedByScope: [],
    categoryStatus: [],
  } as unknown as PageMap;

  const html = parseHtml(
    '<html><head><title>Swag Labs</title><meta name="description" content="from html"></head><body><h4>Accepted usernames are:</h4></body></html>'
  );
  const discovery = discoveryFromPageMap(pageMap, new Map([['https://www.saucedemo.com/', html]]));
  assert.equal(discovery.pages[0]?.title, 'Swag Labs');
  assert.equal(discovery.pages[0]?.metaDescription, 'from html');
  assert.equal(discovery.pages[0]?.h1s.length, 0);
});
