import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { buildEdgeSubcases, EDGE_FIXTURES } from './edge-cases';
import { buildScenarioInventory } from './scenario-inventory';
import { applicableCategories } from './applicability';

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

const safety = resolveSafetyConfig();

function edgeRows(checks: ReturnType<typeof buildScenarioInventory>, elementId: string) {
  return checks.filter(
    (c) =>
      c.targetElementId === elementId &&
      c.scenarioKind === 'edge' &&
      typeof c.id === 'string' &&
      /edge-/.test(c.id)
  );
}

function exclusionReason(checks: ReturnType<typeof buildScenarioInventory>, elementId: string): string {
  return (
    checks.find(
      (c) =>
        c.targetElementId === elementId &&
        c.status === 'NOT_APPLICABLE' &&
        /excluded:/.test(c.reason ?? '')
    )?.reason ?? ''
  );
}

function plannedValues(result: ReturnType<typeof buildEdgeSubcases>): string[] {
  return result.plans
    .filter((p) => p.status === 'PLANNED' && p.expect?.fillValue != null)
    .map((p) => String(p.expect!.fillValue));
}

function plannedIds(result: ReturnType<typeof buildEdgeSubcases>): string[] {
  return result.plans.filter((p) => p.status === 'PLANNED').map((p) => p.subcaseId);
}

test('number min 10 max 20 → planned values include 10, 5, 15, 20, 15 (max-5), 25', () => {
  const num = element({
    elementId: 'UI-NUM',
    inputType: 'number',
    elementKind: 'number-input',
    min: '10',
    max: '20',
    attributes: { type: 'number', min: '10', max: '20' },
  });
  const result = buildEdgeSubcases({
    element: num,
    purpose: 'text-input',
    control: 'text',
    label: 'qty',
    locator: '#qty',
  });
  const values = plannedValues(result);
  assert.ok(values.includes('10'), 'edge-min');
  assert.ok(values.includes('5'), 'edge-min-minus-5');
  assert.ok(values.includes('15'), 'min+5 and/or max-5');
  assert.ok(values.includes('20'), 'edge-max');
  assert.ok(values.includes('25'), 'edge-max-plus-5');
  const ids = plannedIds(result);
  assert.ok(ids.includes('edge-min-plus-5'));
  assert.ok(ids.includes('edge-max-minus-5'));
  // min+5 and max-5 are both 15 with different assertions — both rows allowed
  const fifteenRows = result.plans.filter(
    (p) => p.status === 'PLANNED' && p.expect?.fillValue === '15'
  );
  assert.ok(fifteenRows.length >= 1);
  assert.ok(!result.plans.some((p) => p.status === 'PASS' as never));
  assert.ok(!result.plans.some((p) => p.action === ('submit' as never)));
});

test('number with no min/max → those six excluded, no fake 0 min', () => {
  const num = element({
    elementId: 'UI-OPEN-NUM',
    inputType: 'number',
    elementKind: 'number-input',
    attributes: { type: 'number' },
  });
  const result = buildEdgeSubcases({
    element: num,
    purpose: 'text-input',
    control: 'text',
    label: 'n',
    locator: '#n',
  });
  const reason = result.exclusions.join('; ');
  assert.match(reason, /edge-min \(no minimum constraint discovered\)/);
  assert.match(reason, /edge-max \(no maximum constraint discovered\)/);
  assert.ok(!plannedIds(result).includes('edge-min'));
  assert.ok(!plannedIds(result).includes('edge-max'));
  assert.ok(!plannedIds(result).includes('edge-min-minus-5'));
  assert.ok(!plannedValues(result).includes('0') || !plannedIds(result).includes('edge-min'));
  assert.ok(!result.exclusions.some((e) => /fake|invented/i.test(e)));
});

test('required text maxlength 4 → edge-max length 4, edge-max-plus-5 length 9, edge-empty ""', () => {
  const text = element({
    elementId: 'UI-REQ',
    required: true,
    maxLength: '4',
    attributes: { maxlength: '4' },
  });
  const result = buildEdgeSubcases({
    element: text,
    purpose: 'text-input',
    control: 'text',
    label: 'name',
    locator: '#name',
  });
  const max = result.plans.find((p) => p.subcaseId === 'edge-max' && p.status === 'PLANNED');
  const over = result.plans.find((p) => p.subcaseId === 'edge-max-plus-5' && p.status === 'PLANNED');
  const empty = result.plans.find((p) => p.subcaseId === 'edge-empty' && p.status === 'PLANNED');
  assert.equal(max?.expect?.fillValue, 'aaaa');
  assert.equal(String(over?.expect?.fillValue).length, 9);
  assert.equal(empty?.expect?.fillValue, '');
});

test('optional text → edge-empty excluded', () => {
  const text = element({
    elementId: 'UI-OPT',
    required: false,
    maxLength: '8',
    attributes: { maxlength: '8' },
  });
  const result = buildEdgeSubcases({
    element: text,
    purpose: 'text-input',
    control: 'text',
    label: 'note',
    locator: '#note',
  });
  assert.ok(!plannedIds(result).includes('edge-empty'));
  assert.match(result.exclusions.join('; '), /edge-empty \(empty is valid when not required\)/);
});

