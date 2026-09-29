import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { ROOT } from '../lib/paths';
import { buildScenarioInventory, classifyElementPurpose, isSecurityRelevantElement } from './scenario-inventory';
import { applicableCategories, formatExcludedCategories } from './applicability';
import { parsePlannedChecks, type PlannedCheck } from './types';
import { generateUiChecks } from './generate-ui-checks';
import { classifyElementKind } from '../discovery/element-kind';

function pageMap(pages: PageMap['pages'], navigation: PageMap['navigation'] = []): PageMap {
  return {
    generatedAt: new Date().toISOString(),
    seedUrl: 'http://app.test/',
    scopeHost: 'app.test',
    truncated: false,
    pages,
    routes: pages.map((page) => ({ path: page.route, url: page.url, title: page.title, source: 'crawl' })),
    navigation,
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

test('fixture page emits positive/negative/edge/validation/security/a11y/workflow; submit is BLOCKED', () => {
  const pages = [page('/form.html'), page('/next.html')];
  const nav: PageMap['navigation'] = [
    {
      from: 'http://app.test/form.html',
      to: 'http://app.test/next.html',
      linkText: 'Next',
      inScope: true,
      applicableTestTypes: applicableTestTypes('navigation'),
      potentialAction: 'navigate',
    },
  ];
  const elements = [
    element({
      elementId: 'UI-TEXT',
      locator: '#name',
      accessibleName: 'Name',
      required: true,
      maxLength: '32',
      evidence: 'text-like input maxlength=32',
    }),
    element({
      elementId: 'UI-LINK',
      elementType: 'link',
      locator: 'text=Next',
      accessibleName: 'Next',
      href: '/next.html',
      required: false,
      evidence: '<a href>',
    }),
    element({
      elementId: 'UI-SUBMIT',
      elementType: 'button',
      locator: 'text=Submit',
      accessibleName: 'Submit',
      isSubmit: true,
      formMethod: 'post',
      required: false,
      evidence: 'submit button',
    }),
    element({
      elementId: 'UI-PASS',
      locator: '#password',
      accessibleName: 'Password',
      inputType: 'password',
      evidence: 'text-like input (type=password)',
      required: false,
    }),
  ];

  const checks = buildScenarioInventory(pageMap(pages, nav), ui(elements), safety);

  const forText = checks.filter((c) => c.targetElementId === 'UI-TEXT');
  assert.ok(forText.some((c) => c.scenarioKind === 'positive' && c.status === 'PLANNED'));
  assert.ok(forText.some((c) => c.scenarioKind === 'negative' && c.status === 'PLANNED'));
  assert.ok(forText.some((c) => c.scenarioKind === 'edge' && c.category === 'boundary' && c.status === 'PLANNED'));
  assert.ok(forText.some((c) => c.scenarioKind === 'validation' && c.status === 'PLANNED'));
  assert.ok(
    forText.some(
      (c) =>
        c.status === 'NOT_APPLICABLE' &&
        /excluded:/.test(c.reason ?? '') &&
        /security \(security scenarios do not apply/i.test(c.reason ?? '')
    )
  );
  assert.ok(forText.some((c) => c.scenarioKind === 'accessibility' && c.status === 'PLANNED'));
  assert.ok(forText.some((c) => c.scenarioKind === 'usability' && c.status === 'PLANNED'));

  const forPass = checks.filter((c) => c.targetElementId === 'UI-PASS');
  assert.ok(forPass.some((c) => c.scenarioKind === 'security' && c.status === 'PLANNED' && c.kind === 'security-observation'));

  assert.ok(checks.some((c) => c.scenarioKind === 'workflow' && c.status === 'PLANNED'));

  const submitRows = checks.filter((c) => c.targetElementId === 'UI-SUBMIT');
  assert.ok(submitRows.some((c) => c.status === 'BLOCKED' && /submit/i.test(c.reason ?? '')));
  assert.ok(submitRows.every((c) => c.action !== ('submit' as never)));
  assert.ok(
    submitRows
      .filter((c) => c.status === 'PLANNED')
      .every((c) => c.action === 'observe' || c.action === 'none' || c.kind === 'visibility')
  );

  assert.ok(
    checks
      .filter((c) => c.status === 'PLANNED')
      .every((c) => c.kind !== 'form-submit' && c.action !== ('submit' as never))
  );
});

test('element without min/max/maxlength still applies edge analysis — no fabricated min/max values', () => {
  const checks = buildScenarioInventory(
    pageMap([page('/form.html')]),
    ui([
      element({
        elementId: 'UI-OPEN',
        locator: '#open',
        accessibleName: 'Open field',
        required: false,
        evidence: 'text-like input',
      }),
    ]),
    safety
  );

  const edges = checks.filter(
    (c) =>
      c.targetElementId === 'UI-OPEN' &&
      c.scenarioKind === 'edge' &&
      typeof c.id === 'string' &&
      /edge-min$|edge-max$|edge-min-minus|edge-max-plus/.test(c.id)
  );
  assert.equal(edges.length, 0, 'no fabricated min/max edge rows when no constraint');
  const exclusion = checks.find(
    (c) => c.targetElementId === 'UI-OPEN' && c.status === 'NOT_APPLICABLE' && /excluded:/.test(c.reason ?? '')
  );
  assert.ok(exclusion);
  assert.match(exclusion?.reason ?? '', /edge-min \(no minimum constraint discovered\)/i);
  assert.match(exclusion?.reason ?? '', /edge-max \(no maximum constraint discovered\)/i);
  assert.ok(
    checks.some(
      (c) => c.targetElementId === 'UI-OPEN' && c.scenarioKind === 'edge' && c.status === 'PLANNED'
    ),
    'format-sensitive edges (whitespace/unicode/etc.) may still be planned'
  );
});

test('page with zero interactive elements still has a page-reached screen row', () => {
  const checks = buildScenarioInventory(pageMap([page('/empty.html')]), ui([]), safety);
  assert.ok(checks.some((c) => c.scenarioKind === 'page-reached' && c.targetUrl === 'http://app.test/empty.html'));
  assert.ok(checks.some((c) => c.scenarioKind === 'workflow' && c.status === 'NOT_TESTED'));
});

test('unknown purpose stays NOT_TESTED and never PLANNED/PASS', () => {
  const checks = buildScenarioInventory(
    pageMap([page('/form.html')]),
    ui([
      element({
        elementId: 'UI-UNK',
        elementType: 'interactive',
        locator: '[data-qa="widget"]',
        accessibleName: 'widget',
        evidence: 'unknown widget',
      }),
    ]),
    safety
  );

  const rows = checks.filter((c) => c.targetElementId === 'UI-UNK');
  assert.ok(rows.length > 0);
  assert.ok(rows.every((c) => c.purpose === 'unknown'));
  assert.ok(rows.every((c) => c.status === 'NOT_TESTED'));
  assert.ok(rows.every((c) => /purpose not determined/i.test(c.reason ?? '')));
  assert.equal(rows.filter((c) => c.status === 'PLANNED').length, 0);
});

test('no PLANNED row has submit action or state-changing click marked executable', () => {
  const checks = buildScenarioInventory(
    pageMap([page('/form.html')]),
    ui([
      element({
        elementId: 'UI-SUB',
        elementType: 'button',
        locator: 'text=Save',
        accessibleName: 'Save',
        isSubmit: true,
        formMethod: 'post',
      }),
      element({
        elementId: 'UI-DEL',
        elementType: 'link',
        locator: 'text=Delete',
        accessibleName: 'Delete',
        href: '/x?action=delete',
        evidence: '<a href>',
      }),
    ]),
    safety
  );

  for (const check of checks.filter((c) => c.status === 'PLANNED')) {
    assert.notEqual(check.kind, 'form-submit');
    assert.notEqual(String(check.action), 'submit');
    if (check.kind === 'click-button' || check.kind === 'click-link') {
      assert.ok(
        check.targetElementId !== 'UI-SUB' && check.targetElementId !== 'UI-DEL',
        `unexpected executable click for ${check.id}`
      );
    }
  }
  assert.ok(checks.some((c) => c.status === 'BLOCKED' && c.targetElementId === 'UI-SUB'));
});

test('legacy planned-check fixtures still parse without scenarioKind', () => {
  const legacy: PlannedCheck[] = [
    {
      id: 'CHK-0001',
      kind: 'page-sanity',
      title: 'http://app.test/ should load',
      targetUrl: 'http://app.test/',
      status: 'PLANNED',
      expect: { requireH1: true },
    },
    {
      id: 'CHK-0002',
      kind: 'visibility',
      title: 'field visible',
      targetUrl: 'http://app.test/',
      status: 'NOT_TESTED',
      reason: 'NOT_TESTED: demo',
    },
  ];
  const parsed = parsePlannedChecks(legacy);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.scenarioKind, undefined);
  assert.equal(parsed[0]?.kind, 'page-sanity');
  assert.equal(parsed[1]?.status, 'NOT_TESTED');
});

test('scenario-inventory.ts has no hard-coded demo host or sauce/swag labels', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'scenario-inventory.ts'), 'utf8');
  assert.doesNotMatch(src, /saucedemo|sauce\s*demo|swag\s*labs|jsonplaceholder/i);
  assert.doesNotMatch(src, /https?:\/\/[a-z0-9.-]*(sauce|swag|demo|jsonplaceholder)/i);
  const applicability = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'applicability.ts'), 'utf8');
  assert.doesNotMatch(applicability, /saucedemo|sauce\s*demo|swag\s*labs|jsonplaceholder/i);
  assert.doesNotMatch(applicability, /https?:\/\/[a-z0-9.-]*(sauce|swag|demo|jsonplaceholder)/i);
});

