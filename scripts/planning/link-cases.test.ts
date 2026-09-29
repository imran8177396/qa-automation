import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { ROOT } from '../lib/paths';
import { buildLinkSubcases, isLinkKindForPlanning } from './link-cases';
import { buildScenarioInventory } from './scenario-inventory';

function pageMap(pages: PageMap['pages'], seedUrl = 'https://example.test/'): PageMap {
  let scopeHost = 'example.test';
  try {
    scopeHost = new URL(seedUrl).host;
  } catch {
    /* keep default */
  }
  return {
    generatedAt: new Date().toISOString(),
    seedUrl,
    scopeHost,
    truncated: false,
    pages,
    routes: pages.map((page) => ({ path: page.route, url: page.url, title: page.title, source: 'crawl' })),
    navigation: [],
    skippedByScope: [],
    categoryStatus: [],
  };
}

function page(
  route: string,
  status = 200,
  overrides: Partial<PageMap['pages'][number]> = {}
): PageMap['pages'][number] {
  const url = overrides.url ?? `https://example.test${route}`;
  return {
    url,
    route,
    title: route,
    status,
    ok: status != null && status < 400,
    depth: 0,
    h1s: status != null && status < 400 ? ['Heading'] : [],
    applicableTestTypes: applicableTestTypes('pages'),
    ...overrides,
  };
}

function element(overrides: Partial<UiElementRecord>): UiElementRecord {
  return {
    page: 'https://example.test/',
    elementId: 'UI-LINK',
    elementType: 'link',
    elementKind: 'link',
    tag: 'a',
    locator: 'a[href]',
    locatorCandidates: ['a[href]'],
    accessibleName: 'Guide',
    visible: true,
    enabled: true,
    required: false,
    interactive: true,
    potentialAction: 'navigate',
    applicableTestTypes: applicableTestTypes('link'),
    discoveryStatus: 'DISCOVERED',
    evidence: 'anchor',
    ...overrides,
  };
}

function ui(elements: UiElementRecord[]): UiInventory {
  return {
    generatedAt: new Date().toISOString(),
    seedUrl: 'https://example.test/',
    pagesScanned: 1,
    elements,
    categoryStatus: [],
  };
}

const safety = resolveSafetyConfig();

function linkRows(checks: ReturnType<typeof buildScenarioInventory>, elementId: string) {
  return checks.filter(
    (c) =>
      c.targetElementId === elementId &&
      c.scenarioKind === 'link' &&
      typeof c.id === 'string' &&
      /link-/.test(c.id)
  );
}

function rowBySuffix(
  checks: ReturnType<typeof buildScenarioInventory>,
  elementId: string,
  suffix: string
) {
  return linkRows(checks, elementId).find((c) => typeof c.id === 'string' && c.id.endsWith(suffix));
}

test('href /docs/guide with page map 200 → destination, http status, deep link planned; external N/A', () => {
  const link = element({
    href: '/docs/guide',
    locator: 'a[href="/docs/guide"]',
  });
  const checks = buildScenarioInventory(
    pageMap([page('/'), page('/docs/guide', 200)]),
    ui([link]),
    safety
  );

  const dest = rowBySuffix(checks, 'UI-LINK', 'link-destination');
  assert.ok(dest);
  assert.equal(dest?.status, 'PLANNED');
  assert.equal(dest?.expect?.href, 'https://example.test/docs/guide');
  assert.equal(dest?.action, 'observe');

  const http = rowBySuffix(checks, 'UI-LINK', 'link-http-status');
  assert.ok(http);
  assert.equal(http?.status, 'PLANNED');
  assert.match(http?.reason ?? '', /HTTP 200 was recorded during discovery/);

  const deep = rowBySuffix(checks, 'UI-LINK', 'link-deep');
  assert.ok(deep);
  assert.equal(deep?.status, 'PLANNED');

  const external = rowBySuffix(checks, 'UI-LINK', 'link-external');
  assert.ok(external);
  assert.equal(external?.status, 'NOT_APPLICABLE');
  assert.match(external?.reason ?? '', /same-origin/);

  const broken = rowBySuffix(checks, 'UI-LINK', 'link-broken');
  assert.equal(broken, undefined);
});

test('href to page map 404 → broken link FAIL, not PASS', () => {
  const link = element({ href: '/missing', locator: 'a[href="/missing"]' });
  const checks = buildScenarioInventory(
    pageMap([page('/'), page('/missing', 404)]),
    ui([link]),
    safety
  );

  const broken = rowBySuffix(checks, 'UI-LINK', 'link-broken');
  assert.ok(broken);
  assert.equal(broken?.status, 'FAIL');
  assert.notEqual(broken?.status, 'PASS');
  assert.match(broken?.reason ?? '', /broken link: HTTP 404/);

  const http = rowBySuffix(checks, 'UI-LINK', 'link-http-status');
  assert.ok(http);
  assert.equal(http?.status, 'FAIL');
});

