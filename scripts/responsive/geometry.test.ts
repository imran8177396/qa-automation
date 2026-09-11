import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxesOverlap,
  boxOverflowsViewport,
  clipAmount,
  documentHasHorizontalOverflow,
  isCollapsed,
} from './geometry';

test('boxesOverlap() ignores a 1px shared edge', () => {
  const a = { x: 0, y: 0, width: 100, height: 40 };
  const b = { x: 100, y: 0, width: 80, height: 40 };
  assert.equal(boxesOverlap(a, b), false);
});

test('boxesOverlap() detects stacked collision', () => {
  const header = { x: 0, y: 0, width: 390, height: 80 };
  const hero = { x: 0, y: 40, width: 390, height: 200 };
  assert.equal(boxesOverlap(header, hero), true);
});

test('boxOverflowsViewport() allows a 2px slack', () => {
  assert.equal(boxOverflowsViewport({ x: 0, y: 0, width: 392, height: 20 }, 390), false);
  assert.equal(boxOverflowsViewport({ x: 0, y: 0, width: 420, height: 20 }, 390), true);
});

test('documentHasHorizontalOverflow() is the page-level scrollWidth check', () => {
  assert.equal(documentHasHorizontalOverflow(390, 390), false);
  assert.equal(documentHasHorizontalOverflow(480, 390), true);
});

test('isCollapsed() and clipAmount() are conservative', () => {
  assert.equal(isCollapsed({ x: 0, y: 0, width: 0, height: 20 }), true);
  assert.equal(clipAmount(100, 100), 0);
  assert.equal(clipAmount(140, 100), 38);
});
