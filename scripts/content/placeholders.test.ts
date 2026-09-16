import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPlaceholderHits } from './placeholders';

test('findPlaceholderHits() detects lorem ipsum, TODO, TBD, and your text here', () => {
  const hits = findPlaceholderHits('Intro lorem ipsum dolor TODO later TBD and your text here');
  assert.ok(hits.some((hit) => hit.id === 'lorem-ipsum'));
  assert.ok(hits.some((hit) => hit.id === 'todo'));
  assert.ok(hits.some((hit) => hit.id === 'tbd'));
  assert.ok(hits.some((hit) => hit.id === 'placeholder-copy'));
});

test('findPlaceholderHits() does not treat ordinary login copy as a placeholder', () => {
  const hits = findPlaceholderHits('Accepted usernames are: standard_user. Password for all users: secret_sauce.');
  assert.deepEqual(hits, []);
});
