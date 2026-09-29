import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applicableTestTypes } from './test-types';
import type { PageMap } from './page-map';
import type { UiElementRecord, UiInventory } from './ui-scan';
import {
  buildAuthenticatedCoverage,
  buildScreenInventory,
  screenIdentityKey,
  toScreenInventories,
} from './screens';
import { buildScenarioInventory } from '../planning/scenario-inventory';
import { resolveSafetyConfig } from '../core/safety-policy';
import { ROOT } from '../lib/paths';

function assertNoDemoHosts(value: unknown): void {
  const blob = JSON.stringify(value).toLowerCase();
  assert.equal(/saucedemo|jsonplaceholder|swag\s*labs|inventory\.html/.test(blob), false);
}

function pageMap(pages: PageMap['pages'], extras: Partial<PageMap> = {}): PageMap {
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
    ...extras,
  };
}

function page(route: string, overrides: Partial<PageMap['pages'][number]> = {}): PageMap['pages'][number] {
  return {
    url: `http://app.test${route}`,
    finalUrl: `http://app.test${route}`,
    route,
    title: route,
    status: 200,
    ok: true,
    depth: route === '/' ? 0 : 1,
    h1s: ['Heading'],
    applicableTestTypes: applicableTestTypes('pages'),
    ...overrides,
  };
}

