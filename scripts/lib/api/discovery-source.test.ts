import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeApiDiscovery } from './discovery-source';
import type { ApiInventory } from '../../discovery/api-observe';

test('missing inventory reports 0 discovered APIs and does not invent endpoints', () => {
  const summary = summarizeApiDiscovery(null, 'https://www.saucedemo.com/');
  assert.equal(summary.inventoryPresent, false);
  assert.equal(summary.observedCallCount, 0);
  assert.match(summary.note, /0 xhr\/fetch\/websocket/i);
  assert.match(summary.note, /qa\.config\.json/i);
  assert.doesNotMatch(summary.note, /\/cart|\/inventory/);
});

test('empty discovery calls stay 0 and name config as the execution source', () => {
  const inventory: ApiInventory = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    seedUrl: 'https://www.saucedemo.com/',
    pagesObserved: 2,
    calls: [],
    categoryStatus: [],
  };
  const summary = summarizeApiDiscovery(inventory, 'https://www.saucedemo.com/');
  assert.equal(summary.inventoryPresent, true);
  assert.equal(summary.observedCallCount, 0);
  assert.match(summary.note, /Sauce Demo discovery found 0/i);
  assert.match(summary.note, /jsonplaceholder|qa\.config\.json/i);
});