test('href to page map 500 → FAIL with 500', () => {
  const link = element({ href: '/boom', locator: 'a[href="/boom"]' });
  const checks = buildScenarioInventory(
    pageMap([page('/'), page('/boom', 500)]),
    ui([link]),
    safety
  );

  const http = rowBySuffix(checks, 'UI-LINK', 'link-http-status');
  assert.ok(http);
  assert.equal(http?.status, 'FAIL');
  assert.match(http?.reason ?? '', /HTTP 500 recorded during discovery/);

  const broken = rowBySuffix(checks, 'UI-LINK', 'link-broken');
  assert.equal(broken, undefined, '500 is http-status FAIL only, not a second broken row');
});

test('href not in page map → http status NOT_TESTED, not FAIL', () => {
  const link = element({ href: '/uncrawled', locator: 'a[href="/uncrawled"]' });
  const checks = buildScenarioInventory(pageMap([page('/')]), ui([link]), safety);

  const http = rowBySuffix(checks, 'UI-LINK', 'link-http-status');
  assert.ok(http);
  assert.equal(http?.status, 'NOT_TESTED');
  assert.notEqual(http?.status, 'FAIL');
  assert.notEqual(http?.status, 'PASS');
  assert.match(http?.reason ?? '', /HTTP response was not in the crawl/);

  const broken = rowBySuffix(checks, 'UI-LINK', 'link-broken');
  assert.equal(broken, undefined);
});

test('external host other.test → link-external planned; no request', () => {
  const link = element({
    href: 'https://other.test/x',
    locator: 'a[href="https://other.test/x"]',
  });
  const checks = buildScenarioInventory(pageMap([page('/')]), ui([link]), safety);

  const external = rowBySuffix(checks, 'UI-LINK', 'link-external');
  assert.ok(external);
  assert.equal(external?.status, 'PLANNED');
  assert.match(external?.reason ?? '', /other\.test/);

  const http = rowBySuffix(checks, 'UI-LINK', 'link-http-status');
  assert.equal(http?.status, 'NOT_TESTED');
});

test('target=_blank → new-tab planned observe', () => {
  const link = element({
    href: '/docs/guide',
    attributes: { target: '_blank' },
  });
  const checks = buildScenarioInventory(
    pageMap([page('/'), page('/docs/guide', 200)]),
    ui([link]),
    safety
  );

  const tab = rowBySuffix(checks, 'UI-LINK', 'link-new-tab');
  assert.ok(tab);
  assert.equal(tab?.status, 'PLANNED');
  assert.equal(tab?.action, 'observe');
  assert.match(tab?.reason ?? '', /target=_blank/);
});

test('?token=secret → query lists token, value [MASKED], raw secret absent', () => {
  const link = element({
    href: '/x?token=secret',
    locator: 'a[href*="token"]',
  });
  const checks = buildScenarioInventory(pageMap([page('/')]), ui([link]), safety);

  const query = rowBySuffix(checks, 'UI-LINK', 'link-query');
  assert.ok(query);
  assert.equal(query?.status, 'PLANNED');
  assert.match(query?.reason ?? '', /token/);
  assert.match(query?.expect?.note ?? '', /token=\[MASKED\]/);
  assert.match(query?.expect?.href ?? '', /token=\[MASKED\]/);

  const blob = JSON.stringify(query);
  assert.equal(blob.includes('secret'), false);
  assert.equal(blob.includes('token=secret'), false);
});

test('empty href → missing destination NOT_TESTED, no destination planned', () => {
  const link = element({ href: '', locator: 'a#empty' });
  const checks = buildScenarioInventory(pageMap([page('/')]), ui([link]), safety);

  const missing = rowBySuffix(checks, 'UI-LINK', 'link-missing-destination');
  assert.ok(missing);
  assert.equal(missing?.status, 'NOT_TESTED');
  assert.match(missing?.reason ?? '', /missing destination/);

  const dest = rowBySuffix(checks, 'UI-LINK', 'link-destination');
  assert.equal(dest, undefined);
});

test('javascript:alert(1) → BLOCKED; reason does not need payload', () => {
  const link = element({ href: 'javascript:alert(1)', locator: 'a#js' });
  const checks = buildScenarioInventory(pageMap([page('/')]), ui([link]), safety);

  const missing = rowBySuffix(checks, 'UI-LINK', 'link-missing-destination');
  assert.ok(missing);
  assert.equal(missing?.status, 'BLOCKED');
  assert.match(missing?.reason ?? '', /javascript href is not followed/i);

  const blob = JSON.stringify(missing);
  assert.equal(blob.includes('alert(1)'), false);

  const dest = rowBySuffix(checks, 'UI-LINK', 'link-destination');
  assert.equal(dest, undefined);
});

