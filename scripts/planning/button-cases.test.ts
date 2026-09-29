import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { ROOT } from '../lib/paths';
import {
  buildButtonSubcases,
  inferButtonBehavior,
  isButtonKindForPlanning,
} from './button-cases';
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
    elementType: 'button',
    tag: 'button',
    locator: '#btn',
    locatorCandidates: ['#btn'],
    accessibleName: 'Action',
    visible: true,
    enabled: true,
    required: false,
    interactive: true,
    potentialAction: 'click',
    applicableTestTypes: ['form-presence'],
    discoveryStatus: 'DISCOVERED',
    evidence: 'button',
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

function buttonRows(checks: ReturnType<typeof buildScenarioInventory>, elementId: string) {
  return checks.filter(
    (c) =>
      c.targetElementId === elementId &&
      c.scenarioKind === 'button' &&
      typeof c.id === 'string' &&
      /button-/.test(c.id)
  );
}

function rowBySuffix(
  checks: ReturnType<typeof buildScenarioInventory>,
  elementId: string,
  suffix: string
) {
  return buttonRows(checks, elementId).find((c) => typeof c.id === 'string' && c.id.endsWith(suffix));
}

test('delete button, development, authorizeDestructive false → delete-valid BLOCKED; rapid/unauthorized NOT_TESTED; no executable click/submit', () => {
  const del = element({
    elementId: 'UI-DEL',
    elementKind: 'delete-button',
    locator: 'text=Delete',
    accessibleName: 'Delete',
    evidence: 'delete button',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([del]), safety, {
    environment: 'development',
    authorizeDestructive: false,
  });
  const valid = rowBySuffix(checks, 'UI-DEL', 'button-delete-valid');
  assert.ok(valid);
  assert.equal(valid?.status, 'BLOCKED');
  assert.notEqual(valid?.status, 'PLANNED');
  assert.match(valid?.reason ?? '', /delete valid record is not executed|destructive action is not authorized/i);

  const rapid = rowBySuffix(checks, 'UI-DEL', 'button-delete-rapid');
  assert.ok(rapid);
  assert.equal(rapid?.status, 'NOT_TESTED');

  const unauthorized = rowBySuffix(checks, 'UI-DEL', 'button-delete-unauthorized');
  assert.ok(unauthorized);
  assert.equal(unauthorized?.status, 'NOT_TESTED');

  const buttonPlans = buttonRows(checks, 'UI-DEL');
  assert.ok(buttonPlans.length >= 11);
  for (const row of buttonPlans) {
    assert.notEqual(String(row.action), 'submit');
    if (row.status === 'PLANNED') {
      assert.equal(row.action, 'observe');
    }
    assert.ok(
      row.action === 'observe' || row.action === 'none',
      `unexpected executable action ${row.action} on ${row.id}`
    );
    assert.notEqual(row.status, 'PASS' as never);
  }
  assert.ok(!buttonPlans.some((c) => c.id.endsWith('button-delete-valid') && c.status === 'PLANNED'));
});

test('same delete button with environment production → reason mentions production', () => {
  const del = element({
    elementId: 'UI-DEL-PROD',
    elementKind: 'delete-button',
    locator: 'text=Delete',
    accessibleName: 'Delete',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([del]), safety, {
    environment: 'production',
    authorizeDestructive: false,
  });
  const valid = rowBySuffix(checks, 'UI-DEL-PROD', 'button-delete-valid');
  assert.ok(valid);
  assert.equal(valid?.status, 'BLOCKED');
  assert.match(valid?.reason ?? '', /production/i);
});

test('delete button plus Confirm delete dialog → confirm PLANNED observe, still no click', () => {
  const pageUrl = 'http://app.test/form.html';
  const del = element({
    page: pageUrl,
    elementId: 'UI-DEL-CONFIRM',
    elementKind: 'delete-button',
    locator: 'text=Delete',
    accessibleName: 'Delete',
  });
  const dialog = element({
    page: pageUrl,
    elementId: 'UI-DIALOG',
    elementType: 'modal',
    elementKind: 'dialog',
    tag: 'div',
    locator: '[role=dialog]',
    accessibleName: 'Confirm delete',
    attributes: { role: 'dialog' },
    evidence: 'role=dialog',
    interactive: false,
    potentialAction: 'observe',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([del, dialog]), safety, {
    environment: 'development',
    authorizeDestructive: false,
  });
  const confirm = rowBySuffix(checks, 'UI-DEL-CONFIRM', 'button-delete-confirm');
  assert.ok(confirm);
  assert.equal(confirm?.status, 'PLANNED');
  assert.equal(confirm?.action, 'observe');
  assert.match(confirm?.reason ?? '', /confirmation dialog was present/i);
  assert.ok(!buttonRows(checks, 'UI-DEL-CONFIRM').some((c) => c.action === 'click-button'));
});

test('cancel button on the same screen → observe cancel planned', () => {
  const pageUrl = 'http://app.test/form.html';
  const del = element({
    page: pageUrl,
    elementId: 'UI-DEL-CANCEL',
    elementKind: 'delete-button',
    locator: 'text=Delete',
    accessibleName: 'Delete',
  });
  const cancel = element({
    page: pageUrl,
    elementId: 'UI-CANCEL',
    elementKind: 'cancel-button',
    locator: 'text=Cancel',
    accessibleName: 'Cancel',
    evidence: 'cancel button',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([del, cancel]), safety);
  const cancelRow = rowBySuffix(checks, 'UI-DEL-CANCEL', 'button-delete-cancel');
  assert.ok(cancelRow);
  assert.equal(cancelRow?.status, 'PLANNED');
  assert.equal(cancelRow?.action, 'observe');
  assert.match(cancelRow?.reason ?? '', /cancel is observed; deletion is not performed/i);
});

test('submit button → BLOCKED, no PLANNED submit', () => {
  const submit = element({
    elementId: 'UI-SUBMIT-BTN',
    elementKind: 'submit-button',
    inputType: 'submit',
    isSubmit: true,
    formMethod: 'post',
    locator: 'text=Submit',
    accessibleName: 'Submit',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([submit]), safety);
  const submitRow = rowBySuffix(checks, 'UI-SUBMIT-BTN', 'button-submit');
  assert.ok(submitRow);
  assert.equal(submitRow?.status, 'BLOCKED');
  assert.notEqual(submitRow?.status, 'PLANNED');
  assert.equal(submitRow?.action, 'none');
  assert.ok(
    !buttonRows(checks, 'UI-SUBMIT-BTN').some(
      (c) => c.status === 'PLANNED' && (c.kind === 'form-submit' || String(c.action) === 'submit')
    )
  );
});

test('button with href /next and no state-changing flag → navigate observe planned', () => {
  const navBtn = element({
    elementId: 'UI-NAV-BTN',
    elementKind: 'button',
    locator: 'text=Next',
    accessibleName: 'Next',
    href: '/next',
    evidence: 'button with href',
  });
  const checks = buildScenarioInventory(
    pageMap([page('/form.html'), page('/next')]),
    ui([navBtn]),
    safety
  );
  const nav = rowBySuffix(checks, 'UI-NAV-BTN', 'button-navigate');
  assert.ok(nav);
  assert.equal(nav?.status, 'PLANNED');
  assert.equal(nav?.action, 'observe');
  assert.equal(nav?.expect?.href, '/next');
});

test('plain button no href → undetermined NOT_TESTED, no invented modal or API', () => {
  const plain = element({
    elementId: 'UI-PLAIN',
    elementKind: 'button',
    locator: '#plain',
    accessibleName: 'Do something',
    href: null,
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([plain]), safety);
  const undetermined = rowBySuffix(checks, 'UI-PLAIN', 'button-behavior-undetermined');
  assert.ok(undetermined);
  assert.equal(undetermined?.status, 'NOT_TESTED');
  assert.match(undetermined?.reason ?? '', /button behavior was not determined from discovery evidence/i);

  const rows = buttonRows(checks, 'UI-PLAIN');
  assert.ok(!rows.some((c) => /modal|api/i.test(c.id) && c.status === 'PLANNED'));
  assert.ok(!rows.some((c) => c.id.endsWith('button-submit') || c.id.endsWith('button-delete-valid')));
  assert.ok(!JSON.stringify(rows).includes('invented'));
});

test('inferButtonBehavior leaves modal/api unknown without evidence', () => {
  const plain = element({
    elementKind: 'button',
    accessibleName: 'Go',
    href: null,
  });
  const behavior = inferButtonBehavior({
    element: plain,
    kind: 'button',
    pageUrl: 'http://app.test/form.html',
    safety,
    pageElements: [plain],
    screens: [],
  });
  assert.equal(behavior.undetermined, true);
  assert.equal(behavior.tokens.find((t) => t.token === 'modal')?.status, 'unknown');
  assert.equal(behavior.tokens.find((t) => t.token === 'api')?.status, 'unknown');
  assert.equal(behavior.tokens.find((t) => t.token === 'delete')?.status, 'unknown');
});

test('decorative is not a button planning target', () => {
  assert.equal(isButtonKindForPlanning('unknown', 'decorative'), false);
  const deco = element({
    elementId: 'UI-DECO',
    elementKind: 'decorative',
    elementType: 'image',
    attributes: { 'aria-hidden': 'true' },
    accessibleName: null,
    interactive: false,
  });
  const result = buildButtonSubcases({
    element: deco,
    purpose: 'unknown',
    control: 'component',
    label: 'deco',
    locator: '',
    kind: 'decorative',
    pageUrl: 'http://app.test/form.html',
    safety,
  });
  assert.equal(result.plans.length, 0);
});

test('button-cases.ts has no demo hosts or script tags', () => {
  const buttonSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'button-cases.ts'), 'utf8');
  assert.doesNotMatch(buttonSrc, /sauce[\s_-]?demo/i);
  assert.doesNotMatch(buttonSrc, /swag[\s_-]?labs/i);
  assert.doesNotMatch(buttonSrc, /the-internet\.herokuapp/i);
  assert.doesNotMatch(buttonSrc, /<script>/i);
});

test('authorizeDestructive true still never PLANNED for delete-valid', () => {
  const del = element({
    elementId: 'UI-DEL-AUTH',
    elementKind: 'delete-button',
    accessibleName: 'Delete',
    locator: 'text=Delete',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([del]), safety, {
    environment: 'development',
    authorizeDestructive: true,
  });
  const valid = rowBySuffix(checks, 'UI-DEL-AUTH', 'button-delete-valid');
  assert.ok(valid);
  assert.notEqual(valid?.status, 'PLANNED');
  assert.equal(valid?.status, 'NOT_TESTED');
  assert.match(valid?.reason ?? '', /deletion is not executed by the planner/i);
});
