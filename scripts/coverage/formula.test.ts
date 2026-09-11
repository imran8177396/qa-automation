import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicableScenarios } from './scenarios';
import { applyEvidence } from './match';
import { calculateCoverage } from './calculate';
import { buildInventory } from './inventory';
import {
  COVERAGE_IS_NOT_PASS_RATE,
  deriveCoverageFormula,
  ELEMENT_COVERAGE_KINDS,
  FUNCTIONAL_AREA_COVERAGE_KINDS,
  TESTABLE_ITEM_DEFINITION,
} from './formula';
import type { ExecutionEvidence, InventoryItem } from './types';
import type { PageMap } from '../discovery/page-map';
import { applicableTestTypes } from '../discovery/test-types';
import type { QaConfig } from '../types';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'kind' | 'name'>): InventoryItem {
  return {
    source: 'discovery',
    applicableScenarios: applicableScenarios({
      kind: partial.kind,
      pageStatus: 200,
      elementType: partial.elementType,
    }),
    ...partial,
  };
}

function evidence(partial: Partial<ExecutionEvidence> & Pick<ExecutionEvidence, 'id' | 'title'>): ExecutionEvidence {
  return {
    source: 'playwright',
    urlHints: [],
    locatorHints: [],
    status: 'PASS',
    executed: true,
    ...partial,
  };
}

function pageEntry(url: string, title: string): PageMap['pages'][number] {
  return {
    url,
    route: new URL(url).pathname + new URL(url).search,
    title,
    status: 200,
    ok: true,
    depth: 1,
    h1s: [title],
    applicableTestTypes: applicableTestTypes('pages'),
  };
}

test('coverage formula publishes definition, two figures, and per-dimension contributions', () => {
  const items = [
    item({ id: 'PAGE-0001', kind: 'page', name: 'Home', page: 'https://example.com/' }),
    item({ id: 'UI-0001', kind: 'field', name: 'email', page: 'https://example.com/', locator: '#email', elementType: 'input' }),
    item({ id: 'API-CFG-0001', kind: 'api', name: 'GET /', source: 'config' }),
    item({ id: 'WF-0001', kind: 'workflow', name: 'Signup', source: 'discovery' }),
  ];
  const rows: ExecutionEvidence[] = [];
  const report = calculateCoverage(applyEvidence(items, rows), rows, {
    seedUrl: 'https://example.com/',
    playwrightBaseUrl: 'https://example.com/',
    notes: ['Coverage is covered (TESTED + FAILED) ÷ testable discovered items. Pass rate is not coverage.'],
    pagesDiscoveredRaw: 8,
    pagesDiscoveredUnique: 1,
  });

  const formula = report.formula;
  assert.equal(formula.testableItemDefinition, TESTABLE_ITEM_DEFINITION);
  assert.equal(formula.coverageIsNotPassRate, true);
  assert.equal(formula.denominatorAfterDedupe, true);
  assert.equal(formula.warning, COVERAGE_IS_NOT_PASS_RATE);
  assert.match(formula.coverageDefinition, /TESTED or FAILED/);
  assert.equal(formula.figures.elementCoverage.label, 'Element coverage');
  assert.equal(formula.figures.functionalAreaCoverage.label, 'Functional-area coverage');
  assert.deepEqual(formula.figures.elementCoverage.kinds, [...ELEMENT_COVERAGE_KINDS]);
  assert.deepEqual(formula.figures.functionalAreaCoverage.kinds, [...FUNCTIONAL_AREA_COVERAGE_KINDS]);
  assert.ok(formula.contributions.pages);
  assert.ok(formula.contributions.interactiveElements);
  assert.ok(formula.contributions.endpoints);
  assert.ok(formula.contributions.workflows);
  assert.equal(formula.contributions.pages.discoveredRaw, 8);
  assert.equal(formula.contributions.pages.discoveredUnique, 1);
  assert.equal(formula.contributions.pages.testable, 1);
  assert.equal(formula.contributions.pages.covered, 0);
  assert.equal(formula.figures.elementCoverage.testable, 1);
  assert.equal(formula.figures.functionalAreaCoverage.testable, 3);
  assert.ok(Array.isArray(formula.excludedItems));
  assert.notEqual(report.totals.passRatePercent, report.totals.itemCoveragePercent);
});

