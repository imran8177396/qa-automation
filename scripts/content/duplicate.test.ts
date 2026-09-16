import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, duplicateContentGroups } from './duplicate';

test('duplicateContentGroups() groups identical normalized text', () => {
  const groups = duplicateContentGroups([
    { url: 'https://example.com/a', text: 'Hello   WORLD and enough visible copy for a hash' },
    { url: 'https://example.com/b', text: 'hello world and enough visible copy for a hash' },
    { url: 'https://example.com/c', text: 'Something else entirely that is long enough' },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.sort(), ['https://example.com/a', 'https://example.com/b']);
});

test('contentHash() is stable for whitespace differences', () => {
  assert.equal(contentHash('Hello   WORLD'), contentHash('hello world'));
});
