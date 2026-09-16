import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonIfExists } from '../discovery/write-json';
import type { ApiInventory } from '../discovery/api-observe';
import type { PageMap } from '../discovery/page-map';
import { applicableTestTypes } from '../discovery/test-types';
import type { UiInventory } from '../discovery/ui-scan';
import type { WorkflowInventory } from '../discovery/workflows';
import { PATHS } from '../lib/paths';
import type { QaConfig } from '../types';
import { applyEvidence } from './match';
import { calculateCoverage } from './calculate';
import { buildInventory } from './inventory';
import { classifyItem, recommendedTestFor } from './status';
import { displayCoverageStatus, mapProjectStatus } from './project-status';

const config = {
  postman: { enabled: false, collectionName: 't', requests: [] },
  playwright: { enabled: true, baseURL: 'https://www.saucedemo.com', browsers: ['chromium'], headless: true },
  jmeter: { enabled: false },
  security: { enabled: true },
  seo: { enabled: true },
  content: { enabled: true },
} as unknown as QaConfig;

test('NOT_DISCOVERED table/dropdown categories are NOT APPLICABLE, not invented product rows', () => {
  const pageMap: PageMap = {
    generatedAt: new Date().toISOString(),
    seedUrl: 'https://www.saucedemo.com/',
    scopeHost: 'www.saucedemo.com',
    truncated: false,
    pages: [
      {
        url: 'https://www.saucedemo.com/',
        route: '/',
        title: 'Swag Labs',
        status: 200,
        ok: true,
        depth: 0,
        h1s: [],
        applicableTestTypes: applicableTestTypes('pages'),
      },
    ],
    routes: [{ path: '/', url: 'https://www.saucedemo.com/', title: 'Swag Labs', source: 'crawl' }],
    navigation: [],
    skippedByScope: [],
    categoryStatus: [
      { category: 'pages', status: 'DISCOVERED', count: 1 },
      { category: 'routes', status: 'DISCOVERED', count: 1 },
      {
        category: 'navigation',
        status: 'NOT_DISCOVERED',
        count: 0,
        reason: 'No <a href> links were observed on crawled pages',
      },
    ],
    pagesDiscoveredRaw: 1,
    pagesDiscoveredUnique: 1,
  };

  const ui: UiInventory = {
    generatedAt: new Date().toISOString(),
    seedUrl: 'https://www.saucedemo.com/',
    pagesScanned: 1,
    elements: [],
    categoryStatus: [
      { category: 'table', status: 'NOT_DISCOVERED', count: 0, reason: 'No table / role=table observed' },
      { category: 'select', status: 'NOT_DISCOVERED', count: 0, reason: 'No <select> observed' },
      { category: 'checkbox', status: 'NOT_DISCOVERED', count: 0, reason: 'No checkbox observed' },
      { category: 'radio', status: 'NOT_DISCOVERED', count: 0, reason: 'No radio observed' },
      { category: 'toggle', status: 'NOT_DISCOVERED', count: 0, reason: 'No role=switch observed' },
    ],
  };

  const items = buildInventory({ pageMap, ui, workflows: null, api: null }, config);
  const table = items.find((row) => row.id === 'CAT-table');
  const dropdown = items.find((row) => row.id === 'CAT-select');
  assert.ok(table, 'NOT_DISCOVERED table category must be listed');
  assert.ok(dropdown, 'NOT_DISCOVERED select/dropdown category must be listed');
  assert.equal(table.kind, 'table');
  assert.equal(dropdown.kind, 'dropdown');
  assert.equal(classifyItem(table, []).status, 'NOT APPLICABLE');
  assert.match(classifyItem(table, []).reason, /not observed in discovery|NOT_DISCOVERED/i);
  assert.ok(!table.locator, 'must not invent a table locator on the login page');
  assert.match(recommendedTestFor(table), /Do not invent/i);
  assert.equal(items.filter((row) => row.kind === 'table' && row.source === 'discovery').length, 1);
});

