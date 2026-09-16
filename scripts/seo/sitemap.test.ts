import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySitemapXml, looksLikeSitemapXml } from './sitemap';
import type { ProbeResult } from '../security/probe';

function probe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    ok: true,
    status: 200,
    headers: { 'content-type': 'application/xml' },
    setCookies: [],
    body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
    finalUrl: 'https://www.saucedemo.com/sitemap.xml',
    ...overrides,
  };
}

const nextId = () => 'SEO-0001';

test('looksLikeSitemapXml() accepts urlset and rejects HTML', () => {
  assert.equal(looksLikeSitemapXml('<urlset></urlset>'), true);
  assert.equal(looksLikeSitemapXml('<sitemapindex></sitemapindex>'), true);
  assert.equal(looksLikeSitemapXml('<!DOCTYPE html><html><title>Swag Labs</title></html>', 'text/html'), false);
});

test('classifySitemapXml() FAILs 404 and HTML fallback', () => {
  const missing = classifySitemapXml({
    url: 'https://www.saucedemo.com/sitemap.xml',
    origin: 'https://www.saucedemo.com',
    probe: probe({ status: 404, ok: false, body: '' }),
    nextId,
    source: 'well-known',
  });
  assert.equal(missing.status, 'FAIL');

  const html = classifySitemapXml({
    url: 'https://www.saucedemo.com/sitemap.xml',
    origin: 'https://www.saucedemo.com',
    probe: probe({ body: '<html><body>login</body></html>', headers: { 'content-type': 'text/html' } }),
    nextId,
    source: 'well-known',
  });
  assert.equal(html.status, 'FAIL');
});

test('classifySitemapXml() PASSes a urlset', () => {
  const row = classifySitemapXml({
    url: 'https://www.saucedemo.com/sitemap.xml',
    origin: 'https://www.saucedemo.com',
    probe: probe(),
    nextId,
    source: 'well-known',
  });
  assert.equal(row.status, 'PASS');
});
