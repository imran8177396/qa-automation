import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { FORM_SUBMIT_NOT_AUTHORIZED_REASON } from './button-cases';
import { buildFormPlansForScreen, detectFormsOnScreen, requiredState } from './form-cases';
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

function formRows(checks: ReturnType<typeof buildScenarioInventory>) {
  return checks.filter(
    (c) =>
      c.scenarioKind === 'form' &&
      typeof c.id === 'string' &&
      /form-/.test(c.id)
  );
}

function rowBySuffix(checks: ReturnType<typeof buildScenarioInventory>, suffix: string) {
  return formRows(checks).find((c) => typeof c.id === 'string' && c.id.endsWith(suffix));
}

test('email required + text optional + submit: core form rows and never executable submit', () => {
  const email = element({
    elementId: 'UI-EMAIL',
    inputType: 'email',
    elementKind: 'email-input',
    accessibleName: 'Email',
    locator: '#email',
    required: true,
  });
  const text = element({
    elementId: 'UI-NOTES',
    inputType: 'text',
    elementKind: 'text-input',
    accessibleName: 'Notes',
    locator: '#notes',
    required: false,
  });
  const submit = element({
    elementId: 'UI-SUBMIT',
    elementType: 'button',
    elementKind: 'submit-button',
    tag: 'button',
    accessibleName: 'Send',
    locator: 'text=Send',
    isSubmit: true,
    required: false,
    potentialAction: 'click',
  });

  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([email, text, submit]), safety);
  const rows = formRows(checks);

  const allValid = rowBySuffix(checks, 'form-all-valid');
  assert.equal(allValid?.status, 'PLANNED');
  assert.equal(allValid?.action, 'fill-no-submit');
  assert.ok(rows.length > 1, 'form-all-valid must not be the only form-* row');
  assert.ok(rows.some((r) => r.id !== allValid?.id && /form-/.test(r.id)));

  const missingEmail = rowBySuffix(checks, 'form-missing-required-UI-EMAIL');
  assert.equal(missingEmail?.status, 'PLANNED');
  assert.equal(missingEmail?.action, 'fill-no-submit');
  assert.equal(
    rows.filter((r) => /form-missing-required-/.test(r.id)).length,
    1,
    'missing-required only for the email element'
  );
  assert.ok(!rows.some((r) => r.id.endsWith('form-missing-required-UI-NOTES')));

  assert.equal(rowBySuffix(checks, 'form-empty')?.status, 'PLANNED');
  assert.equal(rowBySuffix(checks, 'form-submit')?.status, 'BLOCKED');
  assert.match(rowBySuffix(checks, 'form-submit')?.reason ?? '', /form submission is not authorized/);
  assert.equal(rowBySuffix(checks, 'form-submit')?.reason, FORM_SUBMIT_NOT_AUTHORIZED_REASON);

  assert.equal(rowBySuffix(checks, 'form-duplicate-submission')?.status, 'NOT_TESTED');
  assert.equal(rowBySuffix(checks, 'form-rapid-submission')?.status, 'NOT_TESTED');
  assert.equal(rowBySuffix(checks, 'form-server-error')?.status, 'NOT_TESTED');
  assert.equal(rowBySuffix(checks, 'form-network-failure')?.status, 'NOT_TESTED');
  assert.equal(rowBySuffix(checks, 'form-session-expiration')?.status, 'REQUIRES_CONFIGURATION');

  for (const row of rows) {
    assert.notEqual(row.action, 'click-button');
    assert.ok(row.action !== ('submit' as typeof row.action));
    if (row.id.endsWith('form-submit')) {
      assert.equal(row.status, 'BLOCKED');
      assert.equal(row.action, 'none');
    }
  }

  assert.ok(!JSON.stringify(rows).includes('<'));
});

test('no required flags: form-empty is NOT_TESTED or NOT_APPLICABLE, not a fake failure', () => {
  const unknownA = element({
    elementId: 'UI-A',
    inputType: 'text',
    elementKind: 'text-input',
    accessibleName: 'A',
  });
  delete (unknownA as { required?: boolean }).required;

  const unknownB = element({
    elementId: 'UI-B',
    inputType: 'text',
    elementKind: 'text-input',
    accessibleName: 'B',
    locator: '#b',
  });
  delete (unknownB as { required?: boolean }).required;

  assert.equal(requiredState(unknownA), undefined);

  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([unknownA, unknownB]), safety);
  const empty = rowBySuffix(checks, 'form-empty');
  assert.ok(empty);
  assert.ok(empty!.status === 'NOT_TESTED' || empty!.status === 'NOT_APPLICABLE');
  assert.notEqual(empty!.status, 'FAIL');
  assert.notEqual(empty!.status, 'PLANNED');
});

test('explicitly optional fields only: form-empty is NOT_APPLICABLE', () => {
  const notes = element({
    elementId: 'UI-OPT',
    inputType: 'text',
    elementKind: 'text-input',
    required: false,
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([notes]), safety);
  assert.equal(rowBySuffix(checks, 'form-empty')?.status, 'NOT_APPLICABLE');
  assert.match(rowBySuffix(checks, 'form-empty')?.reason ?? '', /empty form is valid when no field is required/);
});

test('screen with no fillable fields produces zero form rows', () => {
  const link = element({
    elementId: 'UI-LINK',
    elementType: 'link',
    elementKind: 'link',
    href: '/next',
    accessibleName: 'Next',
    potentialAction: 'navigate',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([link]), safety);
  assert.equal(formRows(checks).length, 0);
  assert.equal(detectFormsOnScreen([link]).length, 0);
});

test('hasAuthSession true → form-session-expiration is NOT_TESTED, never PASS', () => {
  const email = element({
    elementId: 'UI-EMAIL',
    inputType: 'email',
    elementKind: 'email-input',
    required: true,
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([email]), safety, {
    hasAuthSession: true,
  });
  const session = rowBySuffix(checks, 'form-session-expiration');
  assert.equal(session?.status, 'NOT_TESTED');
  assert.match(session?.reason ?? '', /session expiration is not simulated/);
  assert.notEqual(session?.status, 'PASS' as typeof session.status);
});

test('buildFormPlansForScreen returns empty when no fillable fields', () => {
  const screen = {
    id: 'SCREEN-001',
    url: 'http://app.test/empty.html',
    state: 'default',
    source: 'direct-url' as const,
  };
  const results = buildFormPlansForScreen({
    screen,
    elements: [
      element({
        elementId: 'UI-BTN',
        elementType: 'button',
        elementKind: 'button',
        page: screen.url,
      }),
    ],
    screens: [screen],
  });
  assert.equal(results.length, 0);
});

test('no planned form row declares executable submit', () => {
  const email = element({
    elementId: 'UI-EMAIL',
    inputType: 'email',
    elementKind: 'email-input',
    required: true,
  });
  const submit = element({
    elementId: 'UI-SUBMIT',
    elementType: 'button',
    elementKind: 'submit-button',
    isSubmit: true,
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([email, submit]), safety);
  const bad = formRows(checks).filter(
    (c) =>
      c.status === 'PLANNED' &&
      (c.kind === 'form-submit' || c.action === 'click-button' || c.action === ('submit' as typeof c.action))
  );
  assert.equal(bad.length, 0);
});
