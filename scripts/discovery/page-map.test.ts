import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageMap } from './page-map';
import { makeDiscoveredPage, makeDiscoveryResult } from '../testing/discovery-fixtures';

test('buildPageMap() records headings, canonical, redirects, and in-scope internal links', () => {
  const page = makeDiscoveredPage({
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    headings: [
      { level: 'h1', text: 'Welcome' },
      { level: 'h2', text: 'Features' },
    ],
    canonicalUrl: 'https://example.com/',
    redirects: [{ from: 'https://example.com/old', to: 'https://example.com/', status: 301 }],
    outboundLinks: [
      { href: 'https://example.com/about', text: 'About' },
      { href: 'https://other.example/out', text: 'External' },
    ],
    access: 'public',
  });

  const map = buildPageMap(makeDiscoveryResult([page]));
  assert.equal(map.pages[0]?.canonicalUrl, 'https://example.com/');
  assert.equal(map.pages[0]?.headings?.[1]?.text, 'Features');
  assert.equal(map.pages[0]?.redirects?.[0]?.status, 301);
  assert.deepEqual(map.pages[0]?.internalLinks, ['https://example.com/about']);
  assert.equal(map.navigation.filter((item) => item.inScope).length, 1);
  assert.equal(map.navigation.filter((item) => !item.inScope).length, 1);
});

test('buildPageMap() does not invent gated pages — it only copies observed access=gated', () => {
  const publicPage = makeDiscoveredPage({ url: 'https://example.com/', access: 'public' });
  const map = buildPageMap(makeDiscoveryResult([publicPage]));
  assert.equal(map.pages.some((page) => page.access === 'gated'), false);
  assert.equal(map.pages.length, 1);
});
