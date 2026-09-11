import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesExcludePattern,
  normalizeCrawlUrl,
  normalizeFindingUrl,
  parseQueryPairs,
  shouldDropQueryParam,
} from './url-normalize';

test('normalizeFindingUrl() lowercases and strips a trailing slash (SEO simple contract)', () => {
  assert.equal(normalizeFindingUrl('https://Example.com/Page/'), 'https://example.com/page');
  assert.equal(normalizeFindingUrl('/'), '/');
});

test('normalizeCrawlUrl() lowercases the host and keeps path case', () => {
  assert.equal(normalizeCrawlUrl('https://WWW.Example.COM/Work'), 'https://www.example.com/Work');
});

test('normalizeCrawlUrl() strips trailing slashes on non-root paths', () => {
  assert.equal(normalizeCrawlUrl('https://example.com/page/'), 'https://example.com/page');
  assert.equal(normalizeCrawlUrl('https://example.com/'), 'https://example.com/');
});

test('normalizeCrawlUrl() sorts remaining query parameters', () => {
  assert.equal(normalizeCrawlUrl('https://example.com/page?b=2&a=1'), 'https://example.com/page?a=1&b=2');
});

test('normalizeCrawlUrl() drops tracking params and keeps real query params', () => {
  assert.equal(normalizeCrawlUrl('https://example.com/page?utm_source=x&id=5'), 'https://example.com/page?id=5');
});

test('normalizeCrawlUrl() drops sort and pagination params', () => {
  assert.equal(normalizeCrawlUrl('https://example.com/list?page=2&sort=name&id=5'), 'https://example.com/list?id=5');
});

test('parseQueryPairs() splits Apache semicolon separators', () => {
  assert.deepEqual(parseQueryPairs('?C=N;O=D'), [
    ['C', 'N'],
    ['O', 'D'],
  ]);
  assert.deepEqual(parseQueryPairs('?C=M&O=A'), [
    ['C', 'M'],
    ['O', 'A'],
  ]);
});

test('shouldDropQueryParam() treats Apache C and O as droppable', () => {
  assert.equal(shouldDropQueryParam('C'), true);
  assert.equal(shouldDropQueryParam('O'), true);
  assert.equal(shouldDropQueryParam('id'), false);
});

test('normalizeCrawlUrl() collapses Apache autoindex ;C= / ;O= combinations onto the path', () => {
  const expected = 'https://example.com/work';
  assert.equal(normalizeCrawlUrl('https://example.com/work?C=N;O=D'), expected);
  assert.equal(normalizeCrawlUrl('https://example.com/work?C=M;O=A'), expected);
  assert.equal(normalizeCrawlUrl('https://example.com/work?C=S;O=A'), expected);
  assert.equal(normalizeCrawlUrl('https://example.com/work?C=D;O=D'), expected);
  assert.equal(normalizeCrawlUrl('https://example.com/work?C=N;O=A'), expected);
  assert.equal(normalizeCrawlUrl('https://example.com/work?C=M;O=D'), expected);
  assert.equal(normalizeCrawlUrl('https://example.com/work?C=S;O=D'), expected);
  assert.equal(normalizeCrawlUrl('https://example.com/work?C=D;O=A'), expected);
  assert.equal(normalizeCrawlUrl('https://example.com/work/?C=N;O=D'), expected);
});

test('normalizeCrawlUrl() collapses Apache autoindex & separators the same way', () => {
  assert.equal(normalizeCrawlUrl('https://example.com/work?C=N&O=A'), 'https://example.com/work');
  assert.equal(
    normalizeCrawlUrl('https://example.com/work/__next.work?C=N;O=D'),
    'https://example.com/work/__next.work'
  );
});

test('matchesExcludePattern() honours glob and regex-style patterns', () => {
  assert.equal(matchesExcludePattern('https://example.com/admin/users', ['/admin/**']), true);
  assert.equal(matchesExcludePattern('https://example.com/public', ['/admin/**']), false);
  assert.equal(matchesExcludePattern('https://example.com/logout', ['/logout']), true);
});
