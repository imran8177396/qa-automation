/**
 * API–UI chain planner tests — association only; no network, no DB, no POST invent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { DiscoveredScreen } from '../discovery/screens';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import {
  buildApiUiChainForElement,
  buildApiUiChains,
  resolveApiUiMethod,
  type ApiUiElement,
} from './api-ui-chain';
import { buildScenarioInventory } from './scenario-inventory';

function pageMap(pages: PageMap['pages']): PageMap {
  return {
    generatedAt: new Date().toISOString(),
    seedUrl: 'http://app.test/',
    scopeHost: 'app.test',
    truncated: false,
    pages,
    routes: pages.map((page) => ({ path: page.route, url: page.url, title: page.title, source: 'crawl' })),
    navigation: [],
    skippedByScope: [],
    categoryStatus: [],
  };
}

function page(route: string, status = 200): PageMap['pages'][number] {
  return {
    url: `http://app.test${route}`,
    route,
    title: route,
    status,
    ok: status < 400,
    depth: 0,
    h1s: status < 400 ? ['Heading'] : [],
    applicableTestTypes: applicableTestTypes('pages'),
  };
}

function element(overrides: Partial<ApiUiElement>): ApiUiElement {
  return {
    page: 'http://app.test/form.html',
    elementId: 'UI-0001',
    elementType: 'button',
    tag: 'button',
    locator: '#btn',
    locatorCandidates: ['#btn'],
    accessibleName: 'Save',
    visible: true,
    enabled: true,
    required: false,
    interactive: true,
    potentialAction: 'click',
    applicableTestTypes: ['form-presence'],
    discoveryStatus: 'DISCOVERED',
    evidence: 'button',
    elementKind: 'button',
    ...overrides,
  };
}

function ui(elements: UiElementRecord[]): UiInventory {
  return {
    generatedAt: new Date().toISOString(),
    seedUrl: 'http://app.test/',
    pagesScanned: 1,
    elements,
    categoryStatus: [],
  };
}

const safety = resolveSafetyConfig();

const emptyScreens: DiscoveredScreen[] = [];

function planById(plans: ReturnType<typeof buildApiUiChains>[number]['plans'], id: string) {
  return plans.find((p) => p.subcaseId === id);
}

test('button with requestUrl and no method → one chain, method null, database NOT_OBSERVED', () => {
  const btn = element({
    elementId: 'UI-API',
    requestUrl: 'https://api.example.test/users',
  });
  const results = buildApiUiChains({
    elements: [btn],
    screens: emptyScreens,
    defaultScreenId: 'SCREEN-001',
    pageUrl: btn.page,
    label: 'save',
  });

  assert.equal(results.length, 1);
  const { chain, plans } = results[0]!;
  assert.equal(chain.chainId, 'CHAIN-001');
  assert.equal(chain.method, null);
  assert.equal(chain.url, 'https://api.example.test/users');
  assert.equal(chain.database, 'NOT_OBSERVED');
  assert.equal(resolveApiUiMethod(btn), null);
  assert.doesNotMatch(JSON.stringify(results), /\bPOST\b/);

  const request = planById(plans, 'api-ui-request');
  assert.ok(request);
  assert.equal(request!.status, 'NOT_TESTED');
  assert.match(request!.reason ?? '', /HTTP method was not recorded/i);
  assert.equal(request!.expect?.href, 'https://api.example.test/users');
  assert.equal(request!.action, 'none');

  const behavior = planById(plans, 'api-ui-behavior');
  assert.equal(behavior!.status, 'PLANNED');
  assert.equal(behavior!.action, 'observe');

  const response = planById(plans, 'api-ui-response');
  assert.equal(response!.status, 'NOT_TESTED');
  assert.match(response!.reason ?? '', /response was not recorded/i);
  assert.match(response!.reason ?? '', /SPECIFICATION_REQUIRED/);

  const database = planById(plans, 'api-ui-database');
  assert.equal(database!.status, 'NOT_TESTED');
  assert.match(database!.reason ?? '', /database effect was not observed/i);

  assert.equal(plans.every((p) => p.action === 'observe' || p.action === 'none'), true);
  assert.equal(
    plans.every((p) => p.completeSuccess === false || p.completeSuccess === null),
    true
  );
});

test('requestMethod POST + expected 201 + actual 201 → response PASS; completeSuccess not true', () => {
  const btn = element({
    requestUrl: 'https://api.example.test/users',
    requestMethod: 'POST',
    expectedStatus: 201,
    actualStatus: 201,
  });
  const built = buildApiUiChainForElement({
    element: btn,
    screenId: 'SCREEN-001',
    chainId: 'CHAIN-001',
    screens: emptyScreens,
    pageUrl: btn.page,
    label: 'create',
  });
  assert.ok(built);
  assert.equal(built!.chain.method, 'POST');

  const response = planById(built!.plans, 'api-ui-response');
  assert.ok(response);
  assert.equal(response!.status, 'PASS');
  assert.match(response!.reason ?? '', /201/);
  assert.notEqual(response!.completeSuccess, true);
  assert.equal(response!.completeSuccess, false);

  const request = planById(built!.plans, 'api-ui-request');
  assert.equal(request!.status, 'PLANNED');
  assert.equal(request!.action, 'observe');
  assert.match(request!.reason ?? '', /POST/);
  assert.match(request!.reason ?? '', /not sent/i);
});

test('expected 201 actual 500 → FAIL reason contains both codes', () => {
  const btn = element({
    requestUrl: 'https://api.example.test/users',
    requestMethod: 'POST',
    expectedStatus: 201,
    actualStatus: 500,
  });
  const built = buildApiUiChainForElement({
    element: btn,
    screenId: 'SCREEN-001',
    chainId: 'CHAIN-001',
    screens: emptyScreens,
    pageUrl: btn.page,
    label: 'create',
  });
  const response = planById(built!.plans, 'api-ui-response');
  assert.equal(response!.status, 'FAIL');
  assert.match(response!.reason ?? '', /201/);
  assert.match(response!.reason ?? '', /500/);
  assert.notEqual(response!.completeSuccess, true);
});

test('no requestUrl → zero chains', () => {
  const btn = element({ elementId: 'UI-PLAIN' });
  const results = buildApiUiChains({
    elements: [btn],
    screens: emptyScreens,
    defaultScreenId: 'SCREEN-001',
  });
  assert.equal(results.length, 0);
});

test('payload containing password=secret is masked; raw secret absent', () => {
  const btn = element({
    requestUrl: 'https://api.example.test/login',
    requestMethod: 'POST',
    requestBody: 'password=secret&user=alice',
  });
  const built = buildApiUiChainForElement({
    element: btn,
    screenId: 'SCREEN-001',
    chainId: 'CHAIN-001',
    screens: emptyScreens,
    pageUrl: btn.page,
    label: 'login',
  });
  const payload = planById(built!.plans, 'api-ui-payload');
  assert.equal(payload!.status, 'PLANNED');
  assert.equal(payload!.action, 'observe');
  assert.ok(payload!.maskedPayload);
  assert.match(payload!.maskedPayload!, /\[MASKED\]/);
  assert.doesNotMatch(payload!.maskedPayload!, /\bsecret\b/);
  assert.doesNotMatch(JSON.stringify(built!.plans), /password=secret/);
});

test('method from attributes only — never invents POST when absent', () => {
  const withAttr = element({
    requestUrl: 'https://api.example.test/items',
    attributes: { 'data-method': 'PUT' },
  });
  assert.equal(resolveApiUiMethod(withAttr), 'PUT');

  const submitOnly = element({
    requestUrl: 'https://api.example.test/items',
    isSubmit: true,
    formMethod: 'POST',
  });
  // formMethod alone is not used — would invent association without requestMethod evidence field/attr.
  assert.equal(resolveApiUiMethod(submitOnly), null);
});

test('sibling success screen state → api-ui-ui-state PLANNED observe; request not replayed', () => {
  const btn = element({
    requestUrl: 'https://api.example.test/users',
    page: 'http://app.test/form.html',
  });
  const screens: DiscoveredScreen[] = [
    {
      id: 'SCREEN-001',
      url: 'http://app.test/form.html',
      state: 'default',
      source: 'direct-url',
    },
    {
      id: 'SCREEN-002',
      url: 'http://app.test/form.html',
      state: 'success',
      source: 'scan-evidence',
    },
  ];
  const built = buildApiUiChainForElement({
    element: btn,
    screenId: 'SCREEN-001',
    chainId: 'CHAIN-001',
    screens,
    pageUrl: btn.page,
    label: 'save',
  });
  const uiState = planById(built!.plans, 'api-ui-ui-state');
  assert.equal(uiState!.status, 'PLANNED');
  assert.equal(uiState!.action, 'observe');
  assert.match(uiState!.reason ?? '', /not replayed/i);
});

test('scenario-inventory emits api-ui rows with button-submit-api; no fetch; no demo product hosts', () => {
  const btn = element({
    elementId: 'UI-SUBMIT',
    elementKind: 'submit-button',
    isSubmit: true,
    locator: '#submit',
    accessibleName: 'Submit',
    requestUrl: 'https://api.example.test/users',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([btn]), safety);
  const apiUi = checks.filter((c) => c.scenarioKind === 'api-ui');
  assert.ok(apiUi.length >= 7, `expected api-ui rows, got ${apiUi.length}`);
  assert.ok(apiUi.some((c) => c.id.includes('api-ui-behavior')));
  assert.ok(apiUi.some((c) => c.id.includes('api-ui-request')));
  assert.ok(apiUi.some((c) => c.id.includes('api-ui-database')));

  const submitApi = checks.find(
    (c) => c.scenarioKind === 'button' && typeof c.id === 'string' && c.id.endsWith('button-submit-api')
  );
  assert.ok(submitApi, 'button-submit-api row should still exist');
  assert.equal(submitApi!.status, 'NOT_TESTED');

  const blob = JSON.stringify(checks);
  assert.doesNotMatch(blob, /jsonplaceholder|reqres\.in|httpbin|demo\.qa/i);
  assert.doesNotMatch(blob, /"action":"submit"/);
  assert.ok(apiUi.every((c) => c.action === 'observe' || c.action === 'none'));
});

test('database row always NOT_TESTED; never claims row inserted', () => {
  const btn = element({
    requestUrl: 'https://api.example.test/users',
    requestMethod: 'POST',
    expectedStatus: 201,
    actualStatus: 201,
  });
  const results = buildApiUiChains({
    elements: [btn],
    screens: emptyScreens,
    defaultScreenId: 'SCREEN-001',
  });
  const database = planById(results[0]!.plans, 'api-ui-database');
  assert.equal(database!.status, 'NOT_TESTED');
  assert.doesNotMatch(database!.reason ?? '', /inserted|created row|wrote to (db|database)/i);
  assert.equal(results[0]!.chain.database, 'NOT_OBSERVED');
});
