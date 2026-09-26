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
  const result = resolveDiscoverUrl(['--url=https://example.com/a', 'ignored']);
  assert.equal(result.url, 'https://example.com/a');
  assert.equal(result.cliUrl, 'https://example.com/a');
});

test('resolveDiscoverUrl() uses last-target when no CLI URL is given', () => {
  const result = resolveDiscoverUrl(['--max-pages=3'], {
    lastTargetUrl: 'https://persisted.example/',
    envUrl: null,
    existingSeed: null,
  });
  assert.equal(result.url, 'https://persisted.example/');
  assert.equal(result.cliUrl, undefined);
  assert.equal(result.maxPages, 3);
});