test('classifyElementPurpose is evidence-only; password and link map correctly', () => {
  assert.equal(
    classifyElementPurpose(
      element({ inputType: 'password', evidence: 'type=password', accessibleName: 'Password' })
    ),
    'password-input'
  );
  assert.equal(
    classifyElementPurpose(element({ elementType: 'link', href: '/a', evidence: '<a href>' })),
    'navigation-link'
  );
  assert.equal(classifyElementPurpose(element({ elementType: 'interactive', evidence: 'widget' })), 'unknown');
  assert.equal(
    isSecurityRelevantElement(element({ inputType: 'password', evidence: 'type=password' })),
    true
  );
  assert.equal(isSecurityRelevantElement(element({ accessibleName: 'Name', evidence: 'text' })), false);
});

test('fixture screen inventories email/password/submit/nav/table/decorative/delete; no invented file-upload', () => {
  const pageUrl = 'http://app.test/login.html';
  const screens = [
    {
      id: 'SCREEN-001',
      url: pageUrl,
      state: 'default',
      source: 'direct-url' as const,
    },
  ];
  const elements = [
    element({
      page: pageUrl,
      elementId: 'UI-EMAIL',
      elementType: 'input',
      tag: 'input',
      inputType: 'email',
      locator: '#email',
      accessibleName: 'Email',
      evidence: 'text-like input',
      screenId: 'SCREEN-001',
    }),
    element({
      page: pageUrl,
      elementId: 'UI-PASS',
      elementType: 'input',
      tag: 'input',
      inputType: 'password',
      locator: '#password',
      accessibleName: 'Password',
      evidence: 'text-like input (type=password)',
      screenId: 'SCREEN-001',
    }),
    element({
      page: pageUrl,
      elementId: 'UI-SUBMIT',
      elementType: 'button',
      tag: 'button',
      inputType: 'submit',
      isSubmit: true,
      formMethod: 'post',
      locator: 'text=Sign in',
      accessibleName: 'Sign in',
      evidence: 'submit button',
      screenId: 'SCREEN-001',
    }),
    element({
      page: pageUrl,
      elementId: 'UI-NAV',
      elementType: 'link',
      tag: 'a',
      href: '/home',
      locator: 'text=Home',
      accessibleName: 'Home',
      evidence: '<a href>',
      screenId: 'SCREEN-001',
    }),
    element({
      page: pageUrl,
      elementId: 'UI-TABLE',
      elementType: 'table',
      tag: 'table',
      locator: '#results',
      accessibleName: 'Results',
      evidence: 'table / role=table|grid',
      attributes: { role: 'table' },
      interactive: false,
      screenId: 'SCREEN-001',
    }),
    element({
      page: pageUrl,
      elementId: 'UI-ICON',
      elementType: 'image',
      tag: 'span',
      locator: null,
      accessibleName: 'star',
      evidence: 'decorative icon',
      attributes: { 'aria-hidden': 'true' },
      interactive: false,
      screenId: 'SCREEN-001',
    }),
    element({
      page: pageUrl,
      elementId: 'UI-DEL',
      elementType: 'button',
      tag: 'button',
      locator: 'text=Delete',
      accessibleName: 'Delete',
      evidence: 'button / role=button',
      screenId: 'SCREEN-001',
    }),
  ];

  assert.deepEqual(
    elements.map((e) =>
      classifyElementKind({
        tag: e.tag,
        inputType: e.inputType,
        elementType: e.elementType,
        accessibleName: e.accessibleName,
        href: e.href,
        isSubmit: e.isSubmit,
        evidence: e.evidence,
        attributes: e.attributes,
      })
    ),
    ['email-input', 'password-input', 'submit-button', 'link', 'table', 'decorative', 'delete-button']
  );

  const map = pageMap([{ ...page('/login.html'), url: pageUrl, route: '/login.html' }]);
  map.screens = screens;
  const checks = buildScenarioInventory(map, ui(elements), safety);
  const byId = (id: string) => checks.filter((c) => c.targetElementId === id);

  assert.ok(byId('UI-EMAIL').some((c) => c.screenId === 'SCREEN-001' && c.status === 'PLANNED'));
  assert.ok(byId('UI-PASS').some((c) => c.purpose === 'password-input'));
  assert.ok(byId('UI-NAV').some((c) => c.purpose === 'navigation-link'));

  const decorative = byId('UI-ICON');
  assert.equal(decorative.length, 1, 'decorative emits one exclusion row');
  assert.ok(decorative.every((c) => c.status === 'NOT_APPLICABLE'));
  assert.ok(decorative.every((c) => /decorative element is not a functional control/i.test(c.reason ?? '')));
  assert.ok(!decorative.some((c) => c.status === 'PLANNED'));

  const submit = byId('UI-SUBMIT');
  assert.ok(submit.some((c) => c.status === 'BLOCKED' && /submit|state-changing/i.test(c.reason ?? '')));
  assert.ok(!submit.some((c) => c.status === 'PLANNED' && (c.kind === 'form-submit' || c.action === ('submit' as never))));

  const del = byId('UI-DEL');
  assert.ok(del.some((c) => c.status === 'BLOCKED' && /state-changing/i.test(c.reason ?? '')));

  const table = byId('UI-TABLE');
  assert.ok(table.some((c) => c.scenarioKind === 'positive' && c.action === 'observe' && c.status === 'PLANNED'));
  assert.ok(!table.some((c) => c.scenarioKind === 'negative' && c.status === 'PLANNED'));
  assert.ok(
    table.some(
      (c) =>
        c.status === 'NOT_APPLICABLE' &&
        /excluded:/.test(c.reason ?? '') &&
        /negative \(negative scenarios do not apply/i.test(c.reason ?? '')
    )
  );

  assert.equal(
    elements.some((e) => e.elementType === 'file-upload' || e.elementKind === 'file-upload'),
    false
  );
});

test('empty screen still has page-reached; zero functional element plans', () => {
  const pageUrl = 'http://app.test/blank.html';
  const map = pageMap([{ ...page('/blank.html'), url: pageUrl, route: '/blank.html' }]);
  map.screens = [{ id: 'SCREEN-001', url: pageUrl, state: 'default', source: 'direct-url' }];
  const checks = buildScenarioInventory(map, ui([]), safety);
  assert.ok(checks.some((c) => c.screenId === 'SCREEN-001' && c.scenarioKind === 'page-reached'));
  assert.equal(
    checks.filter((c) => c.targetElementId).length,
    0,
    'no element-targeted plans when screen has zero elements'
  );
});

test('generateUiChecks still produces planned rows via scenario inventory (same algorithm)', () => {
  const checks = generateUiChecks(
    pageMap([page('/contact.html')]),
    ui([element({ page: 'http://app.test/contact.html', locator: '#email', accessibleName: 'email' })]),
    safety
  );
  assert.ok(checks.length > 0);
  assert.ok(checks.every((c) => typeof c.id === 'string' && typeof c.kind === 'string'));
  const parsed = parsePlannedChecks(checks);
  assert.equal(parsed.length, checks.length);
  assert.ok(checks.some((c) => c.scenarioKind));
});

test('ambiguous unnamed buttons stay inventoried as NOT_TESTED; stable locator copied when present; submit stays BLOCKED', () => {
  const pageUrl = 'http://app.test/buttons.html';
  const map = pageMap([{ ...page('/buttons.html'), url: pageUrl, route: '/buttons.html' }]);
  map.screens = [{ id: 'SCREEN-001', url: pageUrl, state: 'default', source: 'direct-url' }];
  const elements = [
    element({
      page: pageUrl,
      elementId: 'ELEMENT-001',
      elementType: 'button',
      tag: 'button',
      elementKind: 'button',
      locator: null,
      locatorCandidates: [],
      locatorStrategy: 'fallback',
      locatorStable: false,
      locatorReason: 'NOT_TESTED: no stable locator; fallback would be ambiguous',
      accessibleName: null,
      screenId: 'SCREEN-001',
    }),
    element({
      page: pageUrl,
      elementId: 'ELEMENT-002',
      elementType: 'button',
      tag: 'button',
      elementKind: 'button',
      locator: null,
      locatorCandidates: [],
      locatorStrategy: 'fallback',
      locatorStable: false,
      locatorReason: 'NOT_TESTED: no stable locator; fallback would be ambiguous',
      accessibleName: null,
      screenId: 'SCREEN-001',
    }),
    element({
      page: pageUrl,
      elementId: 'ELEMENT-003',
      elementType: 'input',
      tag: 'input',
      inputType: 'email',
      elementKind: 'email-input',
      locator: 'input[name="email"]',
      locatorCandidates: ['input[name="email"]'],
      locatorStrategy: 'name',
      locatorStable: true,
      accessibleName: 'Email',
      attributes: { name: 'email', type: 'email' },
      screenId: 'SCREEN-001',
    }),
    element({
      page: pageUrl,
      elementId: 'ELEMENT-004',
      elementType: 'button',
      tag: 'button',
      inputType: 'submit',
      isSubmit: true,
      formMethod: 'post',
      elementKind: 'submit-button',
      locator: 'button[name="commit"]',
      locatorCandidates: ['button[name="commit"]'],
      locatorStrategy: 'name',
      locatorStable: true,
      accessibleName: 'Save',
      attributes: { name: 'commit', type: 'submit' },
      screenId: 'SCREEN-001',
    }),
  ];
  const checks = buildScenarioInventory(map, ui(elements), safety);
  const ambiguous = checks.filter(
    (c) => c.targetElementId === 'ELEMENT-001' || c.targetElementId === 'ELEMENT-002'
  );
  assert.ok(ambiguous.length > 0);
  assert.ok(
    ambiguous.every((c) => c.status === 'NOT_TESTED' || c.status === 'NOT_APPLICABLE'),
    'ambiguous buttons must not be PLANNED/PASS'
  );
  assert.ok(
    ambiguous.some(
      (c) => c.status === 'NOT_TESTED' && /no stable locator; fallback would be ambiguous/i.test(c.reason ?? '')
    )
  );
  assert.ok(!ambiguous.some((c) => c.status === 'PLANNED'));
  assert.ok(ambiguous.every((c) => !String(c.expect?.locator ?? '').includes('nth-child')));

  const emailPlanned = checks.find(
    (c) => c.targetElementId === 'ELEMENT-003' && c.status === 'PLANNED' && c.expect?.locator
  );
  assert.ok(emailPlanned);
  assert.equal(emailPlanned?.expect?.locator, 'input[name="email"]');
  assert.equal(emailPlanned?.targetElementId, 'ELEMENT-003');

  const submitBlocked = checks.filter((c) => c.targetElementId === 'ELEMENT-004' && c.status === 'BLOCKED');
  assert.ok(submitBlocked.length > 0);
  assert.ok(submitBlocked.every((c) => c.status === 'BLOCKED'));
  assert.ok(!submitBlocked.some((c) => c.status === 'PLANNED' && c.kind === 'form-submit'));
});

test('email with required+maxlength gets applied category rows; security has no exploit payload', () => {
  const email = element({
    elementId: 'UI-EMAIL-FULL',
    tag: 'input',
    inputType: 'email',
    elementKind: 'email-input',
    locator: '#email',
    accessibleName: 'Email',
    required: true,
    maxLength: '64',
    evidence: 'text-like input type=email',
    attributes: { type: 'email', maxlength: '64' },
  });
  const decisions = applicableCategories(email);
  const byCat = Object.fromEntries(decisions.map((d) => [d.category, d]));
  assert.equal(byCat.positive?.decision, 'apply');
  assert.equal(byCat.negative?.decision, 'apply');
  assert.equal(byCat.boundary?.decision, 'apply');
  assert.equal(byCat.validation?.decision, 'apply');
  assert.equal(byCat.security?.decision, 'apply');
  assert.match(byCat.security?.reason ?? '', /security observation only; no exploit payload/i);
  assert.equal(byCat.accessibility?.decision, 'apply');
  assert.equal(byCat.usability?.decision, 'apply');

  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([email]), safety);
  const rows = checks.filter((c) => c.targetElementId === 'UI-EMAIL-FULL');
  for (const kind of ['positive', 'negative', 'edge', 'validation', 'security', 'accessibility', 'usability'] as const) {
    assert.ok(
      rows.some((c) => c.scenarioKind === kind && (c.status === 'PLANNED' || c.status === 'NOT_TESTED')),
      `expected applied scenarioKind ${kind}`
    );
  }
  assert.ok(rows.some((c) => c.scenarioKind === 'edge' && c.category === 'boundary'));
  const security = rows.find((c) => c.scenarioKind === 'security' && c.status === 'PLANNED');
  assert.ok(security);
  assert.match(security?.reason ?? '', /security observation only; no exploit payload/i);
  assert.equal(security?.expect?.inputType, 'email');
  assert.ok(!/<(script|img)|select\s|drop\s|union\s|or\s+1=1/i.test(JSON.stringify(security?.expect ?? {})));
  assert.ok(!rows.some((c) => c.status === 'PASS' as never));
});

