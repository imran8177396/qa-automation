import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInScope, mapWithConcurrency, normalizeUrl, resolveScopeAnchor } from './scope';

test('normalizeUrl() strips fragments', () => {
  assert.equal(normalizeUrl('https://example.com/page#section'), 'https://example.com/page');
});

test('normalizeUrl() strips utm_* tracking params but keeps real query params', () => {
  const result = normalizeUrl('https://example.com/page?utm_source=x&id=5');
  assert.equal(result, 'https://example.com/page?id=5');
});

test('normalizeUrl() strips a trailing slash on non-root paths', () => {
  assert.equal(normalizeUrl('https://example.com/page/'), 'https://example.com/page');
});

test('normalizeUrl() keeps the root path as /', () => {
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com/');
});

test('normalizeUrl() strips default ports', () => {
  assert.equal(normalizeUrl('https://example.com:443/page'), 'https://example.com/page');
  assert.equal(normalizeUrl('http://example.com:80/page'), 'http://example.com/page');
});

test('normalizeUrl() collapses Apache autoindex C/O params with ; or &', () => {
  assert.equal(normalizeUrl('https://example.com/work?C=N;O=D'), 'https://example.com/work');
  assert.equal(normalizeUrl('https://example.com/work?C=M&O=A'), 'https://example.com/work');
});

test('isInScope() allows the anchor host itself', () => {
  const anchor = resolveScopeAnchor('https://example.com/');
  assert.equal(isInScope('https://example.com/other', anchor, true), true);
});

test('isInScope() rejects an unrelated host by default (sameOriginOnly)', () => {
  const anchor = resolveScopeAnchor('https://example.com/');
  assert.equal(isInScope('https://not-example.com/', anchor, true), false);
});

test('isInScope() rejects a subdomain when sameOriginOnly is true', () => {
  const anchor = resolveScopeAnchor('https://example.com/');
  assert.equal(isInScope('https://blog.example.com/', anchor, true), false);
});

test('isInScope() allows a subdomain only when sameOriginOnly is false', () => {
  const anchor = resolveScopeAnchor('https://example.com/');
  assert.equal(isInScope('https://blog.example.com/', anchor, false), true);
});

test('isInScope() allows an explicitly configured additional host', () => {
  const anchor = resolveScopeAnchor('https://example.com/', ['assets.other.com']);
  assert.equal(isInScope('https://assets.other.com/img.png', anchor, true), true);
});

test('isInScope() rejects non-http(s) protocols', () => {
  const anchor = resolveScopeAnchor('https://example.com/');
  assert.equal(isInScope('mailto:test@example.com', anchor, true), false);
  assert.equal(isInScope('javascript:void(0)', anchor, true), false);
});

test('isInScope() rejects an unparseable URL rather than throwing', () => {
  const anchor = resolveScopeAnchor('https://example.com/');
  assert.equal(isInScope('not a url', anchor, true), false);
});

test('mapWithConcurrency() processes every item exactly once, in index order', async () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const seen: number[] = [];
  const results = await mapWithConcurrency(items, 4, async (item) => {
    seen.push(item);
    return item * 2;
  });

  assert.deepEqual(results, items.map((i) => i * 2));
  assert.deepEqual([...seen].sort((a, b) => a - b), items);
});

test('mapWithConcurrency() tolerates a concurrency limit larger than the item count', async () => {
  const results = await mapWithConcurrency([1, 2], 10, async (item) => item + 1);
  assert.deepEqual(results, [2, 3]);
});

test('mapWithConcurrency() tolerates an empty item list', async () => {
  const results = await mapWithConcurrency<number, number>([], 4, async (item) => item);
  assert.deepEqual(results, []);
});