test('form-submit NOT_TESTED maps to BLOCKED; REQUIRES_CONFIGURATION maps to BLOCKED', () => {
  const workflows: WorkflowInventory = {
    generatedAt: new Date().toISOString(),
    seedUrl: 'https://www.saucedemo.com/',
    workflows: [
      {
        id: 'WF-0001',
        kind: 'form-submit',
        title: 'Form on https://www.saucedemo.com/',
        page: 'https://www.saucedemo.com/',
        status: 'NOT_TESTED',
        evidence: '<form>; submit is blocked by the safety policy',
        potentialAction: 'submit (NOT_TESTED — safety policy)',
        applicableTestTypes: applicableTestTypes('form'),
      },
      {
        id: 'WF-0002',
        kind: 'authentication',
        title: 'Potential authentication flow',
        page: 'https://www.saucedemo.com/',
        status: 'REQUIRES_CONFIGURATION',
        evidence: 'credentials are not assumed',
        potentialAction: 'authenticate (REQUIRES_CONFIGURATION)',
        applicableTestTypes: applicableTestTypes('authentication'),
      },
    ],
    categoryStatus: [],
  };

  const items = buildInventory({ pageMap: null, ui: null, workflows, api: null }, config);
  const submit = items.find((row) => row.id === 'WF-0001');
  const auth = items.find((row) => row.id === 'WF-0002');
  assert.ok(submit && auth);
  const submitClass = classifyItem(submit, []);
  const authClass = classifyItem(auth, []);
  assert.equal(submitClass.status, 'BLOCKED');
  assert.match(submitClass.reason, /NOT_TESTED|safety/i);
  assert.equal(authClass.status, 'BLOCKED');
  assert.match(authClass.reason, /REQUIRES_CONFIGURATION/i);
});

test('empty workflows.correlated is inventoried as NOT APPLICABLE, not omitted', () => {
  const items = buildInventory({ pageMap: null, ui: null, workflows: null, api: null }, config);
  const row = items.find((item) => item.id === 'WF-CORRELATED');
  assert.ok(row, 'UI↔API correlation must stay on the inventory when no pair exists');
  const classified = classifyItem(row, []);
  assert.equal(classified.status, 'NOT APPLICABLE');
  assert.match(classified.reason, /no discovered XHR|no documented UI/i);
});

test('mapProjectStatus() and SKIPPED display label stay explicit', () => {
  const discovered = mapProjectStatus('NOT_DISCOVERED', 'not observed in discovery');
  assert.equal(discovered?.coverageStatus, 'NOT APPLICABLE');
  assert.equal(displayCoverageStatus('SKIPPED'), 'SKIPPED WITH REASON');
  assert.equal(displayCoverageStatus('BLOCKED'), 'BLOCKED');
  const executed = mapProjectStatus('NOT_EXECUTED', 'planned-checks.json is absent');
  assert.equal(executed?.coverageStatus, 'SKIPPED');
  assert.match(executed?.reason ?? '', /SKIPPED WITH REASON/);
});

test('Part 3 Sauce Demo inventories do not invent APIs or claim 100% coverage', () => {
  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const workflows = readJsonIfExists<WorkflowInventory>(PATHS.workflowInventoryFile);
  const api = readJsonIfExists<ApiInventory>(PATHS.apiInventoryFile);
  assert.ok(pageMap && ui && workflows && api, 'Part 3 discovery inventories must exist under discovery/');

  const liveConfig = {
    ...config,
    postman: {
      enabled: true,
      collectionName: 't',
      requests: [{ method: 'GET', path: '/posts', enabled: true }],
    },
  } as unknown as QaConfig;

  const items = buildInventory({ pageMap, ui, workflows, api }, liveConfig);
  const report = calculateCoverage(applyEvidence(items, []), [], {
    seedUrl: pageMap.seedUrl,
    playwrightBaseUrl: 'https://www.saucedemo.com',
    notes: [],
    pagesDiscoveredRaw: pageMap.pagesDiscoveredRaw,
    pagesDiscoveredUnique: pageMap.pagesDiscoveredUnique,
  });

  assert.equal(pageMap.pages.length, 1);
  assert.equal(ui.elements.length, 4);
  assert.equal(api.calls.length, 0);
  assert.ok(items.some((row) => row.id === 'CAT-table' && row.kind === 'table'));
  assert.ok(items.some((row) => row.id === 'CAT-api' && row.kind === 'api'));
  assert.equal(
    items.filter((row) => row.kind === 'api' && row.source === 'discovery' && row.id.startsWith('API-DISC-')).length,
    0,
    'must not invent discovered Sauce Demo API calls'
  );
  assert.ok(report.totals.itemCoveragePercent < 100);
  assert.equal(report.totals.complete, false);
  assert.ok(report.totals.scopeCoveragePercent < 100);
  assert.notEqual(report.totals.passRatePercent, report.totals.itemCoveragePercent);
});