test('inventory denominator collapses Apache autoindex query variants after P2-1 normalize', () => {
  const pageMap: PageMap = {
    generatedAt: new Date().toISOString(),
    seedUrl: 'https://example.com/',
    scopeHost: 'example.com',
    truncated: false,
    pages: [
      pageEntry('https://example.com/work', 'Index of /work'),
      pageEntry('https://example.com/work?C=N;O=D', 'Index of /work'),
      pageEntry('https://example.com/work?C=M;O=A', 'Index of /work'),
      pageEntry('https://example.com/work?C=S;O=A', 'Index of /work'),
    ],
    routes: [
      { path: '/work', url: 'https://example.com/work', title: 'Index of /work', source: 'crawl' },
      { path: '/work?C=N;O=D', url: 'https://example.com/work?C=N;O=D', title: 'Index of /work', source: 'crawl' },
    ],
    navigation: [],
    skippedByScope: [],
    categoryStatus: [],
    pagesDiscoveredRaw: 4,
    pagesDiscoveredUnique: 1,
  };

  const config = {
    postman: { enabled: false, collectionName: 't', requests: [] },
    playwright: { enabled: true, baseURL: 'https://example.com', browsers: ['chromium'], headless: true },
    jmeter: { enabled: false },
  } as unknown as QaConfig;

  const items = buildInventory({ pageMap, ui: null, workflows: null, api: null }, config);
  const pages = items.filter((row) => row.kind === 'page');
  const routes = items.filter((row) => row.kind === 'route');
  assert.equal(pages.length, 1, 'Apache C/O variants must not inflate the page denominator');
  assert.equal(routes.length, 1);

  const formula = deriveCoverageFormula(items, items.map((row) => ({
    id: row.id,
    page: row.page ?? '',
    element: row.name,
    type: row.kind,
    kind: row.kind,
    status: 'UNCOVERED',
    reason: 'none',
    recommendedTest: 'n/a',
  })), {
    discoveredItems: items.filter((row) => row.source === 'discovery').length,
    testableItems: pages.length + routes.length,
    testedItems: 0,
    uncoveredItems: pages.length + routes.length,
    itemCoveragePercent: 0,
    executableScenarios: 0,
    testedScenarios: 0,
    scenarioCoveragePercent: 0,
    passedExecutions: 0,
    failedExecutions: 0,
    skippedExecutions: 0,
    passRatePercent: null,
    byStatus: {
      TESTED: 0,
      FAILED: 0,
      BLOCKED: 0,
      SKIPPED: 0,
      'NOT APPLICABLE': 0,
      UNTESTABLE: 0,
      UNCOVERED: pages.length + routes.length,
    },
  }, { pagesDiscoveredRaw: 4, pagesDiscoveredUnique: 1 });

  assert.equal(formula.contributions.pages.discoveredUnique, 1);
  assert.equal(formula.contributions.pages.discoveredRaw, 4);
  assert.equal(formula.denominatorAfterDedupe, true);
});

test('formula lists excluded items with a reason', () => {
  const skipped = item({
    id: 'API-CFG-0001',
    kind: 'api',
    name: 'GET /auth',
    source: 'config',
    coverageHint: 'skipped',
    applicableScenarios: [
      { id: 'api-smoke', disposition: 'requires-configuration', reason: 'Disabled in qa.config.json.', tested: false, evidenceIds: [] },
    ],
  });
  const rows = [evidence({ id: 'PW-1', title: 'unrelated' })];
  const report = calculateCoverage(applyEvidence([skipped], rows), rows, {
    seedUrl: null,
    playwrightBaseUrl: 'https://example.com',
    notes: [],
  });
  assert.ok(report.formula.excludedItems.some((row) => row.id === 'API-CFG-0001' && row.reason.includes('Disabled')));
});
