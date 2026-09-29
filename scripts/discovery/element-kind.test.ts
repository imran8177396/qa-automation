import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import {
  assignStableElementIdentities,
  buildStableLocator,
  classifyElementKind,
  DECORATIVE_PLAN_REASON,
  elementCategoryFromKind,
  formatElementId,
  isBlockedActionKind,
  isDecorativeElement,
  plannerActionsForKind,
  type ElementKind,
} from './element-kind';
import { buildUiInventory, type UiElementRecord } from './ui-scan';
import { attachElementsToScreens, type DiscoveredScreen } from './screens';
import { ROOT } from '../lib/paths';

function el(partial: Partial<UiElementRecord> & Pick<UiElementRecord, 'elementType'>): UiElementRecord {
  return {
    page: 'http://app.test/screen',
    elementId: 'UI-0001',
    locator: null,
    locatorCandidates: [],
    accessibleName: null,
    visible: true,
    enabled: true,
    required: false,
    interactive: true,
    potentialAction: 'observe',
    applicableTestTypes: ['visibility'],
    discoveryStatus: 'DISCOVERED',
    evidence: 'fixture',
    ...partial,
  };
}

test('classifyElementKind maps form/nav/table/decorative/delete from tag type role name', () => {
  assert.equal(
    classifyElementKind({
      tag: 'input',
      inputType: 'email',
      elementType: 'input',
      accessibleName: 'Email',
    }),
    'email-input'
  );
  assert.equal(
    classifyElementKind({
      tag: 'input',
      inputType: 'password',
      elementType: 'input',
      accessibleName: 'Password',
    }),
    'password-input'
  );
  assert.equal(
    classifyElementKind({
      tag: 'button',
      inputType: 'submit',
      elementType: 'button',
      isSubmit: true,
      accessibleName: 'Sign in',
    }),
    'submit-button'
  );
  assert.equal(
    classifyElementKind({
      tag: 'a',
      elementType: 'link',
      href: '/home',
      accessibleName: 'Home',
    }),
    'link'
  );
  assert.equal(
    classifyElementKind({
      tag: 'table',
      elementType: 'table',
      role: 'table',
      accessibleName: 'Orders',
    }),
    'table'
  );
  assert.equal(
    classifyElementKind({
      tag: 'span',
      elementType: 'image',
      attributes: { 'aria-hidden': 'true' },
      accessibleName: 'icon',
    }),
    'decorative'
  );
  assert.equal(
    classifyElementKind({
      tag: 'button',
      elementType: 'button',
      accessibleName: 'Delete item',
    }),
    'delete-button'
  );
  assert.equal(
    classifyElementKind({
      tag: 'input',
      inputType: 'file',
      elementType: 'file-upload',
    }),
    'file-upload'
  );
});

test('role=presentation is not a functional control', () => {
  assert.equal(
    isDecorativeElement({
      tag: 'img',
      role: 'presentation',
      accessibleName: 'pretty',
      attributes: { role: 'presentation' },
    }),
    true
  );
  assert.equal(
    classifyElementKind({
      tag: 'img',
      role: 'presentation',
      attributes: { role: 'presentation' },
    }),
    'decorative'
  );
});

test('does not invent absent kinds — no file-upload without a file input node', () => {
  const kinds: ElementKind[] = [
    classifyElementKind({ tag: 'input', inputType: 'email', elementType: 'input' }),
    classifyElementKind({ tag: 'input', inputType: 'password', elementType: 'input' }),
    classifyElementKind({ tag: 'button', isSubmit: true, elementType: 'button', inputType: 'submit' }),
  ];
  assert.equal(kinds.includes('file-upload'), false);
});

test('attachElementsToScreens keeps every screen id including empty lists', () => {
  const page = 'http://app.test/empty';
  const screens: DiscoveredScreen[] = [
    { id: 'SCREEN-001', url: page, state: 'default', source: 'direct-url' },
    { id: 'SCREEN-002', url: page, state: 'dialog', source: 'dialog' },
  ];
  const ui = buildUiInventory(page, 1, []);
  const attached = attachElementsToScreens(ui, screens);
  assert.equal(attached.screenElements?.length, 2);
  assert.deepEqual(
    attached.screenElements?.map((g) => ({ id: g.screenId, n: g.elements.length })),
    [
      { id: 'SCREEN-001', n: 0 },
      { id: 'SCREEN-002', n: 0 },
    ]
  );
});

