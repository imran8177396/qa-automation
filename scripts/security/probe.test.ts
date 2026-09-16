import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinUrl, normalizeHeaders, pagePathOf } from './probe';

test('joinUrl() and pagePathOf() stay origin-safe', () => {
  assert.equal(joinUrl('https://jsonplaceholder.typicode.com', '/posts'), 'https://jsonplaceholder.typicode.com/posts');
  assert.equal(pagePathOf('https://www.saucedemo.com/inventory.html'), '/inventory.html');
});

test('normalizeHeaders() lowercases names', () => {
  const headers = new Headers({ 'X-Content-Type-Options': 'nosniff' });
  assert.equal(normalizeHeaders(headers)['x-content-type-options'], 'nosniff');
});