test('email without min/max/maxlength still applies edge analysis — no fabricated length/min fill', () => {
  const email = element({
    elementId: 'UI-EMAIL-OPEN',
    tag: 'input',
    inputType: 'email',
    elementKind: 'email-input',
    locator: '#email-open',
    accessibleName: 'Email',
    required: false,
    evidence: 'text-like input type=email',
    attributes: { type: 'email' },
  });
  const boundary = applicableCategories(email).find((d) => d.category === 'boundary');
  assert.equal(boundary?.decision, 'apply');
  assert.match(boundary?.reason ?? '', /edge\/boundary analysis for fillable input/i);

  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([email]), safety);
  const minMaxEdges = checks.filter(
    (c) =>
      c.targetElementId === 'UI-EMAIL-OPEN' &&
      c.scenarioKind === 'edge' &&
      typeof c.id === 'string' &&
      /edge-min$|edge-max$|edge-min-minus|edge-max-plus/.test(c.id)
  );
  assert.equal(minMaxEdges.length, 0);
  const exclusion = checks.find(
    (c) => c.targetElementId === 'UI-EMAIL-OPEN' && c.status === 'NOT_APPLICABLE' && /excluded:/.test(c.reason ?? '')
  );
  assert.ok(exclusion);
  assert.match(exclusion?.reason ?? '', /edge-min \(no minimum constraint discovered\)/);
  assert.match(exclusion?.reason ?? '', /edge-max \(no maximum constraint discovered\)/);
});