test('attachElementsToScreens groups overlay-tied elements onto dialog screen', () => {
  const page = 'http://app.test/app';
  const screens: DiscoveredScreen[] = [
    { id: 'SCREEN-001', url: page, state: 'default', source: 'direct-url' },
    { id: 'SCREEN-002', url: page, state: 'dialog', source: 'dialog' },
  ];
  const elements = [
    el({
      page,
      elementId: 'UI-EMAIL',
      elementType: 'input',
      inputType: 'email',
      tag: 'input',
      locator: '#email',
      accessibleName: 'Email',
      attributes: { id: 'email', name: 'email', type: 'email' },
      insideOverlay: false,
    }),
    el({
      page,
      elementId: 'UI-DLG',
      elementType: 'button',
      tag: 'button',
      locator: '#dlg-ok',
      accessibleName: 'OK',
      attributes: { id: 'dlg-ok' },
      insideOverlay: true,
    }),
  ];
  const ui = buildUiInventory(page, 1, elements);
  const attached = attachElementsToScreens(ui, screens);
  const defaultGroup = attached.screenElements?.find((g) => g.screenId === 'SCREEN-001');
  const dialogGroup = attached.screenElements?.find((g) => g.screenId === 'SCREEN-002');
  assert.equal(defaultGroup?.elements.length, 1);
  assert.equal(defaultGroup?.elements[0]?.elementId, 'ELEMENT-001');
  assert.equal(defaultGroup?.elements[0]?.locatorStrategy, 'id');
  assert.equal(defaultGroup?.elements[0]?.locator, '#email');
  assert.equal(dialogGroup?.elements.length, 1);
  assert.equal(dialogGroup?.elements[0]?.elementId, 'ELEMENT-001');
  assert.equal(dialogGroup?.elements[0]?.elementKind, 'button');
  assert.ok(attached.elements.every((e) => e.elementKind));
});

test('email input name=email → input[name="email"], strategy name; ELEMENT id stable across calls', () => {
  const signals = {
    tag: 'input',
    inputType: 'email',
    accessibleName: 'Email',
    attributes: { name: 'email', type: 'email' },
    name: 'email',
  };
  const first = buildStableLocator(signals);
  const second = buildStableLocator(signals);
  assert.equal(first.locator, 'input[name="email"]');
  assert.equal(first.strategy, 'name');
  assert.equal(first.stable, true);
  assert.deepEqual(first, second);

  const screenId = 'SCREEN-004';
  const row = el({
    elementType: 'input',
    tag: 'input',
    inputType: 'email',
    accessibleName: 'Email',
    attributes: { name: 'email', type: 'email' },
    elementKind: 'email-input',
  });
  const a = assignStableElementIdentities([{ ...row }], screenId);
  const b = assignStableElementIdentities([{ ...row }], screenId);
  assert.equal(a[0]?.elementId, 'ELEMENT-001');
  assert.equal(b[0]?.elementId, 'ELEMENT-001');
  assert.equal(a[0]?.locator, 'input[name="email"]');
  assert.equal(a[0]?.type, 'email-input');
  assert.equal(a[0]?.label, 'Email');
  assert.equal(a[0]?.screenId, screenId);
});

test('data-testid wins over id and name', () => {
  const result = buildStableLocator({
    tag: 'input',
    inputType: 'email',
    attributes: {
      'data-testid': 'email-field',
      id: 'email',
      name: 'email',
    },
    testId: 'email-field',
    testIdAttribute: 'data-testid',
    id: 'email',
    name: 'email',
  });
  assert.equal(result.strategy, 'data-testid');
  assert.equal(result.locator, '[data-testid="email-field"]');
  assert.equal(result.stable, true);
});

test('two unnamed buttons → inventoried, locator null, not PASS, no nth-child', () => {
  const peers = [
    { tag: 'button', accessibleName: null, attributes: {} },
    { tag: 'button', accessibleName: null, attributes: {} },
  ];
  const a = buildStableLocator(peers[0]!, peers);
  const b = buildStableLocator(peers[1]!, peers);
  assert.equal(a.locator, null);
  assert.equal(b.locator, null);
  assert.equal(a.strategy, 'fallback');
  assert.equal(a.stable, false);
  assert.equal(b.stable, false);
  assert.doesNotMatch(String(a.locator), /nth-child/);
  assert.doesNotMatch(String(b.locator), /nth-child/);

  const assigned = assignStableElementIdentities(
    [
      el({ elementType: 'button', tag: 'button', accessibleName: null, attributes: {} }),
      el({
        elementType: 'button',
        tag: 'button',
        accessibleName: null,
        attributes: {},
        elementId: 'UI-0002',
      }),
    ],
    'SCREEN-001'
  );
  assert.equal(assigned.length, 2);
  assert.ok(assigned.every((row) => row.locator == null));
  assert.ok(assigned.every((row) => row.locatorStable === false));
  assert.ok(
    assigned.every((row) =>
      /no stable locator; fallback would be ambiguous/i.test(row.locatorReason ?? '')
    )
  );
  assert.ok(assigned.every((row) => !String(row.locator ?? '').includes('nth-child')));
});

test('class-only node does not produce a class selector', () => {
  const result = buildStableLocator({
    tag: 'div',
    attributes: { class: 'btn primary hero-cta' },
    accessibleName: null,
  });
  assert.equal(result.locator, null);
  assert.doesNotMatch(String(result.locator ?? ''), /\./);
  assert.doesNotMatch(JSON.stringify(result), /btn primary|hero-cta|\.btn/);
});

