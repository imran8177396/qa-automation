import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { buildScenarioInventory } from './scenario-inventory';
import { NEGATIVE_FIXTURES } from './negative-cases';

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

function negativeRows(checks: ReturnType<typeof buildScenarioInventory>, elementId: string) {
  return checks.filter(
    (c) =>
      c.targetElementId === elementId &&
      c.scenarioKind === 'negative' &&
      typeof c.id === 'string' &&
      /negative-/.test(c.id)
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

const EMAIL_FORMAT_IDS = [
  'negative-missing-at',
  'negative-missing-domain',
  'negative-invalid-domain',
  'negative-double-at',
  'negative-spaces',
  'negative-malformed',
] as const;

test('required email → empty planned AND the six format negatives; values contain no < >', () => {
  const email = element({
    elementId: 'UI-EMAIL-REQ',
    inputType: 'email',
    elementKind: 'email-input',
    locator: '#email',
    accessibleName: 'Email',
    required: true,
    attributes: { type: 'email' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([email]), safety);
  const rows = negativeRows(checks, 'UI-EMAIL-REQ');
  const bySuffix = Object.fromEntries(rows.map((r) => [r.id.replace(/^INV-\d+-/, ''), r]));

  assert.ok(bySuffix['negative-empty']);
  assert.equal(bySuffix['negative-empty']?.status, 'PLANNED');
  assert.equal(bySuffix['negative-empty']?.action, 'fill-no-submit');
  assert.equal(bySuffix['negative-empty']?.expect?.fillValue, '');
  assert.equal(bySuffix['negative-empty']?.kind, 'empty-input');

  for (const id of EMAIL_FORMAT_IDS) {
    assert.ok(bySuffix[id], `expected ${id}`);
    assert.equal(bySuffix[id]?.status, 'PLANNED');
    assert.equal(bySuffix[id]?.action, 'fill-no-submit');
    assert.equal(bySuffix[id]?.category, 'negative');
  }
  assert.equal(bySuffix['negative-missing-at']?.expect?.fillValue, NEGATIVE_FIXTURES.emailMissingAt);
  assert.equal(bySuffix['negative-missing-domain']?.expect?.fillValue, NEGATIVE_FIXTURES.emailMissingDomain);
  assert.equal(bySuffix['negative-invalid-domain']?.expect?.fillValue, NEGATIVE_FIXTURES.emailInvalidDomain);
  assert.equal(bySuffix['negative-double-at']?.expect?.fillValue, NEGATIVE_FIXTURES.emailDoubleAt);
  assert.equal(bySuffix['negative-spaces']?.expect?.fillValue, NEGATIVE_FIXTURES.emailSpaces);
  assert.equal(bySuffix['negative-malformed']?.expect?.fillValue, NEGATIVE_FIXTURES.emailMalformed);

  const blob = JSON.stringify(rows.map((r) => r.expect?.fillValue));
  assert.ok(!/[<>]/.test(blob));
  assert.ok(!rows.some((c) => c.status === ('PASS' as never)));
});

test('optional email → empty excluded; format negatives still planned', () => {
  const email = element({
    elementId: 'UI-EMAIL-OPT',
    inputType: 'email',
    elementKind: 'email-input',
    locator: '#email',
    accessibleName: 'Email',
    required: false,
    attributes: { type: 'email' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([email]), safety);
  const rows = negativeRows(checks, 'UI-EMAIL-OPT');
  assert.equal(rows.filter((c) => c.id.endsWith('negative-empty')).length, 0);
  assert.match(exclusionReason(checks, 'UI-EMAIL-OPT'), /negative-empty \(empty is valid when not required\)/);
  for (const id of EMAIL_FORMAT_IDS) {
    assert.ok(rows.some((c) => c.id.endsWith(id) && c.status === 'PLANNED'), `expected ${id}`);
  }
});

test('email cases do not include a script payload', () => {
  const email = element({
    elementId: 'UI-EMAIL-XSS',
    inputType: 'email',
    elementKind: 'email-input',
    locator: '#email',
    accessibleName: 'Email',
    attributes: { type: 'email' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([email]), safety);
  const rows = negativeRows(checks, 'UI-EMAIL-XSS');
  const blob = JSON.stringify(rows);
  assert.ok(!/<script/i.test(blob));
  assert.ok(!/javascript:/i.test(blob));
  assert.ok(!/onerror=/i.test(blob));
});

test('number with no min/max → string planned; zero, very-large, scientific excluded', () => {
  const num = element({
    elementId: 'UI-NUM-OPEN',
    inputType: 'number',
    elementKind: 'number-input',
    locator: '#qty',
    accessibleName: 'Qty',
    attributes: { type: 'number' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([num]), safety);
  const rows = negativeRows(checks, 'UI-NUM-OPEN');
  const bySuffix = Object.fromEntries(rows.map((r) => [r.id.replace(/^INV-\d+-/, ''), r]));

  assert.ok(bySuffix['negative-string']);
  assert.equal(bySuffix['negative-string']?.expect?.fillValue, 'not-a-number');
  assert.equal(bySuffix['negative-string']?.status, 'PLANNED');

  assert.equal(rows.filter((c) => c.id.endsWith('negative-zero')).length, 0);
  assert.equal(rows.filter((c) => c.id.endsWith('negative-very-large')).length, 0);
  assert.equal(rows.filter((c) => c.id.endsWith('negative-scientific')).length, 0);
  const reason = exclusionReason(checks, 'UI-NUM-OPEN');
  assert.match(reason, /negative-zero \(zero is not documented as invalid\)/);
  assert.match(reason, /negative-very-large \(no maximum documented\)/);
  assert.match(reason, /negative-scientific \(no maximum documented\)/);
});

test('number with min 0 → "-1" planned; zero excluded', () => {
  const num = element({
    elementId: 'UI-NUM-MIN0',
    inputType: 'number',
    elementKind: 'number-input',
    locator: '#qty',
    accessibleName: 'Qty',
    min: '0',
    attributes: { type: 'number', min: '0' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([num]), safety);
  const rows = negativeRows(checks, 'UI-NUM-MIN0');
  const neg = rows.find((c) => c.id.endsWith('negative-negative'));
  assert.ok(neg);
  assert.equal(neg?.expect?.fillValue, '-1');
  assert.equal(neg?.status, 'PLANNED');
  assert.equal(rows.filter((c) => c.id.endsWith('negative-zero')).length, 0);
  assert.match(exclusionReason(checks, 'UI-NUM-MIN0'), /negative-zero \(zero is not documented as invalid\)/);
});

test('date with no min/max → invalid and wrong-format planned; past, future, timezone excluded', () => {
  const date = element({
    elementId: 'UI-DATE-OPEN',
    inputType: 'date',
    elementKind: 'date-input',
    locator: '#when',
    accessibleName: 'When',
    attributes: { type: 'date' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([date]), safety);
  const rows = negativeRows(checks, 'UI-DATE-OPEN');
  const bySuffix = Object.fromEntries(rows.map((r) => [r.id.replace(/^INV-\d+-/, ''), r]));

  assert.equal(bySuffix['negative-invalid-date']?.expect?.fillValue, NEGATIVE_FIXTURES.dateInvalid);
  assert.equal(bySuffix['negative-wrong-format']?.expect?.fillValue, NEGATIVE_FIXTURES.dateWrongFormat);
  assert.equal(bySuffix['negative-invalid-date']?.status, 'PLANNED');
  assert.equal(bySuffix['negative-wrong-format']?.status, 'PLANNED');

  assert.equal(rows.filter((c) => c.id.endsWith('negative-past')).length, 0);
  assert.equal(rows.filter((c) => c.id.endsWith('negative-future')).length, 0);
  assert.equal(rows.filter((c) => c.id.endsWith('negative-timezone')).length, 0);
  const reason = exclusionReason(checks, 'UI-DATE-OPEN');
  assert.match(reason, /negative-past \(no minimum date documented\)/);
  assert.match(reason, /negative-future \(no maximum date documented\)/);
  assert.match(reason, /negative-timezone \(no timezone rule documented\)/);
});

test('text with no pattern and no maxlength → unsupported and too-long excluded', () => {
  const text = element({
    elementId: 'UI-TEXT-OPEN',
    inputType: 'text',
    locator: '#name',
    accessibleName: 'Name',
    attributes: { type: 'text' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([text]), safety);
  const rows = negativeRows(checks, 'UI-TEXT-OPEN');
  assert.equal(rows.filter((c) => c.id.endsWith('negative-unsupported')).length, 0);
  assert.equal(rows.filter((c) => c.id.endsWith('negative-too-long')).length, 0);
  const reason = exclusionReason(checks, 'UI-TEXT-OPEN');
  assert.match(reason, /negative-unsupported \(no pattern documented\)/);
  assert.match(reason, /negative-too-long \(no maximum documented\)/);
});

test('select with options → not-an-option planned; select without options → excluded', () => {
  const withOpts = element({
    elementId: 'UI-SEL-OPTS',
    elementType: 'select',
    elementKind: 'select',
    locator: '#country',
    accessibleName: 'Country',
    optionValues: ['us', 'ca'],
  });
  const noOpts = element({
    elementId: 'UI-SEL-EMPTY',
    elementType: 'select',
    elementKind: 'select',
    locator: '#city',
    accessibleName: 'City',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([withOpts, noOpts]), safety);

  const planned = negativeRows(checks, 'UI-SEL-OPTS').find((c) => c.id.endsWith('negative-invalid-option'));
  assert.ok(planned);
  assert.equal(planned?.expect?.fillValue, 'not-an-option');
  assert.equal(planned?.status, 'PLANNED');
  assert.equal(planned?.action, 'fill-no-submit');
  assert.match(planned?.reason ?? '', /value not in options/i);

  assert.equal(
    negativeRows(checks, 'UI-SEL-EMPTY').filter((c) => c.id.endsWith('negative-invalid-option')).length,
    0
  );
  assert.match(exclusionReason(checks, 'UI-SEL-EMPTY'), /negative-invalid-option \(no options discovered\)/);
});

test('submit button does not gain a PLANNED negative click', () => {
  const submit = element({
    elementId: 'UI-SUBMIT',
    elementType: 'button',
    elementKind: 'submit-button',
    locator: '#go',
    accessibleName: 'Submit',
    isSubmit: true,
    potentialAction: 'submit',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([submit]), safety);
  const negClicks = checks.filter(
    (c) =>
      c.targetElementId === 'UI-SUBMIT' &&
      c.scenarioKind === 'negative' &&
      c.status === 'PLANNED' &&
      (c.action === 'click-button' || c.kind === 'click-button' || c.kind === 'form-submit')
  );
  assert.equal(negClicks.length, 0);
  assert.ok(!checks.some((c) => c.targetElementId === 'UI-SUBMIT' && c.status === ('PASS' as never)));
});

test('password credential fixture is wrong-password-fixture and reason says not submitted', () => {
  const pwd = element({
    elementId: 'UI-PASS-NEG',
    inputType: 'password',
    elementKind: 'password-input',
    locator: '#password',
    accessibleName: 'Password',
    attributes: { type: 'password' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([pwd]), safety);
  const row = negativeRows(checks, 'UI-PASS-NEG').find((c) => c.id.endsWith('negative-invalid-credentials'));
  assert.ok(row);
  assert.equal(row?.expect?.fillValue, 'wrong-password-fixture');
  assert.equal(row?.status, 'PLANNED');
  assert.equal(row?.action, 'fill-no-submit');
  assert.match(row?.reason ?? '', /invalid credential fixture; form is not submitted/i);
});

test('no demo hosts in negative fixtures or reasons', () => {
  const email = element({
    elementId: 'UI-EMAIL-HOST',
    inputType: 'email',
    elementKind: 'email-input',
    locator: '#email',
    accessibleName: 'Email',
    required: true,
    attributes: { type: 'email' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([email]), safety);
  const rows = negativeRows(checks, 'UI-EMAIL-HOST');
  const blob = JSON.stringify(rows);
  assert.ok(!/saucedemo|the-internet\.herokuapp|demo\.|localhost:3000/i.test(blob));
});
