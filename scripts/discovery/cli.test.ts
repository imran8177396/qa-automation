import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDiscoverUrl } from './cli';

test('resolveDiscoverUrl() accepts a positional URL', () => {
  assert.equal(resolveDiscoverUrl(['https://www.saucedemo.com/']).url, 'https://www.saucedemo.com/');
});

test('resolveDiscoverUrl() accepts --url=', () => {
  const result = resolveDiscoverUrl(['--url=https://www.saucedemo.com/', '--max-pages=8']);
  assert.equal(result.url, 'https://www.saucedemo.com/');
  assert.equal(result.maxPages, 8);
});

test('resolveDiscoverUrl() accepts --url <value>', () => {
  assert.equal(resolveDiscoverUrl(['--url', 'https://www.saucedemo.com/inventory.html']).url, 'https://www.saucedemo.com/inventory.html');
});

test('resolveDiscoverUrl() prefers --url= over a later positional leftover', () => {
  assert.equal(resolveDiscoverUrl(['--url=https://example.com/a', 'ignored']).url, 'https://example.com/a');
});
