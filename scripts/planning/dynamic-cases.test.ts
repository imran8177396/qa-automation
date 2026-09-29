/**
 * Unit tests for discovery-driven dynamic plans.
 * Never writes file bytes. Never invents demo hosts or page counts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import {
  buildDynamicCasesForScreen,
  type DynamicElementInput,
  type DynamicSubcasePlan,
} from './dynamic-cases';
import { FIELD_FIXTURES } from './field-cases';
import { POSITIVE_FIXTURES } from './positive-cases';
import { buildScenarioInventory } from './scenario-inventory';

function byId(plans: DynamicSubcasePlan[]): Record<string, DynamicSubcasePlan> {
  const out: Record<string, DynamicSubcasePlan> = {};
  for (const p of plans) out[p.subcaseId] = p;
  return out;
}

function assertNoPass(plans: DynamicSubcasePlan[]): void {
  for (const p of plans) {
    assert.notEqual(p.status, 'PASS' as string, `${p.subcaseId} must not be PASS`);
  }
}

function assertNoDemoHosts(plans: DynamicSubcasePlan[]): void {
  const blob = JSON.stringify(plans);
  assert.ok(!/the-internet\.herokuapp|demo\.|localhost:3000|sauce.?demo/i.test(blob));
}

test('screen with no special controls returns []', () => {
  const plans = buildDynamicCasesForScreen({
    screenId: 'SCREEN-001',
    elements: [
      { elementId: 'UI-BTN', type: 'button', accessibleName: 'Save' },
      { elementId: 'UI-TXT', type: 'text-input', accessibleName: 'Name' },
    ],
  });
  assert.deepEqual(plans, []);
});

test('file input without field-file ids emits five file rows; large/corrupt NOT_TESTED; no file written', () => {
  const before = typeof (fs as { writeFileSync?: unknown }).writeFileSync;
  const plans = buildDynamicCasesForScreen({
    screenId: 'SCREEN-FILE',
    elements: [
      {
        elementId: 'UI-FILE',
        type: 'file-upload',
        category: 'file-upload',
        accessibleName: 'Upload',
        accept: '.txt,.pdf',
      },
    ],
  });
  assert.equal(typeof (fs as { writeFileSync?: unknown }).writeFileSync, before);

  const ids = plans.map((p) => p.subcaseId);
  assert.deepEqual(ids, [
    'dynamic-file-valid',
    'dynamic-file-invalid-extension',
    'dynamic-file-large',
    'dynamic-file-empty',
    'dynamic-file-corrupt',
  ]);
  const map = byId(plans);
  assert.equal(map['dynamic-file-valid']?.status, 'PLANNED');
  assert.equal(map['dynamic-file-valid']?.expect?.fillValue, FIELD_FIXTURES.fileValid);
  assert.match(map['dynamic-file-valid']?.expect?.note ?? '', /file bytes are not written/i);
  assert.equal(map['dynamic-file-invalid-extension']?.status, 'PLANNED');
  assert.equal(map['dynamic-file-invalid-extension']?.expect?.fillValue, FIELD_FIXTURES.fileUnsupported);
  assert.equal(map['dynamic-file-large']?.status, 'NOT_TESTED');
  assert.equal(map['dynamic-file-empty']?.status, 'NOT_TESTED');
  assert.equal(map['dynamic-file-corrupt']?.status, 'NOT_TESTED');
  assert.ok(!JSON.stringify(plans).includes('..'));
  assertNoPass(plans);
  assertNoDemoHosts(plans);
});

test('file input with existingSubcaseIds field-file-valid skips dynamic-file-valid', () => {
  const plans = buildDynamicCasesForScreen({
    screenId: 'SCREEN-FILE',
    elements: [
      {
        elementId: 'UI-FILE',
        type: 'file-upload',
        category: 'file-upload',
        accept: '.txt',
      },
    ],
    existingSubcaseIds: new Set(['field-file-valid']),
  });
  assert.equal(
    plans.some((p) => p.subcaseId === 'dynamic-file-valid'),
    false
  );
  assert.ok(plans.some((p) => p.subcaseId === 'dynamic-file-large'));
  assertNoPass(plans);
});

test('file without accept list → invalid-extension NOT_TESTED', () => {
  const plans = buildDynamicCasesForScreen({
    screenId: 'SCREEN-FILE',
    elements: [{ elementId: 'UI-FILE', type: 'file-upload', category: 'file-upload' }],
  });
  const inv = plans.find((p) => p.subcaseId === 'dynamic-file-invalid-extension');
  assert.equal(inv?.status, 'NOT_TESTED');
  assert.match(inv?.reason ?? '', /no accept list discovered/i);
});

test('pagination element without pageCount → seven NOT_TESTED rows; no invented 100', () => {
  const plans = buildDynamicCasesForScreen({
    screenId: 'SCREEN-PAGE',
    elements: [
      {
        elementId: 'UI-PAGER',
        type: 'pagination',
        accessibleName: 'Pagination',
      },
    ],
  });
  assert.equal(plans.length, 7);
  for (const p of plans) {
    assert.equal(p.status, 'NOT_TESTED', p.subcaseId);
    assert.match(p.reason ?? '', /page behavior was not executed/i);
  }
  const blob = JSON.stringify(plans);
  assert.ok(!/\b100\b/.test(blob), 'must not invent page count 100');
  assertNoPass(plans);
  assertNoDemoHosts(plans);
});

test('pageCount 1 → single PLANNED; next/previous NOT_APPLICABLE', () => {
  const plans = buildDynamicCasesForScreen({
    screenId: 'SCREEN-PAGE',
    elements: [{ elementId: 'UI-PAGER', type: 'pagination', accessibleName: 'Pager' }],
    evidence: { pageCount: 1 },
  });
  const map = byId(plans);
  assert.equal(map['dynamic-page-single']?.status, 'PLANNED');
  assert.equal(map['dynamic-page-single']?.action, 'observe');
  assert.match(map['dynamic-page-single']?.reason ?? '', /page count 1 was recorded/i);
  assert.equal(map['dynamic-page-next']?.status, 'NOT_APPLICABLE');
  assert.equal(map['dynamic-page-previous']?.status, 'NOT_APPLICABLE');
  assert.equal(map['dynamic-page-first']?.status, 'NOT_TESTED');
  assert.equal(map['dynamic-page-large-dataset']?.status, 'NOT_TESTED');
  assertNoPass(plans);
});

test('search and filter elements → six rows; no-results NOT_TESTED; action is not submit', () => {
  const plans = buildDynamicCasesForScreen({
    screenId: 'SCREEN-SF',
    elements: [
      { elementId: 'UI-SEARCH', type: 'search-field', category: 'search', accessibleName: 'Search' },
      { elementId: 'UI-FILTER', type: 'select', accessibleName: 'Filter by status' },
    ],
  });
  assert.equal(plans.length, 6);
  const map = byId(plans);
  assert.ok(map['dynamic-search-only']);
  assert.ok(map['dynamic-filter-only']);
  assert.ok(map['dynamic-search-and-filter']);
  assert.ok(map['dynamic-clear-search']);
  assert.ok(map['dynamic-clear-filter']);
  assert.equal(map['dynamic-no-results']?.status, 'NOT_TESTED');
  for (const id of [
    'dynamic-search-only',
    'dynamic-filter-only',
    'dynamic-search-and-filter',
    'dynamic-clear-search',
    'dynamic-clear-filter',
  ] as const) {
    const row = map[id]!;
    assert.equal(row.status, 'PLANNED');
    assert.ok(row.action === 'fill-no-submit' || row.action === 'observe');
    assert.notEqual(row.action, 'submit' as string);
    assert.match(row.expect?.note ?? '', /UI-SEARCH/);
    assert.match(row.expect?.note ?? '', /UI-FILTER/);
  }
  assert.equal(map['dynamic-search-only']?.expect?.fillValue, POSITIVE_FIXTURES.textValid);
  assertNoPass(plans);
  assertNoDemoHosts(plans);
});

test('search only → no dynamic-filter-only', () => {
  const plans = buildDynamicCasesForScreen({
    screenId: 'SCREEN-S',
    elements: [
      { elementId: 'UI-SEARCH', type: 'search-field', category: 'search', accessibleName: 'Search' },
    ],
  });
  assert.equal(
    plans.some((p) => p.subcaseId === 'dynamic-filter-only'),
    false
  );
  assert.equal(
    plans.some((p) => p.subcaseId === 'dynamic-search-and-filter'),
    false
  );
  assert.ok(plans.some((p) => p.subcaseId === 'dynamic-search-only'));
  assertNoPass(plans);
});

test('filter only → filter-only and clear-filter; no search rows', () => {
  const plans = buildDynamicCasesForScreen({
    screenId: 'SCREEN-F',
    elements: [{ elementId: 'UI-FILTER', accessibleName: 'Filter' }],
  });
  const ids = plans.map((p) => p.subcaseId);
  assert.deepEqual(ids, ['dynamic-filter-only', 'dynamic-clear-filter']);
  assert.equal(
    plans.some((p) => p.subcaseId.startsWith('dynamic-search')),
    false
  );
  assertNoPass(plans);
});

test('pagination detected by accessible name pager', () => {
  const plans = buildDynamicCasesForScreen({
    screenId: 'SCREEN-P',
    elements: [{ elementId: 'UI-NAV', type: 'nav', accessibleName: 'Results pager' }],
  });
  assert.equal(plans.length, 7);
  assert.ok(plans.every((p) => p.subcaseId.startsWith('dynamic-page-')));
});

test('search element named Filter is not double-counted as filter', () => {
  const elements: DynamicElementInput[] = [
    { elementId: 'UI-SF', type: 'search-field', category: 'search', accessibleName: 'Filter search' },
  ];
  const plans = buildDynamicCasesForScreen({ screenId: 'SCREEN-X', elements });
  assert.equal(
    plans.some((p) => p.subcaseId === 'dynamic-filter-only'),
    false
  );
  assert.ok(plans.some((p) => p.subcaseId === 'dynamic-search-only'));
});

test('inventory wiring: file upload defers to field-file rows; plain button adds no dynamic', () => {
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
  function page(route: string): PageMap['pages'][number] {
    return {
      url: `http://app.test${route}`,
      route,
      title: route,
      status: 200,
      ok: true,
      depth: 0,
      h1s: ['Heading'],
      applicableTestTypes: applicableTestTypes('pages'),
    };
  }
  function element(overrides: Partial<UiElementRecord>): UiElementRecord {
    return {
      page: 'http://app.test/form.html',
      elementId: 'UI-0001',
      elementType: 'input',
      locator: '#field',
      locatorCandidates: ['#field'],
      accessibleName: 'field',
      visible: true,
      enabled: true,
      required: false,
      interactive: true,
      potentialAction: 'fill',
      applicableTestTypes: ['form-presence'],
      discoveryStatus: 'DISCOVERED',
      evidence: 'text-like input',
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

  const withFile = buildScenarioInventory(
    pageMap([page('/form.html')]),
    ui([
      element({
        elementId: 'UI-FILE',
        elementType: 'file-upload',
        elementKind: 'file-upload',
        inputType: 'file',
        locator: '#file',
        accessibleName: 'Upload',
        attributes: { type: 'file', accept: '.txt' },
      }),
    ]),
    resolveSafetyConfig()
  );
  const dynamicFile = withFile.filter(
    (c) => c.scenarioKind === 'dynamic' && typeof c.id === 'string' && c.id.includes('dynamic-file-')
  );
  assert.equal(
    dynamicFile.length,
    0,
    'field-cases already planned field-file-*; dynamic must not duplicate'
  );
  assert.ok(withFile.some((c) => c.scenarioKind === 'field' && c.id.endsWith('field-file-valid')));

  const buttonOnly = buildScenarioInventory(
    pageMap([page('/form.html')]),
    ui([
      element({
        elementId: 'UI-BTN',
        elementType: 'button',
        elementKind: 'button',
        locator: 'button',
        accessibleName: 'Save',
        potentialAction: 'click',
      }),
    ]),
    resolveSafetyConfig()
  );
  assert.equal(
    buttonOnly.filter((c) => c.scenarioKind === 'dynamic').length,
    0
  );
});