function element(overrides: Partial<UiElementRecord>): UiElementRecord {
  return {
    page: 'http://app.test/',
    elementId: 'UI-0001',
    elementType: 'button',
    locator: null,
    locatorCandidates: [],
    accessibleName: null,
    visible: true,
    enabled: true,
    required: false,
    interactive: true,
    potentialAction: 'observe',
    applicableTestTypes: applicableTestTypes('button'),
    discoveryStatus: 'DISCOVERED',
    evidence: 'fixture',
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

test('two pages and one dialog state yield SCREEN-001..003 in stable URL then state order', () => {
  const map = pageMap([page('/alpha'), page('/beta')]);
  const inventory = buildScreenInventory({
    pageMap: map,
    ui: ui([
      element({
        page: 'http://app.test/alpha',
        elementType: 'modal',
        evidence: 'dialog / role=dialog / aria-modal',
        attributes: { role: 'dialog' },
        accessibleName: 'Confirm',
      }),
    ]),
  });

  assert.equal(inventory.screens.length, 3);
  assert.deepEqual(
    inventory.screens.map((s) => s.id),
    ['SCREEN-001', 'SCREEN-002', 'SCREEN-003']
  );
  assert.equal(inventory.screens[0]?.url.includes('/alpha'), true);
  assert.equal(inventory.screens[0]?.state, 'default');
  assert.equal(inventory.screens[1]?.url.includes('/alpha'), true);
  assert.equal(inventory.screens[1]?.state, 'dialog');
  assert.equal(inventory.screens[2]?.url.includes('/beta'), true);
  assert.equal(inventory.screens[2]?.state, 'default');
  assertNoDemoHosts(inventory);
});

test('same URL + same state twice dedupes to one screen', () => {
  const map = pageMap([
    page('/same'),
    page('/same', { title: 'Duplicate crawl row' }),
  ]);
  // Two page rows with identical final URL collapse via identity key.
  const inventory = buildScreenInventory({ pageMap: map, ui: ui([]) });
  const defaults = inventory.screens.filter((s) => s.state === 'default' && s.url.includes('/same'));
  assert.equal(defaults.length, 1);
  assert.equal(inventory.screens[0]?.id, 'SCREEN-001');
  assertNoDemoHosts(inventory);
});

test('redirect requested !== final yields one screen at final with redirectFrom', () => {
  const map = pageMap([
    page('/old', {
      url: 'http://app.test/old',
      finalUrl: 'http://app.test/final',
      route: '/final',
      redirects: [{ from: 'http://app.test/old', to: 'http://app.test/final', status: 301 }],
    }),
  ]);
  const inventory = buildScreenInventory({ pageMap: map, ui: ui([]) });
  assert.equal(inventory.screens.length, 1);
  assert.equal(inventory.screens[0]?.url, 'http://app.test/final');
  assert.equal(inventory.screens[0]?.source, 'redirect');
  assert.equal(inventory.screens[0]?.redirectFrom, 'http://app.test/old');
  assert.equal(
    inventory.screens.some((s) => s.url === 'http://app.test/old' && s.state === 'default'),
    false
  );
  assertNoDemoHosts(inventory);
});

test('button with no href does not create a screen', () => {
  const map = pageMap([page('/')]);
  const inventory = buildScreenInventory({
    pageMap: map,
    ui: ui([
      element({
        elementType: 'button',
        accessibleName: 'Open',
        href: null,
        attributes: { role: 'button' },
      }),
    ]),
  });
  assert.equal(inventory.screens.length, 1);
  assert.equal(inventory.screens[0]?.state, 'default');
  assert.equal(inventory.screens[0]?.url, 'http://app.test/');
  assertNoDemoHosts(inventory);
});

test('no header region keeps navigation links and one unresolved header channel', () => {
  const map = pageMap([page('/'), page('/about', { depth: 1 })], {
    navigation: [
      {
        from: 'http://app.test/',
        to: 'http://app.test/about',
        linkText: 'About',
        inScope: true,
        applicableTestTypes: applicableTestTypes('navigation'),
        potentialAction: 'navigate',
      },
    ],
  });
  const inventory = buildScreenInventory({ pageMap: map, ui: ui([]) });
  assert.ok(inventory.screens.length >= 2);
  assert.ok(inventory.screens.every((s) => s.source !== 'header-navigation'));
  const headerGap = inventory.unresolvedChannels.find((c) => c.channel === 'header-navigation');
  assert.ok(headerGap);
  assert.equal(headerGap?.status, 'NOT_TESTED');
  assert.match(headerGap?.reason ?? '', /header\/sidebar\/footer region not present/);
  assert.equal(headerGap?.source, 'unobserved');
  assertNoDemoHosts(inventory);
});

test('no auth session yields authenticated-routes REQUIRES_CONFIGURATION without inventing /dashboard', () => {
  const map = pageMap([page('/')]);
  const inventory = buildScreenInventory({ pageMap: map, ui: ui([]), auth: null });
  const authGap = inventory.unresolvedChannels.find((c) => c.channel === 'authenticated-routes');
  assert.ok(authGap);
  assert.equal(authGap?.status, 'REQUIRES_CONFIGURATION');
  assert.match(authGap?.reason ?? '', /no session was established/);
  assert.equal(inventory.screens.some((s) => /dashboard/i.test(s.url)), false);
  assertNoDemoHosts(inventory);
});

test('no role session yields role-based-routes NOT_TESTED', () => {
  const inventory = buildScreenInventory({
    pageMap: pageMap([page('/')]),
    ui: ui([]),
    auth: { attempted: true, succeeded: true, reason: 'session ok' },
  });
  const roleGap = inventory.unresolvedChannels.find((c) => c.channel === 'role-based-routes');
  assert.ok(roleGap);
  assert.equal(roleGap?.status, 'NOT_TESTED');
  assert.match(roleGap?.reason ?? '', /role-based routes are not enumerated/);
  assert.equal(inventory.unresolvedChannels.some((c) => c.channel === 'authenticated-routes'), false);
  assertNoDemoHosts(inventory);
});

test('closed modal not in DOM yields unresolved modal channel and no invented modal screen', () => {
  const inventory = buildScreenInventory({
    pageMap: pageMap([page('/')]),
    ui: ui([]),
  });
  const modalGap = inventory.unresolvedChannels.find((c) => c.channel === 'modal');
  assert.ok(modalGap);
  assert.equal(modalGap?.status, 'NOT_TESTED');
  assert.match(modalGap?.reason ?? '', /closed modals\/drawers are not in the crawled DOM/);
  assert.equal(inventory.screens.some((s) => s.state === 'modal' || s.state === 'dialog'), false);
  assertNoDemoHosts(inventory);
});

test('screen ids are stable across two calls with the same input', () => {
  const map = pageMap([page('/a'), page('/b')]);
  const uiInv = ui([
    element({
      page: 'http://app.test/a',
      elementType: 'modal',
      evidence: 'dialog / role=dialog',
      attributes: { role: 'dialog' },
    }),
  ]);
  const first = buildScreenInventory({ pageMap: map, ui: uiInv });
  const second = buildScreenInventory({ pageMap: map, ui: uiInv });
  assert.deepEqual(
    first.screens.map((s) => ({ id: s.id, key: screenIdentityKey(s.url, s.state) })),
    second.screens.map((s) => ({ id: s.id, key: screenIdentityKey(s.url, s.state) }))
  );
  assertNoDemoHosts(first);
});

test('page-reached rows use screen ids and do not duplicate deduped screens', () => {
  const map = pageMap([page('/one'), page('/two')]);
  const uiInv = ui([
    element({
      page: 'http://app.test/one',
      elementType: 'modal',
      evidence: 'dialog / role=dialog',
      attributes: { role: 'dialog' },
    }),
  ]);
  const checks = buildScenarioInventory(map, uiInv, resolveSafetyConfig());
  const reached = checks.filter((c) => c.scenarioKind === 'page-reached');
  assert.equal(reached.length, 3);
  assert.deepEqual(
    reached.map((c) => c.screenId).sort(),
    ['SCREEN-001', 'SCREEN-002', 'SCREEN-003']
  );
  assert.ok(reached.every((c) => typeof c.screenId === 'string' && c.screenId.startsWith('SCREEN-')));
  assertNoDemoHosts(reached);
});

test('unresolvedChannels are never marked PASS and are not SCREEN-NNN rows', () => {
  const inventory = buildScreenInventory({ pageMap: pageMap([page('/')]), ui: ui([]) });
  assert.ok(inventory.unresolvedChannels.length > 0);
  for (const row of inventory.unresolvedChannels) {
    assert.equal(row.source, 'unobserved');
    assert.ok(
      row.status === 'NOT_TESTED' ||
        row.status === 'REQUIRES_CONFIGURATION' ||
        row.status === 'NOT_APPLICABLE'
    );
    assert.equal(/^SCREEN-\d+$/.test(row.channel), false);
  }
  assert.equal(JSON.stringify(inventory).includes('"PASS"'), false);
  assertNoDemoHosts(inventory);
});

test('/users default + modal-open evidence yields two screen ids, same URL, different state', () => {
  const map = pageMap([page('/users', { depth: 1 })]);
  const inventory = buildScreenInventory({
    pageMap: map,
    ui: ui([
      element({
        page: 'http://app.test/users',
        elementType: 'modal',
        evidence: 'dialog / role=dialog / aria-modal',
        attributes: { role: 'dialog' },
        accessibleName: 'Details',
      }),
    ]),
  });
  const users = inventory.screens.filter((s) => s.url.includes('/users'));
  assert.equal(users.length, 2);
  assert.equal(users[0]?.state, 'default');
  assert.equal(users[1]?.state, 'dialog');
  assert.notEqual(users[0]?.id, users[1]?.id);
  assert.equal(inventory.screens.some((s) => s.state === 'modal-open'), false);
  assertNoDemoHosts(inventory);
});

test('HTTP 401 yields permission-denied, not also error', () => {
  const inventory = buildScreenInventory({
    pageMap: pageMap([page('/users', { status: 401, ok: false, depth: 1 })]),
    ui: ui([]),
  });
  const users = inventory.screens.filter((s) => s.url.includes('/users'));
  assert.equal(users.length, 1);
  assert.equal(users[0]?.state, 'permission-denied');
  assert.equal(inventory.screens.some((s) => s.state === 'error'), false);
  assert.equal(inventory.screens.some((s) => s.state === 'default' && s.url.includes('/users')), false);
  assertNoDemoHosts(inventory);
});

test('HTTP 500 yields error screen', () => {
  const inventory = buildScreenInventory({
    pageMap: pageMap([page('/users', { status: 500, ok: false, depth: 1 })]),
    ui: ui([]),
  });
  const users = inventory.screens.filter((s) => s.url.includes('/users'));
  assert.equal(users.length, 1);
  assert.equal(users[0]?.state, 'error');
  assert.equal(inventory.screens.some((s) => s.state === 'permission-denied'), false);
  assertNoDemoHosts(inventory);
});

test('aria-invalid input yields validation-error screen for that URL', () => {
  const inventory = buildScreenInventory({
    pageMap: pageMap([page('/users', { depth: 1 })]),
    ui: ui([
      element({
        page: 'http://app.test/users',
        elementType: 'input',
        attributes: { 'aria-invalid': 'true', name: 'email' },
        accessibleName: 'Email',
      }),
    ]),
  });
  const users = inventory.screens.filter((s) => s.url.includes('/users'));
  assert.ok(users.some((s) => s.state === 'default'));
  assert.ok(users.some((s) => s.state === 'validation-error'));
  assert.equal(users.filter((s) => s.state === 'validation-error').length, 1);
  assertNoDemoHosts(inventory);
});

test('aria-busy or progressbar yields loading screen', () => {
  const busy = buildScreenInventory({
    pageMap: pageMap([page('/users', { depth: 1 })]),
    ui: ui([
      element({
        page: 'http://app.test/users',
        elementType: 'interactive',
        attributes: { 'aria-busy': 'true' },
      }),
    ]),
  });
  assert.ok(busy.screens.some((s) => s.url.includes('/users') && s.state === 'loading'));

  const bar = buildScreenInventory({
    pageMap: pageMap([page('/users', { depth: 1 })]),
    ui: ui([
      element({
        page: 'http://app.test/users',
        elementType: 'interactive',
        attributes: { role: 'progressbar' },
      }),
    ]),
  });
  assert.ok(bar.screens.some((s) => s.url.includes('/users') && s.state === 'loading'));
  assertNoDemoHosts(busy);
  assertNoDemoHosts(bar);
});

test('no empty marker yields no empty screen and unresolved empty channel', () => {
  const inventory = buildScreenInventory({
    pageMap: pageMap([page('/users', { depth: 1 })]),
    ui: ui([
      element({
        page: 'http://app.test/users',
        elementType: 'button',
        accessibleName: 'Refresh',
      }),
    ]),
  });
  assert.equal(inventory.screens.some((s) => s.state === 'empty'), false);
  const emptyGap = inventory.unresolvedChannels.find((c) => c.channel === 'empty');
  assert.ok(emptyGap);
  assert.equal(emptyGap?.status, 'NOT_TESTED');
  assert.match(emptyGap?.reason ?? '', /empty state was not present in scan evidence/);
  assert.notEqual(emptyGap?.status, 'PASS' as string);
  assertNoDemoHosts(inventory);
});

test('disabled button does not create a screen', () => {
  const inventory = buildScreenInventory({
    pageMap: pageMap([page('/users', { depth: 1 })]),
    ui: ui([
      element({
        page: 'http://app.test/users',
        elementType: 'button',
        enabled: false,
        accessibleName: 'Save',
        attributes: { role: 'button' },
      }),
    ]),
  });
  assert.equal(inventory.screens.filter((s) => s.url.includes('/users')).length, 1);
  assert.equal(inventory.screens[0]?.state, 'default');
  assert.equal(inventory.screens.some((s) => s.state === 'disabled'), false);
  const disabledGap = inventory.unresolvedChannels.find((c) => c.channel === 'disabled');
  assert.ok(disabledGap);
  assert.equal(disabledGap?.status, 'NOT_APPLICABLE');
  assert.match(disabledGap?.reason ?? '', /element property, not a screen state/);
  assertNoDemoHosts(inventory);
});

test('no auth session yields no authenticated screen and REQUIRES_CONFIGURATION', () => {
  const inventory = buildScreenInventory({
    pageMap: pageMap([page('/users', { depth: 1 }), page('/login', { depth: 1 })]),
    ui: ui([]),
    auth: null,
  });
  assert.equal(inventory.screens.some((s) => s.state === 'authenticated'), false);
  const authGap = inventory.unresolvedChannels.find((c) => c.channel === 'authenticated');
  assert.ok(authGap);
  assert.equal(authGap?.status, 'REQUIRES_CONFIGURATION');
  assert.match(authGap?.reason ?? '', /authenticated state requires a session/);
  assert.equal(inventory.screens.some((s) => /dashboard/i.test(s.url)), false);
  assertNoDemoHosts(inventory);
});

test('screen state ids are stable across two calls with the same /users input', () => {
  const map = pageMap([page('/users', { depth: 1 })]);
  const uiInv = ui([
    element({
      page: 'http://app.test/users',
      elementType: 'modal',
      evidence: 'dialog / role=dialog',
      attributes: { role: 'dialog' },
      accessibleName: 'Confirm delete',
    }),
    element({
      page: 'http://app.test/users',
      elementType: 'input',
      attributes: { 'aria-invalid': 'true' },
    }),
  ]);
  const first = buildScreenInventory({ pageMap: map, ui: uiInv });
  const second = buildScreenInventory({ pageMap: map, ui: uiInv });
  assert.deepEqual(
    first.screens.map((s) => ({ id: s.id, key: screenIdentityKey(s.url, s.state) })),
    second.screens.map((s) => ({ id: s.id, key: screenIdentityKey(s.url, s.state) }))
  );
  // Confirm/delete cue on open dialog marks confirmation observed.
  assert.equal(
    first.unresolvedChannels.some((c) => c.channel === 'confirmation' && c.status === 'NOT_TESTED'),
    false
  );
  assertNoDemoHosts(first);
});

test('page-reached planning emits one row per screen identity including non-default states', () => {
  const map = pageMap([page('/users', { depth: 1 })]);
  const uiInv = ui([
    element({
      page: 'http://app.test/users',
      elementType: 'modal',
      evidence: 'dialog / role=dialog',
      attributes: { role: 'dialog' },
    }),
  ]);
  const checks = buildScenarioInventory(map, uiInv, resolveSafetyConfig());
  const reached = checks.filter((c) => c.scenarioKind === 'page-reached' && c.targetUrl?.includes('/users'));
  assert.equal(reached.length, 2);
  const ids = new Set(reached.map((c) => c.screenId));
  assert.equal(ids.size, 2);
  assertNoDemoHosts(reached);
});

test('ScreenInventory: two states on /users yield two rows with siblingScreenIds', () => {
  const map = pageMap([page('/users', { title: 'Users', depth: 1 })]);
  const result = buildScreenInventory({
    pageMap: map,
    ui: ui([
      element({
        page: 'http://app.test/users',
        elementType: 'modal',
        evidence: 'dialog / role=dialog',
        attributes: { role: 'dialog' },
        accessibleName: 'Edit user',
      }),
      element({
        page: 'http://app.test/users',
        elementType: 'input',
        elementKind: 'email-input',
        tag: 'input',
        inputType: 'email',
        attributes: { name: 'email', type: 'email' },
        accessibleName: 'Email',
        locator: 'input[name="email"]',
      }),
    ]),
  });

  const usersRows = result.inventories.filter((row) => row.url.includes('/users'));
  assert.equal(usersRows.length, 2);
  const defaultRow = usersRows.find((row) => row.metadata?.state === 'default');
  const dialogRow = usersRows.find((row) => row.metadata?.state === 'dialog');
  assert.ok(defaultRow);
  assert.ok(dialogRow);
  assert.notEqual(defaultRow!.screenId, dialogRow!.screenId);
  assert.equal(defaultRow!.url, dialogRow!.url);
  assert.equal(defaultRow!.states?.length, 1);
  assert.equal(dialogRow!.states?.length, 1);
  assert.equal(defaultRow!.states?.[0]?.state, 'default');
  assert.equal(dialogRow!.states?.[0]?.state, 'dialog');
  assert.deepEqual(defaultRow!.metadata?.siblingScreenIds, [dialogRow!.screenId]);
  assert.deepEqual(dialogRow!.metadata?.siblingScreenIds, [defaultRow!.screenId]);
  assert.equal(defaultRow!.route, '/users');
  assert.equal(defaultRow!.title, 'Users');

  const email = defaultRow!.elements.find(
    (el) => el.locator === 'input[name="email"]' || el.type === 'email-input'
  );
  assert.ok(email, 'email element must appear on the default screen');
  assert.ok(email!.elementId);
  assert.match(email!.elementId, /^ELEMENT-\d{3}$/);
  assert.equal(email!.locator, 'input[name="email"]');

  assert.equal(
    result.inventories.some((row) => 'unresolvedChannels' in row),
    false
  );
  assert.ok(result.unresolvedChannels.length > 0);
  assertNoDemoHosts(result.inventories);
});

test('ScreenInventory: gated page sets authenticationRequired true without inventing roles', () => {
  const map = pageMap([
    page('/secret', {
      access: 'gated',
      gatedReason: 'login wall',
      depth: 1,
    }),
  ]);
  const result = buildScreenInventory({ pageMap: map, ui: ui([]) });
  const row = result.inventories.find((r) => r.url.includes('/secret'));
  assert.ok(row);
  assert.equal(row!.authenticationRequired, true);
  assert.equal(row!.metadata?.authenticationEvidence, 'gated');
  assert.equal(row!.roles, undefined);
  assertNoDemoHosts(result.inventories);
});

test('ScreenInventory: unknown access is false + authenticationEvidence unknown', () => {
  const map = pageMap([
    page('/mystery', {
      depth: 1,
      // access omitted — no public proof
    }),
  ]);
  // Strip the default access that page() does not set; ensure undefined.
  delete map.pages[0]!.access;
  const result = buildScreenInventory({ pageMap: map, ui: ui([]) });
  const row = result.inventories.find((r) => r.url.includes('/mystery'));
  assert.ok(row);
  assert.equal(row!.authenticationRequired, false);
  assert.equal(row!.metadata?.authenticationEvidence, 'unknown');
  assert.equal(row!.roles, undefined);
  assertNoDemoHosts(result.inventories);
});

test('ScreenInventory: navigation edge becomes WorkflowReference; no edge means empty workflows', () => {
  const withEdge = pageMap([page('/a'), page('/b', { depth: 1 })], {
    navigation: [
      {
        from: 'http://app.test/a',
        to: 'http://app.test/b',
        linkText: 'B',
        inScope: true,
        applicableTestTypes: applicableTestTypes('pages'),
        potentialAction: 'navigate',
      },
    ],
  });
  const withEdgeResult = buildScreenInventory({ pageMap: withEdge, ui: ui([]) });
  const aRow = withEdgeResult.inventories.find(
    (r) => r.url.includes('/a') && r.metadata?.state === 'default'
  );
  assert.ok(aRow);
  assert.equal(aRow!.workflows?.length, 1);
  assert.equal(aRow!.workflows?.[0]?.workflowId, 'WF-001');
  assert.equal(aRow!.workflows?.[0]?.fromScreenId, aRow!.screenId);
  assert.equal(aRow!.workflows?.[0]?.toUrl, 'http://app.test/b');
  assert.equal(aRow!.workflows?.[0]?.source, 'navigation-edge');

  const noEdge = buildScreenInventory({
    pageMap: pageMap([page('/')]),
    ui: ui([]),
  });
  const home = noEdge.inventories[0];
  assert.ok(home);
  assert.equal(home!.workflows?.length ?? 0, 0);
  // No invented multi-step or delete-confirmation workflow.
  assert.equal(
    noEdge.inventories.some((row) => (row.workflows ?? []).some((wf) => /delete|confirm/i.test(wf.workflowId))),
    false
  );
  assertNoDemoHosts(withEdgeResult.inventories);
  assertNoDemoHosts(noEdge.inventories);
});

test('ScreenInventory: decorative element has decorative true in metadata', () => {
  const map = pageMap([page('/')]);
  const result = buildScreenInventory({
    pageMap: map,
    ui: ui([
      element({
        page: 'http://app.test/',
        elementType: 'image',
        elementKind: 'decorative',
        type: 'decorative',
        tag: 'img',
        attributes: { alt: '' },
        accessibleName: null,
        interactive: false,
        evidence: 'decorative icon',
      }),
    ]),
  });
  const row = result.inventories.find((r) => r.metadata?.state === 'default');
  assert.ok(row);
  const decorative = row!.elements.find((el) => el.metadata?.decorative === true);
  assert.ok(decorative);
  assert.equal(decorative!.metadata?.decorative, true);
  assert.equal(decorative!.type, 'decorative');
  assert.equal(decorative!.category, 'other');
  assert.deepEqual(decorative!.actions, ['none']);
  assert.equal('decorative' in decorative!, false);
  assertNoDemoHosts(result.inventories);
});

test('TestableElement: email input publishes category input with fill/observe from evidence', () => {
  const map = pageMap([page('/')]);
  const result = buildScreenInventory({
    pageMap: map,
    ui: ui([
      element({
        page: 'http://app.test/',
        elementType: 'input',
        elementKind: 'email-input',
        type: 'email-input',
        tag: 'input',
        inputType: 'email',
        attributes: { name: 'email', type: 'email' },
        accessibleName: 'Email',
        required: true,
        enabled: true,
        locator: 'input[name="email"]',
      }),
    ]),
  });
  const row = result.inventories.find((r) => r.metadata?.state === 'default');
  assert.ok(row);
  const emailEls = row!.elements.filter((el) => el.type === 'email-input');
  assert.equal(emailEls.length, 1, 'must be a single published object, not a fork');
  const email = emailEls[0]!;
  assert.equal(email.category, 'input');
  assert.equal(email.type, 'email-input');
  assert.equal(email.screenId, row!.screenId);
  assert.equal(email.locator, 'input[name="email"]');
  assert.equal(email.label, 'Email');
  assert.equal(email.accessibleName, 'Email');
  assert.equal(email.required, true);
  assert.equal(email.disabled, undefined);
  assert.ok(email.validation?.some((rule) => rule.kind === 'required'));
  assert.ok(email.actions?.includes('fill'));
  assert.ok(email.actions?.includes('observe'));
  assert.equal(email.actions?.includes('submit'), false);
  assert.equal(email.metadata?.elementKind, 'email-input');
  assert.equal(email.metadata?.decorative, false);
  assertNoDemoHosts(result.inventories);
});

test('TestableElement: submit button category button with blocked, not executable submit', () => {
  const map = pageMap([page('/')]);
  const result = buildScreenInventory({
    pageMap: map,
    ui: ui([
      element({
        page: 'http://app.test/',
        elementType: 'button',
        elementKind: 'submit-button',
        type: 'submit-button',
        tag: 'button',
        inputType: 'submit',
        isSubmit: true,
        accessibleName: 'Sign in',
        attributes: { type: 'submit' },
      }),
    ]),
  });
  const row = result.inventories.find((r) => r.metadata?.state === 'default');
  assert.ok(row);
  const submit = row!.elements.find((el) => el.type === 'submit-button');
  assert.ok(submit);
  assert.equal(submit!.category, 'button');
  assert.ok(submit!.actions?.includes('blocked'));
  assert.ok(submit!.actions?.includes('observe'));
  assert.equal(submit!.actions?.includes('submit'), false);
  assert.equal(submit!.actions?.includes('click'), false);
  assertNoDemoHosts(result.inventories);
});

test('TestableElement: unknown required attribute omits required (not false)', () => {
  const map = pageMap([page('/')]);
  const raw = element({
    page: 'http://app.test/',
    elementType: 'input',
    elementKind: 'text-input',
    type: 'text-input',
    tag: 'input',
    inputType: 'text',
    attributes: { name: 'note' },
    accessibleName: 'Note',
  });
  delete (raw as { required?: boolean }).required;

  const result = buildScreenInventory({
    pageMap: map,
    ui: ui([raw]),
  });
  const row = result.inventories.find((r) => r.metadata?.state === 'default');
  assert.ok(row);
  const note = row!.elements.find((el) => el.type === 'text-input');
  assert.ok(note);
  assert.equal('required' in note!, false);
  assert.equal(note!.required, undefined);
  assert.equal(note!.validation?.some((rule) => rule.kind === 'required') ?? false, false);
  assertNoDemoHosts(result.inventories);
});

test('exactly one exported TestableElement interface in the repo', () => {
  const roots = [
    path.join(ROOT, 'scripts'),
    path.join(ROOT, 'pages'),
    path.join(ROOT, 'tests'),
    path.join(ROOT, 'utils'),
  ];
  const matches: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (/export\s+interface\s+TestableElement\b/.test(text)) {
        matches.push(path.relative(ROOT, full).replace(/\\/g, '/'));
      }
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(matches, ['scripts/discovery/screens.ts']);
});

test('toScreenInventories keeps unresolved channels outside screen rows', () => {
  const map = pageMap([page('/')]);
  const built = buildScreenInventory({ pageMap: map, ui: ui([]) });
  const again = toScreenInventories({
    screens: built.screens,
    pageMap: map,
    ui: ui([]),
    auth: null,
  });
  assert.equal(again.length, built.screens.length);
  for (const row of again) {
    assert.equal('unresolvedChannels' in row, false);
    assert.ok(row.screenId.startsWith('SCREEN-'));
  }
  assert.ok(built.unresolvedChannels.length > 0);
  assertNoDemoHosts(again);
});

test('authenticated coverage: public + login screens, REQUIRES_CONFIGURATION gates when no session', () => {
  const map = pageMap([
    page('/', { access: 'public', depth: 0 }),
    page('/signin', { access: 'gated', gatedReason: 'login wall', depth: 1 }),
  ]);
  const result = buildScreenInventory({ pageMap: map, ui: ui([]) });
  const coverage = result.authenticatedCoverage;

  assert.ok(coverage.publicScreenIds.length >= 1);
  const loginLayer = coverage.layers.find((l) => l.gate === 'login');
  assert.ok(loginLayer);
  assert.equal(loginLayer!.status, 'DISCOVERED');
  assert.ok(loginLayer!.screenIds.length >= 1);

  for (const id of coverage.publicScreenIds) {
    const screen = result.screens.find((s) => s.id === id);
    assert.ok(screen);
    assert.equal(/admin|super/i.test(screen!.url), false);
  }
  for (const id of loginLayer!.screenIds) {
    const screen = result.screens.find((s) => s.id === id);
    assert.ok(screen);
    assert.match(screen!.url, /signin/i);
  }

  assert.deepEqual(
    coverage.layers.slice(0, 2).map((l) => l.gate),
    ['public', 'login']
  );
  assert.equal(coverage.layers.some((l) => l.key === 'admin' || l.key === 'Admin'), false);

  const unresolved = coverage.layers.filter((l) =>
    ['feature-flag', 'organization', 'permission', 'role', 'subscription', 'tenant'].includes(l.gate)
  );
  assert.equal(unresolved.length, 6);
  for (const gate of unresolved) {
    assert.equal(gate.status, 'REQUIRES_CONFIGURATION');
    assert.deepEqual(gate.screenIds, []);
  }
  assert.equal(result.screens.some((s) => /admin|super/i.test(s.url)), false);
  assertNoDemoHosts(result);
});

test('authenticated coverage: supplied roles without page role metadata stay NOT_TESTED', () => {
  const map = pageMap([
    page('/', { access: 'public', depth: 0 }),
    page('/signin', { access: 'gated', gatedReason: 'login wall', depth: 1 }),
    page('/app', { access: 'authenticated', depth: 1 }),
  ]);
  const result = buildScreenInventory({
    pageMap: map,
    ui: ui([]),
    session: { established: true, roles: ['user', 'admin'] },
  });
  const coverage = result.authenticatedCoverage;
  const userLayer = coverage.layers.find((l) => l.gate === 'role' && l.key === 'user');
  const adminLayer = coverage.layers.find((l) => l.gate === 'role' && l.key === 'admin');
  assert.ok(userLayer);
  assert.ok(adminLayer);
  assert.equal(userLayer!.status, 'NOT_TESTED');
  assert.equal(adminLayer!.status, 'NOT_TESTED');
  assert.deepEqual(userLayer!.screenIds, []);
  assert.deepEqual(adminLayer!.screenIds, []);
  assert.match(userLayer!.reason ?? '', /active role was not recorded/);
  assert.equal(coverage.layers.some((l) => l.key === 'super-admin'), false);
  assert.equal(result.screens.some((s) => /admin|super/i.test(s.url)), false);
  assert.equal(JSON.stringify(coverage).toLowerCase().includes('/dashboard'), false);
  assertNoDemoHosts(result);
});

test('authenticated coverage: page metadata.role attributes screens only to that role', () => {
  const map = pageMap([
    page('/', { access: 'public', depth: 0 }),
    page('/signin', { access: 'gated', gatedReason: 'login wall', depth: 1 }),
    page('/app', {
      access: 'authenticated',
      depth: 1,
      metadata: { role: 'user' },
    }),
  ]);
  const result = buildScreenInventory({
    pageMap: map,
    ui: ui([]),
    session: { established: true, roles: ['user', 'admin'] },
  });
  const coverage = result.authenticatedCoverage;
  const userLayer = coverage.layers.find((l) => l.gate === 'role' && l.key === 'user');
  const adminLayer = coverage.layers.find((l) => l.gate === 'role' && l.key === 'admin');
  assert.ok(userLayer);
  assert.ok(adminLayer);
  assert.equal(userLayer!.status, 'DISCOVERED');
  assert.ok(userLayer!.screenIds.length >= 1);
  const userScreens = userLayer!.screenIds.map((id) => result.screens.find((s) => s.id === id)!);
  assert.ok(userScreens.every((s) => s.url.includes('/app')));
  assert.deepEqual(adminLayer!.screenIds, []);
  assert.equal(adminLayer!.status, 'NOT_TESTED');
  assert.equal(result.screens.some((s) => /super/i.test(s.url)), false);
  assertNoDemoHosts(result);
});

test('authenticated coverage: roles are not defaulted to admin', () => {
  const map = pageMap([page('/', { access: 'public' })]);
  const result = buildScreenInventory({
    pageMap: map,
    ui: ui([]),
    auth: { attempted: true, succeeded: true, reason: 'session ok' },
  });
  assert.equal(
    result.authenticatedCoverage.layers.some((l) => l.key === 'admin' || l.key === 'super-admin'),
    false
  );
  for (const row of result.inventories) {
    assert.equal(row.roles, undefined);
  }
  const standalone = buildAuthenticatedCoverage({
    screens: result.screens.map((s) => ({
      id: s.id,
      url: s.url,
      state: s.state,
      authenticationEvidence: 'public',
    })),
    pages: map.pages.map((p) => ({
      url: p.finalUrl ?? p.url,
      access: p.access,
      status: p.status ?? undefined,
      metadata: p.metadata,
    })),
    session: { established: true, roles: ['user'] },
  });
  assert.ok(standalone.layers.some((l) => l.gate === 'role' && l.key === 'user'));
  assert.equal(standalone.layers.some((l) => l.key === 'admin'), false);
  assertNoDemoHosts(result);
});

test('ScreenInventory source has no demo hosts', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'discovery', 'screens.ts'), 'utf8');
  assert.doesNotMatch(src, /saucedemo|jsonplaceholder|swag\s*labs/i);
});
