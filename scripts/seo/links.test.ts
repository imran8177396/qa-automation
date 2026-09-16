import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProbedUrl, collectDiscoveredLinkUrls } from './links';
import { makeDiscoveredPage } from '../testing/discovery-fixtures';

test('classifyProbedUrl() distinguishes 200, 301, 404, and errors', () => {
  assert.equal(classifyProbedUrl(200), 'ok');
  assert.equal(classifyProbedUrl(301), 'redirect');
  assert.equal(classifyProbedUrl(404), 'not-found');
  assert.equal(classifyProbedUrl(500), 'error');
  assert.equal(classifyProbedUrl(null, 'timeout'), 'error');
});

test('collectDiscoveredLinkUrls() keeps same-origin hrefs and drops off-origin', () => {
  const urls = collectDiscoveredLinkUrls({
    origin: 'https://www.saucedemo.com',
    pages: [
      makeDiscoveredPage({
        url: 'https://www.saucedemo.com/',
        outboundLinks: [
          { href: 'https://www.saucedemo.com/inventory.html', text: 'Inventory' },
          { href: 'https://twitter.com/saucelabs', text: 'Twitter' },
        ],
      }),
    ],
    pageMap: null,
  });
  assert.ok(urls.some((url) => url.includes('inventory.html')));
  assert.ok(!urls.some((url) => url.includes('twitter.com')));
});