test('ELEMENT ids restart per screen — both screens can have ELEMENT-001', () => {
  const pageA = 'http://app.test/a';
  const pageB = 'http://app.test/b';
  const screens: DiscoveredScreen[] = [
    { id: 'SCREEN-001', url: pageA, state: 'default', source: 'direct-url' },
    { id: 'SCREEN-002', url: pageB, state: 'default', source: 'direct-url' },
  ];
  const ui = buildUiInventory(pageA, 2, [
    el({
      page: pageA,
      elementType: 'input',
      tag: 'input',
      inputType: 'email',
      accessibleName: 'Email',
      attributes: { name: 'email', type: 'email' },
    }),
    el({
      page: pageB,
      elementType: 'input',
      tag: 'input',
      inputType: 'text',
      accessibleName: 'Name',
      attributes: { name: 'name', type: 'text' },
      elementId: 'UI-0002',
    }),
  ]);
  const attached = attachElementsToScreens(ui, screens);
  const groupA = attached.screenElements?.find((g) => g.screenId === 'SCREEN-001');
  const groupB = attached.screenElements?.find((g) => g.screenId === 'SCREEN-002');
  assert.equal(groupA?.elements[0]?.elementId, 'ELEMENT-001');
  assert.equal(groupB?.elements[0]?.elementId, 'ELEMENT-001');
  assert.equal(formatElementId(1), 'ELEMENT-001');
});

test('decorative still inventoried with ELEMENT id but planning excludes as functional', () => {
  const page = 'http://app.test/deco';
  const screens: DiscoveredScreen[] = [
    { id: 'SCREEN-001', url: page, state: 'default', source: 'direct-url' },
  ];
  const ui = buildUiInventory(page, 1, [
    el({
      page,
      elementType: 'image',
      tag: 'span',
      accessibleName: 'star',
      attributes: { 'aria-hidden': 'true', class: 'icon-star' },
      interactive: false,
    }),
  ]);
  const attached = attachElementsToScreens(ui, screens);
  const row = attached.screenElements?.[0]?.elements[0];
  assert.equal(row?.elementId, 'ELEMENT-001');
  assert.equal(row?.elementKind, 'decorative');
  assert.equal(row?.type, 'decorative');
  assert.match(DECORATIVE_PLAN_REASON, /decorative element is not a functional control/i);
});

test('blocked action kinds include submit delete save reset upload', () => {
  assert.equal(isBlockedActionKind('submit-button'), true);
  assert.equal(isBlockedActionKind('delete-button'), true);
  assert.equal(isBlockedActionKind('save-button'), true);
  assert.equal(isBlockedActionKind('reset-button'), true);
  assert.equal(isBlockedActionKind('upload-button'), true);
  assert.equal(isBlockedActionKind('button'), false);
  assert.equal(isBlockedActionKind('link'), false);
});

test('decorative plan reason is stable', () => {
  assert.match(DECORATIVE_PLAN_REASON, /decorative element is not a functional control/i);
});

test('elementCategoryFromKind derives coarse category from detailed kind', () => {
  assert.equal(elementCategoryFromKind('email-input'), 'input');
  assert.equal(elementCategoryFromKind('password-input'), 'input');
  assert.equal(elementCategoryFromKind('date-input'), 'date-picker');
  assert.equal(elementCategoryFromKind('date-picker'), 'date-picker');
  assert.equal(elementCategoryFromKind('submit-button'), 'button');
  assert.equal(elementCategoryFromKind('delete-button'), 'button');
  assert.equal(elementCategoryFromKind('search-field'), 'search');
  assert.equal(elementCategoryFromKind('file-upload'), 'file-upload');
  assert.equal(elementCategoryFromKind('decorative'), 'other');
  assert.equal(elementCategoryFromKind('chart'), 'other');
  assert.equal(elementCategoryFromKind('nav-button', { tag: 'a', href: '/' }), 'link');
  assert.equal(elementCategoryFromKind('nav-button', { tag: 'button' }), 'button');
  assert.equal(elementCategoryFromKind('breadcrumb'), 'link');
  assert.equal(elementCategoryFromKind('dropdown'), 'menu');
  assert.equal(elementCategoryFromKind('dialog'), 'modal');
});

test('plannerActionsForKind: fillable observe+fill; submit blocked; decorative none', () => {
  assert.deepEqual(plannerActionsForKind('email-input'), ['observe', 'fill']);
  assert.deepEqual(plannerActionsForKind('submit-button'), ['observe', 'blocked']);
  assert.equal(plannerActionsForKind('submit-button').includes('submit'), false);
  assert.deepEqual(plannerActionsForKind('decorative'), ['none']);
});

test('element-kind.ts and ui-scan.ts have no demo hosts', () => {
  for (const rel of [
    'scripts/discovery/element-kind.ts',
    'scripts/discovery/ui-scan.ts',
    'scripts/discovery/collect-ui-dom.ts',
    'scripts/discovery/screens.ts',
    'scripts/planning/scenario-inventory.ts',
  ]) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /saucedemo|sauce\s*demo|swag\s*labs|jsonplaceholder/i);
  }
});
