import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redirectChain } from './redirects';

test('redirectChain() is empty when there is no response', async () => {
  assert.deepEqual(await redirectChain(null, 'https://example.com/'), []);
});
