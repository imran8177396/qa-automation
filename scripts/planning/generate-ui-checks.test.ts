import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateUiChecks } from './generate-ui-checks';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';

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
    page: 'http://app.test/contact.html',
    elementId: 'UI-0001',
    elementType: 'input',
    locator: '#email',
    locatorCandidates: ['#email'],
    accessibleName: 'email',
    visible: true,
    enabled: true,
    required: true,
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

test('generateUiChecks() never plans a form submit or submit-button click', () => {
  const checks = generateUiChecks(
    pageMap([page('/contact.html')]),
    ui([
      element({
        elementId: 'UI-0002',
        elementType: 'button',
        locator: 'text=Send',
        accessibleName: 'Send',
        isSubmit: true,
        formMethod: 'post',
      }),
      element({ elementId: 'UI-0003', elementType: 'form', locator: null, accessibleName: 'form', interactive: false }),
    ]),
    safety
  );

  const plannedClicks = checks.filter((c) => c.status === 'PLANNED' && (c.kind === 'click-button' || c.kind === 'form-submit'));
  assert.equal(plannedClicks.length, 0);
  assert.ok(checks.some((c) => c.kind === 'form-submit' && c.status === 'BLOCKED'));
  assert.ok(checks.some((c) => c.status === 'BLOCKED' && /empty submission/i.test(c.title)));
  assert.ok(checks.some((c) => c.status === 'BLOCKED' && /duplicate-click/i.test(c.title)));
});

test('generateUiChecks() does not authorize GET/click on a destructive query-string link', () => {
  const checks = generateUiChecks(
    pageMap([page('/danger.html')]),
    ui([
      element({
        page: 'http://app.test/danger.html',
        elementType: 'link',
        locator: 'text=Remove item via link',
        accessibleName: 'Remove item via link',
        href: '/delete-account?action=delete&id=42',
        evidence: '<a href>',
      }),
    ]),
    safety
  );

  const planned = checks.filter(
    (c) => c.status === 'PLANNED' && (c.kind === 'click-link' || c.kind === 'broken-link') && c.expect?.href
  );
  assert.equal(planned.length, 0);
  assert.ok(checks.some((c) => c.status === 'NOT_TESTED' && /state-changing/i.test(c.reason ?? '')));
});

test('generateUiChecks() asserts HTML5 constraint invalid only for typed fields, not free-text', () => {
  const checks = generateUiChecks(
    pageMap([page('/contact.html')]),
    ui([
      element({ elementId: 'UI-0018', locator: '#email', accessibleName: 'email', evidence: 'text-like input' }),
      element({
        elementId: 'UI-0017',
        locator: '#name',
        accessibleName: 'name',
        evidence: 'text-like input',
        required: true,
      }),
    ]),
    safety
  );

  assert.ok(checks.some((c) => c.kind === 'invalid-input' && c.expect?.locator === '#email' && c.status === 'PLANNED'));
  assert.ok(checks.some((c) => c.kind === 'invalid-input' && c.expect?.locator === '#email' && c.expect?.constraintInvalid === true));
  assert.ok(checks.some((c) => c.kind === 'invalid-input' && c.expect?.locator === '#name' && c.status === 'PLANNED'));
  assert.ok(checks.some((c) => c.kind === 'invalid-input' && c.expect?.locator === '#name' && c.expect?.constraintInvalid !== true));
  assert.ok(checks.some((c) => c.kind === 'valid-input' && c.expect?.locator === '#name' && c.status === 'PLANNED'));
});

test('generateUiChecks() plans broken-link for a discovered 404, not a successful page-load', () => {
  const checks = generateUiChecks(pageMap([page('/missing-page.html', 404)]), ui([]), safety);
  assert.ok(checks.some((c) => c.kind === 'broken-link' && c.status === 'PLANNED'));
  assert.ok(!checks.some((c) => c.kind === 'page-sanity' && c.status === 'PLANNED'));
});

test('generateUiChecks() plans a safe in-scope link click', () => {
  const checks = generateUiChecks(
    pageMap([page('/index.html')]),
    ui([
      element({
        page: 'http://app.test/index.html',
        elementType: 'link',
        locator: 'text=Contact',
        accessibleName: 'Contact',
        href: '/contact.html',
        required: false,
        evidence: '<a href>',
      }),
    ]),
    safety
  );

  assert.ok(checks.some((c) => c.kind === 'click-link' && c.status === 'PLANNED' && c.expect?.href === '/contact.html'));
  assert.ok(checks.some((c) => c.kind === 'link-href' && c.status === 'PLANNED'));
});

test('generateUiChecks() does not require an H1 when discovery observed none', () => {
  const bare = page('/login.html');
  bare.h1s = [];
  bare.headings = [{ level: 'h4', text: 'Accepted usernames are:' }];
  const checks = generateUiChecks(pageMap([bare]), ui([]), safety);
  const sanity = checks.find((c) => c.kind === 'page-sanity' && c.status === 'PLANNED');
  assert.ok(sanity);
  assert.equal(sanity?.expect?.requireH1, false);
  assert.equal(sanity?.expect?.requireHeading, true);
});

test('generateUiChecks() plans password fill-without-submit using a synthetic sample, not credentials', () => {
  const checks = generateUiChecks(
    pageMap([page('/contact.html')]),
    ui([
      element({
        elementId: 'UI-0003',
        locator: '[data-test="password"]',
        accessibleName: 'Password',
        evidence: 'text-like input (type=password)',
        required: false,
      }),
    ]),
    safety
  );

  const valid = checks.find((c) => c.kind === 'valid-input' && c.status === 'PLANNED');
  assert.ok(valid);
  assert.equal(valid?.expect?.fillValue, 'SamplePass_qa');
  assert.ok(!checks.some((c) => c.kind === 'valid-input' && c.status === 'REQUIRES_CONFIGURATION'));
  assert.ok(checks.some((c) => c.kind === 'validation-state' && c.status === 'BLOCKED'));
  assert.ok(checks.some((c) => c.kind === 'boundary-values' && c.status === 'NOT_TESTED'));
});

test('generateUiChecks() does not invent link or dropdown checks when none were discovered', () => {
  const checks = generateUiChecks(
    pageMap([page('/')]),
    ui([
      element({
        page: 'http://app.test/',
        elementId: 'UI-0001',
        elementType: 'button',
        locator: '[data-test="login-button"]',
        accessibleName: 'Login',
        isSubmit: true,
      }),
      element({
        page: 'http://app.test/',
        elementId: 'UI-0002',
        locator: '[data-test="username"]',
        accessibleName: 'Username',
        evidence: 'text-like input',
      }),
    ]),
    safety
  );

  assert.equal(checks.filter((c) => c.kind === 'click-link' || c.kind === 'link-href').length, 0);
  assert.equal(checks.filter((c) => c.kind === 'select-options' || c.kind === 'select-change').length, 0);
  assert.ok(checks.every((c) => c.kind !== 'toggle-state'));
});

test('generateUiChecks() records unmapped element types as NOT_TESTED instead of omitting them', () => {
  const checks = generateUiChecks(
    pageMap([page('/contact.html')]),
    ui([
      element({
        elementId: 'UI-0099',
        elementType: 'interactive',
        locator: '[data-qa="widget"]',
        accessibleName: 'widget',
      }),
    ]),
    safety
  );

  assert.ok(
    checks.some(
      (c) =>
        c.status === 'NOT_TESTED' &&
        c.targetElementId === 'UI-0099' &&
        (c.reason ?? '').includes('no mapped inventory kind')
    )
  );
});
