import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { buildScenarioInventory } from './scenario-inventory';
import { POSITIVE_FIXTURES } from './positive-cases';

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

function positiveRows(checks: ReturnType<typeof buildScenarioInventory>, elementId: string) {
  return checks.filter(
    (c) =>
      c.targetElementId === elementId &&
      c.scenarioKind === 'positive' &&
      typeof c.id === 'string' &&
      /positive-/.test(c.id)
  );
}

test('email → three positive rows (valid, subdomain, plus); no exploit payloads', () => {
  const email = element({
    elementId: 'UI-EMAIL-POS',
    inputType: 'email',
    elementKind: 'email-input',
    locator: '#email',
    accessibleName: 'Email',
    attributes: { type: 'email' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([email]), safety);
  const rows = positiveRows(checks, 'UI-EMAIL-POS');
  const bySuffix = Object.fromEntries(rows.map((r) => [r.id.replace(/^INV-\d+-/, ''), r]));
  assert.ok(bySuffix['positive-valid']);
  assert.ok(bySuffix['positive-subdomain']);
  assert.ok(bySuffix['positive-plus']);
  assert.equal(bySuffix['positive-valid']?.expect?.fillValue, POSITIVE_FIXTURES.emailValid);
  assert.equal(bySuffix['positive-subdomain']?.expect?.fillValue, POSITIVE_FIXTURES.emailSubdomain);
  assert.equal(bySuffix['positive-plus']?.expect?.fillValue, POSITIVE_FIXTURES.emailPlus);
  assert.match(bySuffix['positive-subdomain']?.title ?? '', /format fixture/i);
  assert.match(bySuffix['positive-plus']?.reason ?? '', /plus-addressing format fixture/i);
  assert.equal(bySuffix['positive-valid']?.status, 'PLANNED');
  assert.equal(bySuffix['positive-valid']?.action, 'fill-no-submit');
  assert.ok(!rows.some((c) => c.status === ('PASS' as never)));
  const blob = JSON.stringify(rows.map((r) => r.expect));
  assert.ok(!/<(script|img)|select\s|drop\s|union\s|or\s+1=1/i.test(blob));
});

test('text with maxlength 5 → positive-max length <= 5; without maxlength → exclusion only', () => {
  const withMax = element({
    elementId: 'UI-TEXT-MAX',
    locator: '#short',
    accessibleName: 'Short',
    inputType: 'text',
    maxLength: '5',
    attributes: { type: 'text', maxlength: '5' },
  });
  const open = element({
    elementId: 'UI-TEXT-OPEN',
    locator: '#open',
    accessibleName: 'Open',
    inputType: 'text',
    attributes: { type: 'text' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([withMax, open]), safety);

  const maxRow = positiveRows(checks, 'UI-TEXT-MAX').find((c) => c.id.endsWith('positive-max'));
  assert.ok(maxRow);
  assert.ok((maxRow?.expect?.fillValue ?? '').length <= 5);
  assert.equal(maxRow?.expect?.fillValue, 'aaaaa');

  assert.equal(
    positiveRows(checks, 'UI-TEXT-OPEN').filter((c) => c.id.endsWith('positive-max')).length,
    0
  );
  const exclusion = checks.find(
    (c) =>
      c.targetElementId === 'UI-TEXT-OPEN' &&
      c.status === 'NOT_APPLICABLE' &&
      /positive-max \(no maximum constraint discovered\)/.test(c.reason ?? '')
  );
  assert.ok(exclusion);
});

test('password fixtures are password-fixture or repeated char — never a realistic secret', () => {
  const pwd = element({
    elementId: 'UI-PASS-POS',
    locator: '#password',
    accessibleName: 'Password',
    inputType: 'password',
    elementKind: 'password-input',
    minLength: '4',
    maxLength: '8',
    attributes: { type: 'password', minlength: '4', maxlength: '8' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([pwd]), safety);
  const rows = positiveRows(checks, 'UI-PASS-POS');
  const values = rows.map((r) => r.expect?.fillValue).filter(Boolean);
  assert.ok(values.includes(POSITIVE_FIXTURES.passwordValid));
  assert.ok(values.includes('aaaa'));
  assert.ok(values.includes('aaaaaaaa'));
  assert.ok(!values.some((v) => /Password123|SecretPass|hunter2|SamplePass/i.test(v ?? '')));
});

test('select with two options → change-selection planned; zero options → exclusion, no Option 1', () => {
  const withOpts = element({
    elementId: 'UI-SEL-2',
    elementType: 'select',
    elementKind: 'select',
    locator: '#country',
    accessibleName: 'Country',
    evidence: '<select>',
    optionValues: ['us', 'ca'],
  });
  const empty = element({
    elementId: 'UI-SEL-0',
    elementType: 'select',
    elementKind: 'select',
    locator: '#empty',
    accessibleName: 'Empty',
    evidence: '<select>',
    optionValues: [],
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([withOpts, empty]), safety);

  const two = positiveRows(checks, 'UI-SEL-2');
  assert.ok(two.some((c) => c.id.endsWith('positive-select') && c.status === 'PLANNED'));
  assert.ok(two.some((c) => c.id.endsWith('positive-change') && c.expect?.fillValue === 'ca'));
  assert.ok(two.every((c) => c.action !== ('submit' as never)));
  assert.ok(!JSON.stringify(two).includes('Option 1'));

  assert.equal(positiveRows(checks, 'UI-SEL-0').length, 0);
  assert.ok(
    checks.some(
      (c) =>
        c.targetElementId === 'UI-SEL-0' &&
        /positive-select \(no options discovered\)/.test(c.reason ?? '')
    )
  );
  assert.ok(!checks.some((c) => c.targetElementId === 'UI-SEL-0' && /Option 1/.test(JSON.stringify(c))));
});

test('checkbox → check, uncheck, verify; no submit action', () => {
  const box = element({
    elementId: 'UI-CHK',
    elementType: 'checkbox',
    elementKind: 'checkbox',
    locator: '#agree',
    accessibleName: 'Agree',
    inputType: 'checkbox',
    evidence: 'input type=checkbox',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([box]), safety);
  const rows = positiveRows(checks, 'UI-CHK');
  assert.ok(rows.some((c) => c.id.endsWith('positive-check') && c.expect?.checked === true));
  assert.ok(rows.some((c) => c.id.endsWith('positive-uncheck') && c.expect?.checked === false));
  assert.ok(rows.some((c) => c.id.endsWith('positive-verify')));
  assert.ok(rows.every((c) => c.action === 'fill-no-submit' || c.action === 'observe' || c.action === 'none'));
  assert.ok(!rows.some((c) => c.kind === 'form-submit'));
  assert.ok(!rows.some((c) => String(c.action) === 'submit'));
});

test('submit button → positive-click BLOCKED; verify API is NOT_TESTED without request URL', () => {
  const submit = element({
    elementId: 'UI-SUB-POS',
    elementType: 'button',
    tag: 'button',
    inputType: 'submit',
    isSubmit: true,
    formMethod: 'post',
    elementKind: 'submit-button',
    locator: 'text=Submit',
    accessibleName: 'Submit',
    evidence: 'submit button',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([submit]), safety);
  const rows = positiveRows(checks, 'UI-SUB-POS');
  const click = rows.find((c) => c.id.endsWith('positive-click'));
  assert.ok(click);
  assert.equal(click?.status, 'BLOCKED');
  assert.match(click?.reason ?? '', /positive-click blocked: state-changing control/i);
  assert.ok(!rows.some((c) => c.id.endsWith('positive-click') && c.status === 'PLANNED'));

  const api = rows.find((c) => c.id.endsWith('positive-api'));
  assert.ok(api);
  assert.equal(api?.status, 'NOT_TESTED');
  assert.match(api?.reason ?? '', /no API request was observed for this control/i);
});

test('link → positive-destination uses fixture href; no demo hosts invented', () => {
  const link = element({
    elementId: 'UI-LINK-POS',
    elementType: 'link',
    elementKind: 'link',
    locator: 'text=Docs',
    accessibleName: 'Docs',
    href: '/docs.html',
    evidence: '<a href>',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html'), page('/docs.html')]), ui([link]), safety);
  const rows = positiveRows(checks, 'UI-LINK-POS');
  const dest = rows.find((c) => c.id.endsWith('positive-destination'));
  assert.ok(dest);
  assert.equal(dest?.expect?.href, '/docs.html');
  assert.ok(!checks.some((c) => /demo\.|example\.com\/login|localhost:3000/i.test(JSON.stringify(c.expect ?? {}))));
});

test('decorative element gets no positive subcases', () => {
  const icon = element({
    elementId: 'UI-DECO-POS',
    elementType: 'image',
    elementKind: 'decorative',
    locator: null,
    accessibleName: null,
    evidence: 'decorative',
    attributes: { 'aria-hidden': 'true' },
    interactive: false,
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([icon]), safety);
  assert.equal(positiveRows(checks, 'UI-DECO-POS').length, 0);
  assert.ok(!checks.some((c) => c.targetElementId === 'UI-DECO-POS' && c.status === ('PASS' as never)));
});

test('no positive subcase is marked PASS', () => {
  const text = element({
    elementId: 'UI-NO-PASS',
    locator: '#name',
    accessibleName: 'Name',
    inputType: 'text',
    maxLength: '10',
    attributes: { type: 'text', maxlength: '10' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([text]), safety);
  assert.ok(!checks.some((c) => c.status === ('PASS' as never)));
  assert.ok(
    positiveRows(checks, 'UI-NO-PASS').every(
      (c) => c.status === 'PLANNED' || c.status === 'BLOCKED' || c.status === 'NOT_TESTED' || c.status === 'NOT_APPLICABLE'
    )
  );
});
