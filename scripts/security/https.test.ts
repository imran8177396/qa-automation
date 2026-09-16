import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectHttpsFinding } from './https';

test('collectHttpsFinding() PASSes an https website', () => {
  const row = collectHttpsFinding({ url: 'https://www.saucedemo.com/', isLoopback: false });
  assert.equal(row.status, 'PASS');
  assert.equal(row.rule, 'https-scheme');
});

test('collectHttpsFinding() marks loopback HTTP as NOT_APPLICABLE', () => {
  const row = collectHttpsFinding({ url: 'http://127.0.0.1:4173/', isLoopback: true });
  assert.equal(row.status, 'NOT_APPLICABLE');
});

test('collectHttpsFinding() FAILs live HTTP', () => {
  const row = collectHttpsFinding({ url: 'http://example.com/', isLoopback: false });
  assert.equal(row.status, 'FAIL');
});

test('collectHttpsFinding() BLOCKs an unparseable URL', () => {
  const row = collectHttpsFinding({ url: 'not-a-url', isLoopback: false });
  assert.equal(row.status, 'BLOCKED');
});
