import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRobotsTxt, looksLikeRobotsTxt, sitemapUrlsFromRobots } from './robots';
import type { ProbeResult } from '../security/probe';

function probe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    ok: true,
    status: 200,
    headers: { 'content-type': 'text/plain' },
    setCookies: [],
    body: 'User-agent: *\nDisallow:',
    finalUrl: 'https://www.saucedemo.com/robots.txt',
    ...overrides,
  };
}

const nextId = () => 'SEO-0001';

test('looksLikeRobotsTxt() accepts directives and rejects HTML SPA fallbacks', () => {
  assert.equal(looksLikeRobotsTxt('User-agent: *\nDisallow: /admin'), true);
  assert.equal(looksLikeRobotsTxt('<!DOCTYPE html><html><title>Swag Labs</title></html>', 'text/html'), false);
});

test('sitemapUrlsFromRobots() reads Sitemap lines', () => {
  assert.deepEqual(
    sitemapUrlsFromRobots('User-agent: *\nSitemap: https://example.com/sitemap.xml\n'),
    ['https://example.com/sitemap.xml']
  );
});

test('classifyRobotsTxt() FAILs a 404 and an HTML body', () => {
  const missing = classifyRobotsTxt({ origin: 'https://www.saucedemo.com', probe: probe({ status: 404, ok: false, body: '' }), nextId });
  assert.equal(missing.status, 'FAIL');

  const html = classifyRobotsTxt({
    origin: 'https://www.saucedemo.com',
    probe: probe({ body: '<html><body>login</body></html>', headers: { 'content-type': 'text/html' } }),
    nextId,
  });
  assert.equal(html.status, 'FAIL');
});

test('classifyRobotsTxt() PASSes a robots document', () => {
  const row = classifyRobotsTxt({ origin: 'https://www.saucedemo.com', probe: probe(), nextId });
  assert.equal(row.status, 'PASS');
});

test('classifyRobotsTxt() is BLOCKED when the GET errors', () => {
  const row = classifyRobotsTxt({
    origin: 'https://www.saucedemo.com',
    probe: probe({ ok: false, status: null, error: 'timeout', body: '' }),
    nextId,
  });
  assert.equal(row.status, 'BLOCKED');
});