test('redirect only when finalUrl differs', () => {
  const withRedirect = element({
    elementId: 'UI-REDIR',
    href: '/old',
    locator: 'a[href="/old"]',
  });
  const checks = buildScenarioInventory(
    pageMap([
      page('/'),
      page('/old', 200, {
        finalUrl: 'https://example.test/new',
      }),
    ]),
    ui([withRedirect]),
    safety
  );
  const redirect = rowBySuffix(checks, 'UI-REDIR', 'link-redirect');
  assert.ok(redirect);
  assert.equal(redirect?.status, 'PLANNED');
  assert.match(redirect?.reason ?? '', /redirect recorded/);

  const same = element({
    elementId: 'UI-SAME',
    href: '/same',
    locator: 'a[href="/same"]',
  });
  const checksSame = buildScenarioInventory(
    pageMap([page('/'), page('/same', 200, { finalUrl: 'https://example.test/same' })]),
    ui([same]),
    safety
  );
  const noRedirect = rowBySuffix(checksSame, 'UI-SAME', 'link-redirect');
  assert.ok(noRedirect);
  assert.equal(noRedirect?.status, 'NOT_TESTED');
  assert.match(noRedirect?.reason ?? '', /no redirect recorded/);
});

test('redirect loop NOT_TESTED when no loop evidence', () => {
  const link = element({ href: '/docs/guide' });
  const checks = buildScenarioInventory(
    pageMap([page('/'), page('/docs/guide', 200)]),
    ui([link]),
    safety
  );
  const loop = rowBySuffix(checks, 'UI-LINK', 'link-redirect-loop');
  assert.ok(loop);
  assert.equal(loop?.status, 'NOT_TESTED');
  assert.match(loop?.reason ?? '', /redirect loop was not observed/);
});

test('buildLinkSubcases does not fetch and never emits PASS', () => {
  const result = buildLinkSubcases({
    element: element({ href: '/docs/guide' }),
    purpose: 'navigation-link',
    control: 'link',
    label: 'guide',
    locator: 'a[href="/docs/guide"]',
    pageUrl: 'https://example.test/',
    safety,
    pages: [page('/docs/guide', 200)],
  });
  assert.ok(result.plans.length > 0);
  assert.ok(result.plans.every((p) => p.status !== ('PASS' as typeof p.status)));
});

test('isLinkKindForPlanning covers link kinds; not decorative or plain buttons', () => {
  assert.equal(isLinkKindForPlanning(element({ elementKind: 'link' })), true);
  assert.equal(isLinkKindForPlanning(element({ elementKind: 'logo-link' })), true);
  assert.equal(isLinkKindForPlanning(element({ elementKind: 'breadcrumb' })), true);
  assert.equal(
    isLinkKindForPlanning(
      element({ elementKind: 'nav-button', tag: 'a', href: '/home', elementType: 'navigation' })
    ),
    true
  );
  assert.equal(isLinkKindForPlanning(element({ elementKind: 'decorative' })), false);
  assert.equal(
    isLinkKindForPlanning(
      element({
        elementKind: 'button',
        elementType: 'button',
        tag: 'button',
        href: undefined,
      })
    ),
    false
  );
});

test('button with href is not double-planned as link rows', () => {
  const btn = element({
    elementId: 'UI-BTN',
    elementType: 'button',
    elementKind: 'button',
    tag: 'button',
    href: '/docs/guide',
    locator: 'button#go',
  });
  const checks = buildScenarioInventory(
    pageMap([page('/'), page('/docs/guide', 200)]),
    ui([btn]),
    safety
  );
  assert.equal(linkRows(checks, 'UI-BTN').length, 0);
});

test('link-cases.ts has no demo product hosts or fetch', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'link-cases.ts'), 'utf8');
  assert.doesNotMatch(src, /saucedemo|sauce\s*demo|swag\s*labs|jsonplaceholder/i);
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /http\.get|https\.get|axios|got\(/);
  assert.doesNotMatch(src, /https?:\/\/[a-z0-9.-]*(sauce|swag|demo|jsonplaceholder)/i);
});

test('destructive query stays BLOCKED for navigation', () => {
  const link = element({
    href: '/item?action=delete',
    locator: 'a[href*="delete"]',
  });
  const checks = buildScenarioInventory(pageMap([page('/')]), ui([link]), safety);
  const nav = rowBySuffix(checks, 'UI-LINK', 'link-navigation');
  assert.ok(nav);
  assert.equal(nav?.status, 'BLOCKED');

  const dest = rowBySuffix(checks, 'UI-LINK', 'link-destination');
  assert.ok(dest);
  assert.equal(dest?.status, 'PLANNED');
});
