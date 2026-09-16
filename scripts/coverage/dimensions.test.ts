import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDimensions } from './dimensions';
import { REQUIRED_COVERAGE_DIMENSION_IDS } from './types';
import type { CoverageRecord, InventoryItem } from './types';

test('all 13 contract dimensions are first-class even when a kind is empty', () => {
  const items: InventoryItem[] = [
    {
      id: 'PAGE-0001',
      kind: 'page',
      name: 'Home',
      source: 'discovery',
      applicableScenarios: [
        { id: 'page-load', disposition: 'executable', reason: 'load', tested: false, evidenceIds: [] },
      ],
    },
  ];
  const records: CoverageRecord[] = [
    {
      id: 'PAGE-0001',
      page: '/',
      element: 'Home',
      type: 'page',
      kind: 'page',
      status: 'UNCOVERED',
      reason: 'no evidence',
      recommendedTest: 'n/a',
    },
  ];

  const dimensions = calculateDimensions(items, records);
  const ids = dimensions.map((row) => row.id);
  for (const id of REQUIRED_COVERAGE_DIMENSION_IDS) {
    assert.ok(ids.includes(id), `missing required dimension ${id}`);
  }
  assert.ok(ids.includes('ui'));
  assert.ok(ids.includes('field'));
  assert.ok(ids.includes('button'));
  assert.ok(ids.includes('link'));
  assert.ok(ids.includes('form'));
  assert.equal(ids.includes('ui'), true);
  assert.equal(dimensions.find((row) => row.id === 'ui')?.label, 'UI coverage');
  assert.equal(dimensions.find((row) => row.id === 'field')?.discovered, 0);
});