test('textarea → newline planned; email → newline excluded', () => {
  const area = element({
    elementId: 'UI-TA',
    elementType: 'textarea',
    tag: 'textarea',
    elementKind: 'textarea',
    required: false,
  });
  const areaResult = buildEdgeSubcases({
    element: area,
    purpose: 'text-input',
    control: 'text',
    label: 'bio',
    locator: '#bio',
  });
  assert.ok(plannedIds(areaResult).includes('edge-newline'));
  assert.equal(
    areaResult.plans.find((p) => p.subcaseId === 'edge-newline')?.expect?.fillValue,
    EDGE_FIXTURES.newline
  );

  const email = element({
    elementId: 'UI-EM',
    inputType: 'email',
    elementKind: 'email-input',
    required: true,
    attributes: { type: 'email' },
  });
  const emailResult = buildEdgeSubcases({
    element: email,
    purpose: 'text-input',
    control: 'text',
    label: 'email',
    locator: '#email',
  });
  assert.ok(!plannedIds(emailResult).includes('edge-newline'));
  assert.match(
    emailResult.exclusions.join('; '),
    /edge-newline \(newline not applicable to single-line input\)/
  );
});

test('rapid and paste are not PLANNED', () => {
  const text = element({
    elementId: 'UI-T',
    required: true,
    maxLength: '10',
    attributes: { maxlength: '10' },
  });
  const result = buildEdgeSubcases({
    element: text,
    purpose: 'text-input',
    control: 'text',
    label: 't',
    locator: '#t',
  });
  assert.ok(!plannedIds(result).includes('edge-rapid'));
  assert.ok(!plannedIds(result).includes('edge-paste'));
  assert.match(result.exclusions.join('; '), /edge-rapid \(input timing was not observed/);
  assert.match(result.exclusions.join('; '), /edge-paste \(paste was not observed/);
  assert.ok(!result.plans.some((p) => p.subcaseId === 'edge-rapid' && p.status === 'PASS' as never));
});

test('decorative has no edge PLANNED row', () => {
  const icon = element({
    elementId: 'UI-DECO',
    elementType: 'image',
    tag: 'span',
    elementKind: 'decorative',
    locator: null,
    accessibleName: null,
    evidence: 'decorative',
    attributes: { 'aria-hidden': 'true' },
    interactive: false,
  });
  const boundary = applicableCategories(icon).find((d) => d.category === 'boundary');
  assert.equal(boundary?.decision, 'exclude');

  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([icon]), safety);
  assert.ok(!edgeRows(checks, 'UI-DECO').some((c) => c.status === 'PLANNED'));
  assert.ok(!checks.some((c) => c.targetElementId === 'UI-DECO' && c.scenarioKind === 'edge' && c.status === 'PLANNED'));
});

test('no "<script>" in fixtures and no demo hosts', () => {
  const text = element({
    elementId: 'UI-SAFE',
    required: true,
    maxLength: '12',
    minLength: '2',
    attributes: { maxlength: '12', minlength: '2' },
  });
  const result = buildEdgeSubcases({
    element: text,
    purpose: 'text-input',
    control: 'text',
    label: 'safe',
    locator: '#safe',
  });
  const blob = JSON.stringify(result);
  assert.ok(!/<script>/i.test(blob));
  assert.ok(!/onerror\s*=|javascript:/i.test(blob));
  assert.ok(!/' OR |UNION SELECT|DROP TABLE/i.test(blob));
  assert.ok(!/demo\.|example\.com\/login|the-internet/i.test(blob));
});

test('open text without min/max still gets edge analysis; six numeric/length cases excluded', () => {
  const text = element({
    elementId: 'UI-OPEN',
    required: false,
    evidence: 'text-like input',
  });
  const boundary = applicableCategories(text).find((d) => d.category === 'boundary');
  assert.equal(boundary?.decision, 'apply');

  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([text]), safety);
  const edges = edgeRows(checks, 'UI-OPEN');
  assert.ok(edges.some((c) => c.status === 'PLANNED'), 'format-sensitive edges may still plan');
  const reason = exclusionReason(checks, 'UI-OPEN');
  assert.match(reason, /edge-min \(no minimum constraint discovered\)/);
  assert.match(reason, /edge-max \(no maximum constraint discovered\)/);
  assert.ok(!edges.some((c) => /edge-min$/.test(c.id) && c.expect?.fillValue === '0'));
  assert.ok(!edges.some((c) => c.status === 'PASS' as never));
});

test('select excludes edge analysis; no edge PLANNED fill', () => {
  const sel = element({
    elementId: 'UI-SEL',
    elementType: 'select',
    elementKind: 'select',
    locator: '#sel',
    optionValues: ['a', 'b'],
    evidence: 'select',
  });
  const boundary = applicableCategories(sel).find((d) => d.category === 'boundary');
  assert.equal(boundary?.decision, 'exclude');
  assert.match(boundary?.reason ?? '', /edge analysis not applicable/);

  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([sel]), safety);
  assert.equal(edgeRows(checks, 'UI-SEL').length, 0);
});

test('edge-min skipped when positiveCovered has the identical value', () => {
  const num = element({
    inputType: 'number',
    elementKind: 'number-input',
    min: '10',
    max: '20',
    attributes: { type: 'number', min: '10', max: '20' },
  });
  const result = buildEdgeSubcases({
    element: num,
    purpose: 'text-input',
    control: 'text',
    label: 'qty',
    locator: '#qty',
    positiveCovered: { min: '10', max: '20' },
  });
  assert.ok(!plannedIds(result).includes('edge-min'));
  assert.ok(!plannedIds(result).includes('edge-max'));
  assert.match(result.exclusions.join('; '), /edge-min \(already covered by positive-min\)/);
  assert.match(result.exclusions.join('; '), /edge-max \(already covered by positive-max\)/);
  assert.ok(plannedValues(result).includes('5'));
  assert.ok(plannedValues(result).includes('25'));
});