test('decorative icon → single NOT_APPLICABLE exclusion; no functional PLANNED row', () => {
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
  const decisions = applicableCategories(icon);
  assert.ok(decisions.every((d) => d.decision === 'exclude'));
  assert.equal(formatExcludedCategories(decisions).includes('decorative element is not a functional control'), true);

  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([icon]), safety);
  const rows = checks.filter((c) => c.targetElementId === 'UI-DECO');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'NOT_APPLICABLE');
  assert.match(rows[0]?.reason ?? '', /decorative element is not a functional control/i);
  assert.ok(!rows.some((c) => c.status === 'PLANNED'));
});

test('table → positive observe only; negative excluded with reason', () => {
  const tableEl = element({
    elementId: 'UI-TBL',
    elementType: 'table',
    tag: 'table',
    elementKind: 'table',
    locator: '#grid',
    accessibleName: 'Results',
    evidence: 'table / role=table',
    attributes: { role: 'table' },
    interactive: false,
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([tableEl]), safety);
  const rows = checks.filter((c) => c.targetElementId === 'UI-TBL');
  assert.ok(rows.some((c) => c.scenarioKind === 'positive' && c.action === 'observe' && c.status === 'PLANNED'));
  assert.ok(!rows.some((c) => c.scenarioKind === 'negative' && c.status === 'PLANNED'));
  assert.ok(
    rows.some(
      (c) =>
        c.status === 'NOT_APPLICABLE' &&
        /excluded:/.test(c.reason ?? '') &&
        /negative \(negative scenarios do not apply to a data-display element\)/i.test(c.reason ?? '')
    )
  );
});

test('submit is never PLANNED as a submit action', () => {
  const checks = buildScenarioInventory(
    pageMap([page('/form.html')]),
    ui([
      element({
        elementId: 'UI-GO',
        elementType: 'button',
        tag: 'button',
        inputType: 'submit',
        isSubmit: true,
        formMethod: 'post',
        elementKind: 'submit-button',
        locator: 'text=Submit',
        accessibleName: 'Submit',
        evidence: 'submit button',
      }),
    ]),
    safety
  );
  const rows = checks.filter((c) => c.targetElementId === 'UI-GO');
  assert.ok(rows.some((c) => c.status === 'BLOCKED' && /submit|state-changing/i.test(c.reason ?? '')));
  assert.ok(
    rows
      .filter((c) => c.status === 'PLANNED')
      .every((c) => c.action === 'observe' || c.action === 'none')
  );
  assert.ok(!rows.some((c) => c.status === 'PLANNED' && c.kind === 'form-submit'));
  assert.ok(!rows.some((c) => String(c.action) === 'submit'));
});
