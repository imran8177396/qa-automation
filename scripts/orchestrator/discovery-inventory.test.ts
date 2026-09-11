import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDiscoveryInventory } from './discovery-inventory';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';

describe('buildDiscoveryInventory', () => {
  it('writes an InventoryResult from discovered UI elements without inventing pages', () => {
    const pageMap: PageMap = {
      generatedAt: '2026-09-09T00:00:00.000Z',
      seedUrl: 'http://127.0.0.1:4173/',
      scopeHost: '127.0.0.1:4173',
      truncated: false,
      pages: [
        {
          url: 'http://127.0.0.1:4173/',
          route: '/',
          title: 'Home',
          status: 200,
          ok: true,
          depth: 0,
          h1s: ['Home'],
          applicableTestTypes: [],
        },
      ],
      routes: [],
      navigation: [],
      skippedByScope: [],
      categoryStatus: [],
    };
    const ui: UiInventory = {
      generatedAt: '2026-09-09T00:00:00.000Z',
      seedUrl: 'http://127.0.0.1:4173/',
      pagesScanned: 1,
      elements: [
        {
          page: 'http://127.0.0.1:4173/',
          elementId: 'EL-0001',
          elementType: 'button',
          locator: 'text=Save',
          locatorCandidates: ['text=Save'],
          accessibleName: 'Save',
          visible: true,
          enabled: true,
          required: false,
          interactive: true,
          potentialAction: 'click',
          applicableTestTypes: [],
          discoveryStatus: 'DISCOVERED',
          evidence: 'button',
        },
      ],
      categoryStatus: [],
    };

    const inventory = buildDiscoveryInventory(pageMap, ui, {
      enabled: true,
      dangerKeywords: [],
      allowlist: [],
    });
    assert.equal(inventory.pages, 1);
    assert.equal(inventory.elements.length, 1);
    assert.equal(inventory.elements[0]?.type, 'button');
    assert.equal(inventory.elements[0]?.label, 'Save');
  });
});
