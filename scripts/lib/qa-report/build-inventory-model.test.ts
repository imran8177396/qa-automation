import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInventoryModel } from './build-inventory-model';
import type { UiInventory } from '../../discovery/ui-scan';
import type { QaConfig } from '../../types';

const config = { safety: { enabled: true } } as QaConfig;

test('UI inventory fallback applies classifyElements so risk labels reach the payload', () => {
  const ui: UiInventory = {
    generatedAt: '2026-09-09T00:00:00.000Z',
    seedUrl: 'https://example.test/',
    pagesScanned: 1,
    elements: [
      {
        page: 'https://example.test/',
        elementId: 'UI-0001',
        elementType: 'button',
        locator: 'text=Delete account',
        locatorCandidates: ['text=Delete account'],
        accessibleName: 'Delete account',
        visible: true,
        enabled: true,
        required: false,
        interactive: true,
        potentialAction: 'click',
        applicableTestTypes: ['visibility'],
        discoveryStatus: 'DISCOVERED',
        evidence: 'fixture',
        href: null,
        isSubmit: false,
      },
      {
        page: 'https://example.test/',
        elementId: 'UI-0002',
        elementType: 'link',
        locator: 'text=Home',
        locatorCandidates: ['text=Home'],
        accessibleName: 'Home',
        visible: true,
        enabled: true,
        required: false,
        interactive: true,
        potentialAction: 'click',
        applicableTestTypes: ['visibility'],
        discoveryStatus: 'DISCOVERED',
        evidence: 'fixture',
        href: '/',
        isSubmit: false,
      },
    ],
    categoryStatus: [],
  };

  const model = buildInventoryModel(null, ui, config);
  assert.equal(model.available, true);
  assert.equal(model.totalElements, 2);
  assert.ok(model.byRisk.length > 0, 'byRisk must not be an empty shell');
  const labels = model.byRisk.map((row) => row.label);
  assert.ok(labels.includes('destructive'), `expected destructive from Delete account, got ${labels.join(',')}`);
  assert.ok(labels.includes('safe'), `expected safe from Home, got ${labels.join(',')}`);
});
