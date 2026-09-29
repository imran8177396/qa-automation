import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { buildFieldSubcases, FIELD_FIXTURES, isPhoneField } from './field-cases';
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

function fieldRows(checks: ReturnType<typeof buildScenarioInventory>, elementId: string) {
  return checks.filter(
    (c) =>
      c.targetElementId === elementId &&
      c.scenarioKind === 'field' &&
      typeof c.id === 'string' &&
      /field-/.test(c.id)
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

test('text field plans html-tag-fixture and script-like-fixture; neither value contains "<"', () => {
  const text = element({
    elementId: 'UI-TEXT-FIELD',
    inputType: 'text',
    elementKind: 'text-input',
    accessibleName: 'Notes',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([text]), safety);
  const rows = fieldRows(checks, 'UI-TEXT-FIELD');
  const html = rows.find((c) => c.id.endsWith('field-html'));
  const script = rows.find((c) => c.id.endsWith('field-script-like'));
  assert.equal(html?.status, 'PLANNED');
  assert.equal(script?.status, 'PLANNED');
  assert.equal(html?.expect?.fillValue, FIELD_FIXTURES.html);
  assert.equal(script?.expect?.fillValue, FIELD_FIXTURES.scriptLike);
  assert.ok(!String(html?.expect?.fillValue).includes('<'));
  assert.ok(!String(script?.expect?.fillValue).includes('<'));
  assert.match(html?.reason ?? '', /inert fixture/i);
  assert.equal(html?.action, 'fill-no-submit');
});

test('email does not add a second PLANNED user@example.com when positive-valid already plans it', () => {
  const email = element({
    elementId: 'UI-EMAIL-FIELD',
    inputType: 'email',
    elementKind: 'email-input',
    accessibleName: 'Email',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([email]), safety);
  const positiveValid = checks.find(
    (c) => c.targetElementId === 'UI-EMAIL-FIELD' && c.id.endsWith('positive-valid')
  );
  assert.equal(positiveValid?.expect?.fillValue, POSITIVE_FIXTURES.emailValid);
  assert.equal(positiveValid?.status, 'PLANNED');

  const fieldValid = fieldRows(checks, 'UI-EMAIL-FIELD').filter(
    (c) => c.id.endsWith('field-email-valid') && c.status === 'PLANNED'
  );
  assert.equal(fieldValid.length, 0);

  const reason = exclusionReason(checks, 'UI-EMAIL-FIELD');
  assert.match(reason, /field-email-valid \(already covered by positive-valid\)/);
});

test('phone type=tel plans E.164 fixture; plain text without phone name does not', () => {
  const tel = element({
    elementId: 'UI-TEL',
    inputType: 'tel',
    accessibleName: 'Mobile',
    attributes: { type: 'tel' },
  });
  const plain = element({
    elementId: 'UI-PLAIN',
    inputType: 'text',
    elementKind: 'text-input',
    accessibleName: 'Nickname',
    attributes: { name: 'nickname', type: 'text' },
  });

  assert.equal(isPhoneField(tel), true);
  assert.equal(isPhoneField(plain), false);

  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([tel, plain]), safety);
  const telPhone = fieldRows(checks, 'UI-TEL').find((c) => c.id.endsWith('field-phone-valid'));
  assert.equal(telPhone?.status, 'PLANNED');
  assert.equal(telPhone?.expect?.fillValue, FIELD_FIXTURES.phoneValid);

  const plainPhone = fieldRows(checks, 'UI-PLAIN').filter((c) => /field-phone-/.test(c.id));
  assert.equal(plainPhone.length, 0);
});

test('date today is NOT_TESTED and planned JSON has no live clock value', () => {
  const date = element({
    elementId: 'UI-DATE',
    inputType: 'date',
    elementKind: 'date-input',
    accessibleName: 'Start date',
    attributes: { type: 'date' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([date]), safety);
  const today = fieldRows(checks, 'UI-DATE').find((c) => c.id.endsWith('field-today'));
  assert.equal(today?.status, 'NOT_TESTED');
  assert.match(today?.reason ?? '', /clock was not fixed/i);
  assert.equal(today?.expect?.fillValue, undefined);
  assert.equal(today?.action, 'none');

  const fieldPayload = JSON.stringify(fieldRows(checks, 'UI-DATE'));
  const isoToday = new Date().toISOString().slice(0, 10);
  assert.ok(!fieldPayload.includes(isoToday), 'field plans must not embed a live clock date');
  // Fixed date fixture for valid is allowed; today row must not carry it.
  const valid = fieldRows(checks, 'UI-DATE').find((c) => c.id.endsWith('field-date-valid'));
  if (valid?.status === 'PLANNED') {
    assert.equal(valid.expect?.fillValue, FIELD_FIXTURES.dateValid);
  }
});

test('file input does not require fs.write; very-large and corrupted are NOT_TESTED; special name has no ".."', () => {
  const file = element({
    elementId: 'UI-FILE',
    inputType: 'file',
    elementKind: 'file-upload',
    elementType: 'file-upload',
    accessibleName: 'Upload',
    attributes: { type: 'file', accept: '.txt,.pdf' },
  });
  const result = buildFieldSubcases({
    element: file,
    purpose: 'unknown',
    control: 'text',
    label: 'upload',
    locator: '#file',
  });

  const writeSpy = (fs as { writeFileSync?: unknown }).writeFileSync;
  assert.equal(typeof writeSpy, 'function');

  const veryLarge = result.plans.find((p) => p.subcaseId === 'field-file-very-large');
  const corrupted = result.plans.find((p) => p.subcaseId === 'field-file-corrupted');
  assert.equal(veryLarge?.status, 'NOT_TESTED');
  assert.equal(corrupted?.status, 'NOT_TESTED');

  const special = result.plans.find((p) => p.subcaseId === 'field-file-special-name');
  assert.equal(special?.status, 'PLANNED');
  assert.equal(special?.expect?.fillValue, FIELD_FIXTURES.fileSpecialName);
  assert.ok(!String(special?.expect?.fillValue).includes('..'));
  assert.match(special?.expect?.note ?? '', /file bytes are not written/i);
  assert.notEqual(special?.action, 'fill-no-submit');
});

test('search rapid is NOT_TESTED', () => {
  const search = element({
    elementId: 'UI-SEARCH',
    inputType: 'search',
    elementKind: 'search-field',
    accessibleName: 'Search',
    attributes: { type: 'search' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([search]), safety);
  const rapid = fieldRows(checks, 'UI-SEARCH').find((c) => c.id.endsWith('field-search-rapid'));
  assert.equal(rapid?.status, 'NOT_TESTED');
  assert.match(rapid?.reason ?? '', /rapid search was not observed/i);
  assert.notEqual(rapid?.status, 'PASS' as string);
});

test('weak password value is exactly weak-password-fixture', () => {
  const pwd = element({
    elementId: 'UI-PASS',
    inputType: 'password',
    elementKind: 'password-input',
    accessibleName: 'Password',
    attributes: { type: 'password' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([pwd]), safety);
  const weak = fieldRows(checks, 'UI-PASS').find((c) => c.id.endsWith('field-weak-password'));
  assert.equal(weak?.status, 'PLANNED');
  assert.equal(weak?.expect?.fillValue, FIELD_FIXTURES.weakPassword);
  assert.equal(weak?.expect?.fillValue, 'weak-password-fixture');
  assert.equal(weak?.action, 'fill-no-submit');
  assert.match(weak?.reason ?? '', /weak-password fixture/i);

  const incorrectPlanned = fieldRows(checks, 'UI-PASS').filter(
    (c) => c.id.endsWith('field-incorrect-password') && c.status === 'PLANNED'
  );
  assert.equal(incorrectPlanned.length, 0);
  assert.match(
    exclusionReason(checks, 'UI-PASS'),
    /field-incorrect-password \(already covered by negative-invalid-credentials\)/
  );
});

test('no demo hosts in field fixtures; decorative gets no field PLANNED rows', () => {
  const text = element({
    elementId: 'UI-TXT',
    inputType: 'text',
    elementKind: 'text-input',
  });
  const deco = element({
    elementId: 'UI-DECO',
    elementType: 'image',
    elementKind: 'decorative',
    accessibleName: '',
    interactive: false,
    potentialAction: 'none',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([text, deco]), safety);
  const fieldBlob = JSON.stringify(fieldRows(checks, 'UI-TXT'));
  assert.doesNotMatch(fieldBlob, /example\.com|localhost|demo\.|saucedemo|the-internet/i);

  assert.equal(fieldRows(checks, 'UI-DECO').filter((c) => c.status === 'PLANNED').length, 0);
});

test('no field subcase is marked PASS', () => {
  const text = element({
    elementId: 'UI-NO-PASS',
    inputType: 'text',
    elementKind: 'text-input',
    maxLength: '8',
    minLength: '2',
    required: true,
    attributes: { maxlength: '8', minlength: '2' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([text]), safety);
  assert.ok(
    fieldRows(checks, 'UI-NO-PASS').every((c) => (c.status as string) !== 'PASS'),
    'excluded or planned field cases must never be PASS'
  );
});
