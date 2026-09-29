import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscoveryInventory,
  DISCOVERY_INVENTORY_CATEGORY_KEYS,
  type DiscoveryInventory,
} from './inventory';
import type { UiElementRecord } from './ui-scan';
import { applicableTestTypes } from './test-types';

function assertNoDemoHosts(inventory: DiscoveryInventory): void {
  const blob = JSON.stringify(inventory).toLowerCase();
  assert.equal(/saucedemo|jsonplaceholder|swag\s*labs/.test(blob), false);
}

function uiElement(partial: Partial<UiElementRecord> & Pick<UiElementRecord, 'page' | 'elementType'>): UiElementRecord {
  return {
    elementId: 'UI-0001',
    locator: null,
    locatorCandidates: [],
    accessibleName: null,
    visible: true,
    enabled: true,
    required: false,
    interactive: true,
    potentialAction: 'observe',
    applicableTestTypes: applicableTestTypes(partial.elementType),
    discoveryStatus: 'DISCOVERED',
    evidence: 'fixture',
    ...partial,
  };
}

test('buildDiscoveryInventory() always emits all ten category keys', () => {
  const inventory = buildDiscoveryInventory();
  for (const key of DISCOVERY_INVENTORY_CATEGORY_KEYS) {
    assert.ok(key in inventory, `missing array key ${key}`);
    assert.ok(Array.isArray(inventory[key]), `${key} must be an array`);
    assert.ok(inventory.coverage[key], `missing coverage for ${key}`);
  }
  assertNoDemoHosts(inventory);
});

test('buildDiscoveryInventory() maps fixture pages to pages only', () => {
  const inventory = buildDiscoveryInventory({
    pages: [
      { url: 'https://example.com/', title: 'Home' },
      { url: 'https://example.com/about', title: 'About' },
    ],
  });
  assert.deepEqual(
    inventory.pages.map((p) => p.url),
    ['https://example.com/', 'https://example.com/about']
  );
  assert.equal(inventory.coverage.pages.status, 'POPULATED');
  assert.equal(inventory.workflows.length, 0);
  assert.equal(inventory.coverage.workflows.status, 'NOT_IMPLEMENTED');
  assertNoDemoHosts(inventory);
});

test('buildDiscoveryInventory() maps API request with query param and does not invent params', () => {
  const withParam = buildDiscoveryInventory({
    apiRequests: [
      {
        method: 'GET',
        url: 'https://api.example.com/items?limit=10',
        query: { limit: '10' },
        name: 'list-items',
      },
    ],
  });
  assert.equal(withParam.apis.length, 1);
  assert.equal(withParam.apis[0].method, 'GET');
  assert.equal(withParam.apis[0].url, 'https://api.example.com/items?limit=10');
  assert.equal(withParam.apiParameters.length, 1);
  assert.equal(withParam.apiParameters[0].name, 'limit');
  assert.equal(withParam.apiParameters[0].location, 'query');
  assert.equal(withParam.coverage.apis.status, 'POPULATED');
  assert.equal(withParam.coverage.apiParameters.status, 'POPULATED');

  const noParam = buildDiscoveryInventory({
    apiRequests: [{ method: 'GET', path: '/health', name: 'health' }],
  });
  assert.equal(noParam.apis.length, 1);
  assert.equal(noParam.apiParameters.length, 0);
  assert.equal(noParam.coverage.apiParameters.status, 'EMPTY');
  assertNoDemoHosts(withParam);
  assertNoDemoHosts(noParam);
});

test('buildDiscoveryInventory() empty inputs yield empty arrays and no demo URLs', () => {
  const inventory = buildDiscoveryInventory({});
  for (const key of DISCOVERY_INVENTORY_CATEGORY_KEYS) {
    assert.equal(inventory[key].length, 0, `${key} must be empty`);
  }
  assert.equal(inventory.screens.length, 0);
  assert.equal(inventory.inventories.length, 0);
  assert.equal(inventory.unresolvedChannels.length, 0);
  assert.equal(inventory.coverage.workflows.status, 'NOT_IMPLEMENTED');
  assert.equal(inventory.coverage.externalIntegrations.status, 'NOT_IMPLEMENTED');
  assert.equal(inventory.coverage.criticalPaths.status, 'NOT_IMPLEMENTED');
  assertNoDemoHosts(inventory);
});

test('buildDiscoveryInventory() marks NOT_IMPLEMENTED categories empty with reasons', () => {
  const inventory = buildDiscoveryInventory({
    pages: [{ url: 'https://example.com/' }],
  });
  assert.equal(inventory.workflows.length, 0);
  assert.equal(inventory.coverage.workflows.status, 'NOT_IMPLEMENTED');
  assert.match(inventory.coverage.workflows.reason ?? '', /workflow inference is not implemented/i);

  assert.equal(inventory.externalIntegrations.length, 0);
  assert.equal(inventory.coverage.externalIntegrations.status, 'NOT_IMPLEMENTED');
  assert.match(
    inventory.coverage.externalIntegrations.reason ?? '',
    /external integration extraction is not implemented/i
  );

  assert.equal(inventory.criticalPaths.length, 0);
  assert.equal(inventory.coverage.criticalPaths.status, 'NOT_IMPLEMENTED');
  assert.match(
    inventory.coverage.criticalPaths.reason ?? '',
    /critical-path ranking is not implemented/i
  );
});

