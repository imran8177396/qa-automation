import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRiskAreas } from './risk-areas';
import type { CoverageRecord, InventoryItem } from './types';

function record(partial: Partial<CoverageRecord> & Pick<CoverageRecord, 'id' | 'kind' | 'status'>): CoverageRecord {
  return {
    page: 'https://www.saucedemo.com/',
    element: partial.id,
    type: partial.kind,
    reason: partial.reason ?? 'fixture',
    recommendedTest: 'n/a',
    ...partial,
  };
}

function workflow(id: string, name: string, status: InventoryItem['projectStatus']): InventoryItem {
  return {
    id,
    kind: 'workflow',
    name,
    source: 'discovery',
    projectStatus: status,
    applicableScenarios: [
      {
        id: 'valid-input',
        disposition: 'requires-configuration',
        reason: 'Authentication credentials are not assumed',
        tested: false,
        evidenceIds: [],
      },
    ],
  };
}

test('Sauce Demo login-only fixture lists catalog, XHR=0, and correlated-workflow risks — no invented routes', () => {
  const items: InventoryItem[] = [
    {
      id: 'PAGE-0001',
      kind: 'page',
      name: 'Swag Labs',
      page: 'https://www.saucedemo.com/',
      route: '/',
      source: 'discovery',
      applicableScenarios: [
        { id: 'page-load', disposition: 'executable', reason: 'login page', tested: true, evidenceIds: ['PW-1'] },
      ],
    },
    workflow('WF-0002', 'Potential authentication flow', 'REQUIRES_CONFIGURATION'),
    workflow('WF-0003', 'Behind-authentication inventory', 'REQUIRES_CONFIGURATION'),
    {
      id: 'CAT-api',
      kind: 'api',
      name: 'Discovered XHR/fetch/websocket APIs',
      source: 'discovery',
      coverageHint: 'not-applicable',
      applicableScenarios: [
        {
          id: 'visibility',
          disposition: 'not-implemented',
          reason: 'No xhr/fetch/websocket responses were observed',
          tested: false,
          evidenceIds: [],
        },
      ],
    },
    {
      id: 'WF-CORRELATED',
      kind: 'workflow',
      name: 'Documented UI+API correlated workflows',
      source: 'capability',
      coverageHint: 'not-applicable',
      applicableScenarios: [
        {
          id: 'ui-api-correlation',
          disposition: 'not-implemented',
          reason: 'no discovered XHR and no documented UI↔API pair',
          tested: false,
          evidenceIds: [],
        },
      ],
    },
    {
      id: 'A11Y-scan',
      kind: 'accessibility',
      name: 'Accessibility scan',
      source: 'capability',
      applicableScenarios: [
        { id: 'accessibility-scan', disposition: 'executable', reason: 'axe', tested: true, evidenceIds: ['A11Y-1'] },
      ],
    },
    {
      id: 'API-CFG-0001',
      kind: 'api',
      name: 'GET /posts',
      source: 'config',
      applicableScenarios: [
        { id: 'api-smoke', disposition: 'executable', reason: 'documented Postman request', tested: false, evidenceIds: [] },
      ],
    },
  ];

  const records = [
    record({ id: 'PAGE-0001', kind: 'page', status: 'FAILED', reason: 'page check failed' }),
    record({
      id: 'WF-0002',
      kind: 'workflow',
      status: 'BLOCKED',
      reason: 'Mapped from REQUIRES_CONFIGURATION → BLOCKED. credentials',
    }),
    record({
      id: 'WF-0003',
      kind: 'workflow',
      status: 'BLOCKED',
      reason: 'Mapped from REQUIRES_CONFIGURATION → BLOCKED. behind-auth catalog',
    }),
    record({ id: 'CAT-api', kind: 'api', status: 'NOT APPLICABLE', reason: 'not observed in discovery' }),
    record({
      id: 'WF-CORRELATED',
      kind: 'workflow',
      status: 'NOT APPLICABLE',
      reason: 'no discovered XHR and no documented UI↔API pair',
    }),
    record({
      id: 'A11Y-scan',
      kind: 'accessibility',
      status: 'FAILED',
      reason: 'Execution evidence failed (axe). Coverage still counts this item.',
    }),
    record({ id: 'API-CFG-0001', kind: 'api', status: 'UNCOVERED', reason: 'No Postman execution evidence' }),
  ];

  const areas = deriveRiskAreas(items, records);
  const ids = areas.map((row) => row.id);
  assert.ok(ids.includes('login-only-crawl'));
  assert.ok(ids.includes('authenticated-catalog'));
  assert.ok(ids.includes('product-xhr-absent'));
  assert.ok(ids.includes('correlated-workflows'));
  assert.ok(ids.includes('failed-accessibility'));
  assert.ok(ids.includes('uncovered-api'));
  assert.ok(areas.every((row) => !/inventory\.html|\/inventory|jsonplaceholder as sauce/i.test(row.reason)));
  assert.ok(areas.some((row) => /JSONPlaceholder|documented API/i.test(row.reason)));
  assert.equal(
    areas.find((row) => row.id === 'product-xhr-absent')?.reason.includes('not invented'),
    true
  );
});

test('does not invent extra Sauce Demo routes as risk items', () => {
  const areas = deriveRiskAreas(
    [
      {
        id: 'PAGE-0001',
        kind: 'page',
        name: 'Swag Labs',
        page: 'https://www.saucedemo.com/',
        source: 'discovery',
        applicableScenarios: [
          { id: 'page-load', disposition: 'executable', reason: 'login', tested: false, evidenceIds: [] },
        ],
      },
    ],
    [record({ id: 'PAGE-0001', kind: 'page', status: 'UNCOVERED', reason: 'no evidence' })]
  );
  const blob = JSON.stringify(areas);
  assert.ok(!blob.includes('/inventory.html'));
  assert.ok(!blob.includes('/cart.html'));
  assert.ok(!blob.includes('JSONPlaceholder as Sauce Demo'));
});
