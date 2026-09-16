import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicableScenarios } from './scenarios';
import { applyEvidence, evidenceMatchesItem } from './match';
import { calculateCoverage, isTested } from './calculate';
import type { ExecutionEvidence, InventoryItem } from './types';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'kind' | 'name'>): InventoryItem {
  return {
    source: 'discovery',
    applicableScenarios: applicableScenarios({
      kind: partial.kind,
      pageStatus: 200,
      elementType: partial.elementType,
      required: true,
      inputHint: 'email',
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

test('coverage is tested/testable, not pass rate', () => {
  const items = [
    item({ id: 'PAGE-0001', kind: 'page', name: 'Home', page: 'http://app.test/', route: '/' }),
    item({ id: 'PAGE-0002', kind: 'page', name: 'Contact', page: 'http://app.test/contact.html', route: '/contact.html' }),
    item({
      id: 'UI-0001',
      kind: 'field',
      name: 'email',
      page: 'http://app.test/contact.html',
      locator: '#email',
      elementType: 'input',
    }),
  ];

  const passingUnrelated = [
    evidence({
      id: 'PW-0001',
      title: 'homepage loads through the HomePage object',
      urlHints: ['https://example.com/'],
      status: 'PASS',
    }),
    evidence({
      id: 'PW-0002',
      title: 'Homepage should load with a heading',
      urlHints: ['https://example.com/'],
      status: 'PASS',
    }),
    evidence({
      id: 'PW-0003',
      title: 'Homepage should expose at least one navigable link',
      urlHints: ['https://example.com/'],
      status: 'PASS',
    }),
  ];

  const uncovered = calculateCoverage(applyEvidence(items, passingUnrelated), passingUnrelated, {
    seedUrl: 'http://app.test/',
    playwrightBaseUrl: 'https://example.com',
    notes: [],
  });

  assert.equal(uncovered.totals.passRatePercent, 100);
  assert.equal(uncovered.totals.testedItems, 0);
  assert.equal(uncovered.totals.itemCoveragePercent, 0);
  assert.notEqual(uncovered.totals.passRatePercent, uncovered.totals.itemCoveragePercent);
});

test('matching execution against the discovered host counts only that item', () => {
  const items = [
    item({ id: 'PAGE-0001', kind: 'page', name: 'Contact', page: 'http://app.test/contact.html', route: '/contact.html' }),
    item({ id: 'PAGE-0002', kind: 'page', name: 'Home', page: 'http://app.test/', route: '/' }),
  ];
  const rows = [
    evidence({
      id: 'PW-0001',
      title: 'http://app.test/contact.html should return a successful status',
      urlHints: ['http://app.test/contact.html'],
    }),
  ];

  const report = calculateCoverage(applyEvidence(items, rows), rows, {
    seedUrl: 'http://app.test/',
    playwrightBaseUrl: 'http://app.test/',
    notes: [],
  });

  assert.equal(report.totals.testableItems, 2);
  assert.equal(report.totals.testedItems, 1);
  assert.equal(report.totals.itemCoveragePercent, 50);
  assert.equal(isTested(report.items[0]), true);
  assert.equal(isTested(report.items[1]), false);
});

test('evidenceMatchesItem() rejects a different host even when the path matches', () => {
  const page = item({
    id: 'PAGE-0001',
    kind: 'page',
    name: 'Home',
    page: 'http://127.0.0.1:4173/',
    route: '/',
  });
  assert.equal(
    evidenceMatchesItem(
      page,
      evidence({ id: 'PW-1', title: 'Homepage should load', urlHints: ['https://example.com/'] })
    ),
    false
  );
});

test('a locator match does not mark invalid-input tested unless the title says so', () => {
  const field = item({
    id: 'UI-0001',
    kind: 'field',
    name: 'email',
    page: 'http://app.test/contact.html',
    locator: '#email',
    elementType: 'input',
  });
  const rows = [
    evidence({
      id: 'PW-0001',
      title: 'field #email is visible',
      urlHints: ['http://app.test/contact.html'],
      locatorHints: ['#email'],
    }),
  ];
  const [updated] = applyEvidence([field], rows);
  const byId = Object.fromEntries(updated.applicableScenarios.map((s) => [s.id, s.tested]));
  assert.equal(byId.visibility, true);
  assert.equal(byId['invalid-input'], false);
  assert.equal(byId['required-validation'], false);
});

test('visual evidence covers only the visual capability item', () => {
  const visual = item({
    id: 'VISUAL-regression',
    kind: 'visual',
    name: 'Visual regression',
    source: 'capability',
  });
  const page = item({
    id: 'PAGE-0001',
    kind: 'page',
    name: 'Home',
    page: 'http://127.0.0.1:4173/',
    route: '/',
  });
  const row = evidence({
    id: 'VIS-0001',
    source: 'visual',
    title: 'home layout is consistent http://127.0.0.1:4173/',
    urlHints: ['http://127.0.0.1:4173/'],
  });

  assert.equal(evidenceMatchesItem(visual, row), true);
  assert.equal(evidenceMatchesItem(page, row), false);
});

test('cross-browser evidence covers the matching engine, not a device name', () => {
  const chromium = item({
    id: 'BROWSER-chromium',
    kind: 'browser',
    name: 'chromium',
    source: 'config',
  });
  const firefox = item({
    id: 'BROWSER-firefox',
    kind: 'browser',
    name: 'firefox',
    source: 'config',
  });
  const row = evidence({
    id: 'XB-0001',
    source: 'cross-browser',
    title: 'Homepage should load with a heading @cross-browser',
    browser: 'chromium',
  });
  assert.equal(evidenceMatchesItem(chromium, row), true);
  assert.equal(evidenceMatchesItem(firefox, row), false);
});

test('responsive evidence covers only the viewport capability item', () => {
  const viewport = item({
    id: 'VIEWPORT-matrix',
    kind: 'viewport',
    name: 'Responsive viewport matrix',
    source: 'capability',
  });
  const page = item({
    id: 'PAGE-0001',
    kind: 'page',
    name: 'Home',
    page: 'http://127.0.0.1:4173/',
    route: '/',
  });
  const row = evidence({
    id: 'VP-0001',
    source: 'responsive',
    title: 'home has no horizontal overflow',
    urlHints: ['http://127.0.0.1:4173/'],
  });

  assert.equal(evidenceMatchesItem(viewport, row), true);
  assert.equal(evidenceMatchesItem(page, row), false);
});

test('accessibility evidence covers only the accessibility capability item', () => {
  const a11y = item({
    id: 'A11Y-scan',
    kind: 'accessibility',
    name: 'Accessibility scan',
    source: 'capability',
  });
  const page = item({
    id: 'PAGE-0001',
    kind: 'page',
    name: 'Home',
    page: 'http://127.0.0.1:4173/',
    route: '/',
  });
  const row = evidence({
    id: 'A11Y-0001',
    source: 'accessibility',
    title: 'home has no axe WCAG A/AA violations',
    urlHints: ['http://127.0.0.1:4173/'],
  });

  assert.equal(evidenceMatchesItem(a11y, row), true);
  assert.equal(evidenceMatchesItem(page, row), false);
});

test('workflow evidence covers only the configured correlation item', () => {
  const correlated = item({
    id: 'WF-CORR-create-user',
    kind: 'workflow',
    name: 'Create user',
    source: 'config',
  });
  const page = item({
    id: 'PAGE-0001',
    kind: 'page',
    name: 'Home',
    page: 'http://127.0.0.1:4173/',
    route: '/',
  });
  const row = evidence({
    id: 'WF-0001',
    source: 'workflow',
    title: 'submitting the create-user form issues POST /users',
    urlHints: ['http://127.0.0.1:4173/create-user.html'],
  });
  assert.equal(evidenceMatchesItem(correlated, row), true);
  assert.equal(evidenceMatchesItem(page, row), false);
});

test('security evidence covers only the security capability item', () => {
  const security = item({
    id: 'SEC-baseline',
    kind: 'security',
    name: 'QA-level security baseline',
    source: 'capability',
  });
  const page = item({
    id: 'PAGE-0001',
    kind: 'page',
    name: 'Home',
    page: 'http://127.0.0.1:4173/',
    route: '/',
  });
  const row = evidence({
    id: 'SEC-0001',
    source: 'security',
    title: 'QA-level security baseline',
    urlHints: ['http://127.0.0.1:4173/'],
  });
  assert.equal(evidenceMatchesItem(security, row), true);
  assert.equal(evidenceMatchesItem(page, row), false);
});

test('seo evidence covers only the seo capability item', () => {
  const seo = item({
    id: 'SEO-baseline',
    kind: 'seo',
    name: 'Technical SEO baseline',
    source: 'capability',
  });
  const page = item({
    id: 'PAGE-0001',
    kind: 'page',
    name: 'Home',
    page: 'http://127.0.0.1:4173/',
    route: '/',
  });
  const row = evidence({
    id: 'SEO-0001',
    source: 'seo',
    title: 'Technical SEO baseline',
    urlHints: ['http://127.0.0.1:4173/'],
  });
  assert.equal(evidenceMatchesItem(seo, row), true);
  assert.equal(evidenceMatchesItem(page, row), false);
});

test('content evidence covers only the content capability item', () => {
  const content = item({
    id: 'CONTENT-baseline',
    kind: 'content',
    name: 'Content QA baseline',
    source: 'capability',
  });
  const page = item({
    id: 'PAGE-0001',
    kind: 'page',
    name: 'Home',
    page: 'http://127.0.0.1:4173/',
    route: '/',
  });
  const row = evidence({
    id: 'CONTENT-0001',
    source: 'content',
    title: 'Content QA baseline',
    urlHints: ['http://127.0.0.1:4173/'],
  });
  assert.equal(evidenceMatchesItem(content, row), true);
  assert.equal(evidenceMatchesItem(page, row), false);
});

test('jmeter smoke evidence covers only the smoke performance item', () => {
  const smoke = item({
    id: 'PERF-smoke',
    kind: 'performance',
    name: 'smoke performance profile',
    source: 'capability',
  });
  const load = item({
    id: 'PERF-load',
    kind: 'performance',
    name: 'load performance profile',
    source: 'capability',
  });
  const row = evidence({
    id: 'JMETER-smoke',
    source: 'jmeter',
    title: 'smoke performance profile against https://jsonplaceholder.typicode.com/users',
    file: 'smoke-test.jmx',
    urlHints: ['https://jsonplaceholder.typicode.com/users'],
  });
  assert.equal(evidenceMatchesItem(smoke, row), true);
  assert.equal(evidenceMatchesItem(load, row), false);
});

test('API-AUTH capability is not marked tested by an ordinary GET /users execution', () => {
  const auth = item({
    id: 'API-AUTH',
    kind: 'api',
    name: 'API authentication / authorization',
    source: 'capability',
  });
  const row = evidence({
    id: 'PM-0001',
    source: 'postman',
    title: 'GET /users — valid list',
    urlHints: ['https://jsonplaceholder.typicode.com/users'],
  });
  assert.equal(evidenceMatchesItem(auth, row), false);
});

test('zero testable items is 0% coverage, not 100%', () => {
  const report = calculateCoverage([], [], {
    seedUrl: null,
    playwrightBaseUrl: 'https://example.com',
    notes: [],
  });
  assert.equal(report.totals.itemCoveragePercent, 0);
  assert.equal(report.totals.scopeCoveragePercent, 0);
  assert.equal(report.totals.complete, false);
  assert.equal(report.totals.passRatePercent, null);
});