test('buildDiscoveryInventory() auth stays empty without auth evidence (login substring alone is not enough without route match)', () => {
  // Path "/catalogue-login-help" does not match AUTH_ROUTE segment boundaries.
  const inventory = buildDiscoveryInventory({
    pages: [{ url: 'https://example.com/catalogue-login-help', route: '/catalogue-login-help' }],
  });
  assert.equal(inventory.authenticationPoints.length, 0);
  assert.equal(inventory.coverage.authenticationPoints.status, 'EMPTY');
  assert.match(
    inventory.coverage.authenticationPoints.reason ?? '',
    /no authentication point was discovered/i
  );
});

test('buildDiscoveryInventory() treats /login path and password input as generic auth evidence', () => {
  const fromRoute = buildDiscoveryInventory({
    pages: [{ url: 'https://example.com/login', route: '/login', title: 'Sign in' }],
  });
  assert.equal(fromRoute.authenticationPoints.length, 1);
  assert.equal(fromRoute.authenticationPoints[0].url, 'https://example.com/login');
  assert.match(fromRoute.authenticationPoints[0].evidence, /generic auth segment/i);
  assert.equal(fromRoute.coverage.authenticationPoints.status, 'POPULATED');

  const fromPassword = buildDiscoveryInventory({
    pages: [{ url: 'https://example.com/account' }],
    uiElements: [
      uiElement({
        page: 'https://example.com/account',
        elementType: 'input',
        inputType: 'password',
        locator: '#password',
        accessibleName: 'Password',
        evidence: 'input (type=password)',
      }),
    ],
  });
  assert.equal(fromPassword.authenticationPoints.length, 1);
  assert.equal(fromPassword.authenticationPoints[0].selector, '#password');
  assert.match(fromPassword.authenticationPoints[0].evidence, /password input/i);
});

test('buildDiscoveryInventory() critical paths stay empty without an explicit critical flag', () => {
  const inventory = buildDiscoveryInventory({
    pages: [{ url: 'https://example.com/', title: 'Home' }],
  });
  assert.equal(inventory.criticalPaths.length, 0);
  assert.equal(inventory.coverage.criticalPaths.status, 'NOT_IMPLEMENTED');

  const flagged = buildDiscoveryInventory({
    pages: [{ url: 'https://example.com/checkout', title: 'Checkout', critical: true }],
  });
  assert.equal(flagged.criticalPaths.length, 1);
  assert.equal(flagged.criticalPaths[0].url, 'https://example.com/checkout');
  assert.equal(flagged.coverage.criticalPaths.status, 'POPULATED');
});

test('buildDiscoveryInventory() maps forms and data inputs from UI scan element types', () => {
  const inventory = buildDiscoveryInventory({
    uiElements: [
      uiElement({
        page: 'https://example.com/contact',
        elementType: 'form',
        locator: 'form',
        formMethod: 'post',
        accessibleName: 'Contact',
      }),
      uiElement({
        page: 'https://example.com/contact',
        elementType: 'input',
        locator: '#email',
        inputType: 'email',
        accessibleName: 'Email',
      }),
      uiElement({
        page: 'https://example.com/contact',
        elementType: 'link',
        locator: 'a[href="/"]',
        accessibleName: 'Home',
        href: '/',
      }),
    ],
  });
  assert.equal(inventory.forms.length, 1);
  assert.equal(inventory.forms[0].method, 'post');
  assert.equal(inventory.coverage.forms.status, 'POPULATED');
  assert.equal(inventory.dataInputs.length, 1);
  assert.equal(inventory.dataInputs[0].elementType, 'input');
  assert.equal(inventory.uiElements.length, 3);
  assert.equal(inventory.coverage.uiElements.status, 'POPULATED');
  assert.equal(inventory.coverage.dataInputs.status, 'POPULATED');
});

test('buildDiscoveryInventory() persists authenticatedCoverage next to screens', () => {
  const coverage = {
    layers: [
      {
        gate: 'public' as const,
        status: 'DISCOVERED' as const,
        reason: 'screens crawled without an authentication gate',
        screenIds: ['SCREEN-001'],
      },
      {
        gate: 'login' as const,
        status: 'NOT_TESTED' as const,
        reason: 'no login screen was discovered',
        screenIds: [],
      },
      {
        gate: 'role' as const,
        status: 'REQUIRES_CONFIGURATION' as const,
        reason: 'role was not supplied',
        screenIds: [],
      },
    ],
    publicScreenIds: ['SCREEN-001'],
  };
  const inventory = buildDiscoveryInventory({
    pages: [{ url: 'https://example.com/' }],
    screens: [
      {
        id: 'SCREEN-001',
        url: 'https://example.com/',
        state: 'default',
        source: 'direct-url',
      },
    ],
    authenticatedCoverage: coverage,
  });
  assert.ok(inventory.authenticatedCoverage);
  assert.deepEqual(inventory.authenticatedCoverage?.publicScreenIds, ['SCREEN-001']);
  assert.equal(inventory.authenticatedCoverage?.layers.find((l) => l.gate === 'role')?.status, 'REQUIRES_CONFIGURATION');
  assert.equal(inventory.screens.length, 1);
  assertNoDemoHosts(inventory);
});
