import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyHeadings, skippedHeadingLevels } from './heading-structure';

test('skippedHeadingLevels() is empty for h1 then h2', () => {
  assert.deepEqual(skippedHeadingLevels([{ level: 'h1' }, { level: 'h2' }]), []);
});

test('skippedHeadingLevels() reports h1-h3 when only h4 exists', () => {
  assert.deepEqual(skippedHeadingLevels([{ level: 'h4', text: 'Accepted usernames are:' }]), [1, 2, 3]);
});

test('skippedHeadingLevels() reports a gap between h1 and h3', () => {
  assert.deepEqual(skippedHeadingLevels([{ level: 'h1' }, { level: 'h3' }]), [2]);
});

test('emptyHeadings() keeps headings with no text', () => {
  assert.equal(emptyHeadings([{ level: 'h1', text: '' }, { level: 'h2', text: 'Hello' }]).length, 1);
});
