/**
 * Context-aware security planning tests — planning only; no network, no HTTP attacks,
 * no filesystem writes of upload bytes, no exploit payloads in fixtures.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { DiscoveredScreen } from '../discovery/screens';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { ROOT } from '../lib/paths';
import {
  buildSecurityPlansForScreen,
  collectExistingSubcaseIds,
  hasFormWithSubmit,
  SECURITY_FIXTURES,
} from './security-cases';
import { buildScenarioInventory } from './scenario-inventory';
import { JAVASCRIPT_HREF_NOT_FOLLOWED_REASON } from './link-cases';

function screen(overrides: Partial<DiscoveredScreen> = {}): DiscoveredScreen {
  return {
    id: 'SCREEN-001',
    url: 'https://example.test/app',
    state: 'default',
    source: 'direct-url',
    ...overrides,
  };
}

function el(overrides: Partial<UiElementRecord> = {}): UiElementRecord {
  return {
    page: 'https://example.test/app',
    elementId: 'UI-0001',
    elementType: 'input',
    elementKind: 'text-input',
    locator: '#field',
    locatorCandidates: ['#field'],
    accessibleName: 'Name',
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

function bySubcase(plans: ReturnType<typeof buildSecurityPlansForScreen>['plans']) {
  return Object.fromEntries(plans.map((p) => [p.subcaseId, p]));
}

function assertNoExploitPayload(blob: string): void {
  assert.equal(blob.includes('<script'), false);
  assert.equal(blob.includes('javascript:'), false);
  assert.equal(blob.includes('onerror='), false);
  assert.equal(blob.includes('OR 1=1'), false);
  assert.equal(blob.includes('../'), false);
  assert.doesNotMatch(blob, /UNION\s+SELECT/i);
}

function assertNoDemoHosts(blob: string): void {
  const lower = blob.toLowerCase();
  assert.equal(lower.includes('saucedemo'), false);
  assert.equal(lower.includes('the-internet.herokuapp'), false);
  assert.equal(lower.includes('demo.playwright'), false);
}

function assertAllNonExecutable(
  plans: ReturnType<typeof buildSecurityPlansForScreen>['plans']
): void {
  assert.ok(plans.every((p) => p.executable === false));
  assert.ok(plans.every((p) => p.status !== 'PASS'));
  assert.ok(
    plans.every((p) => p.action === 'observe' || p.action === 'none' || p.action === 'fill-no-submit')
  );
  assert.ok(
    !plans.some(
      (p) =>
        p.status === 'PLANNED' &&
        (p.action === 'click-button' || p.action === 'click-link')
    )
  );
}

test('module source has no demo hosts, no HTTP client, no fs write, no exploit literals', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'security-cases.ts'), 'utf8');
  assert.doesNotMatch(src, /saucedemo|the-internet\.herokuapp|demo\.playwright/i);
  assert.doesNotMatch(src, /from\s+['"]node:fs['"]/);
  assert.doesNotMatch(src, /writeFileSync|writeFile|createWriteStream/);
  assert.doesNotMatch(src, /fetch\(|http\.request|axios|got\(/);
  assert.equal(src.includes('<script'), false);
  assert.equal(src.includes('OR 1=1'), false);
  assert.equal(src.includes('onerror='), false);
  assert.match(src, /run-security\.ts/);
  assert.match(src, /script-like-fixture/);
});

test('text input screen → one inert injection row; XSS-like is NOT_APPLICABLE; no exploit in JSON', () => {
  const result = buildSecurityPlansForScreen({
    screen: screen(),
    elements: [el({ elementId: 'UI-TEXT', elementKind: 'text-input', inputType: 'text' })],
  });
  assertAllNonExecutable(result.plans);
  const map = bySubcase(result.plans);
  assert.equal(map['sec-input-injection']?.status, 'PLANNED');
  assert.equal(map['sec-input-injection']?.action, 'fill-no-submit');
  assert.equal(map['sec-input-injection']?.expect?.fillValue, SECURITY_FIXTURES.scriptLike);
  assert.equal(map['sec-input-injection']?.expect?.fillValue, 'script-like-fixture');
  assert.match(map['sec-input-injection']?.reason ?? '', /inert fixture; not an exploit/);
  assert.equal(map['sec-xss-like']?.status, 'NOT_APPLICABLE');
  assert.match(map['sec-xss-like']?.reason ?? '', /inert fixture only/);
  assert.equal(map['sec-none'], undefined);

  const blob = JSON.stringify(result.plans);
  assertNoExploitPayload(blob);
  assertNoDemoHosts(blob);
  assert.equal(blob.includes('<script'), false);
  assert.equal(blob.includes('OR 1=1'), false);
});

test('no inputs, no form, no links, no file → sec-none NOT_APPLICABLE, not PASS', () => {
  const result = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-EMPTY' }),
    elements: [],
  });
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0]?.subcaseId, 'sec-none');
  assert.equal(result.plans[0]?.status, 'NOT_APPLICABLE');
  assert.notEqual(result.plans[0]?.status, 'PASS');
  assert.match(result.plans[0]?.reason ?? '', /no security-relevant control/);
});

test('form with submit → CSRF row NOT_TESTED; no forged body', () => {
  const elements = [
    el({
      elementId: 'UI-FORM',
      elementType: 'form',
      elementKind: 'form',
      accessibleName: 'Contact',
    }),
    el({
      elementId: 'UI-SUBMIT',
      elementType: 'button',
      elementKind: 'submit-button',
      isSubmit: true,
      accessibleName: 'Submit',
      potentialAction: 'click',
    }),
  ];
  assert.equal(hasFormWithSubmit(elements), true);
  const result = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-FORM' }),
    elements,
  });
  const csrf = bySubcase(result.plans)['sec-csrf'];
  assert.ok(csrf);
  assert.equal(csrf!.status, 'NOT_TESTED');
  assert.equal(csrf!.action, 'none');
  assert.match(csrf!.reason ?? '', /CSRF behavior is not executed/);
  const blob = JSON.stringify(result.plans);
  assert.doesNotMatch(blob, /csrf_token\s*=\s*[A-Za-z0-9_-]{8,}/i);
  assert.doesNotMatch(blob, /"body"\s*:\s*\{/);
  assert.equal(blob.includes('<script'), false);
});

test('file input → upload row NOT_TESTED; no fs write plan', () => {
  const result = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-FILE' }),
    elements: [
      el({
        elementId: 'UI-FILE',
        elementType: 'file-upload',
        elementKind: 'file-upload',
        inputType: 'file',
        accessibleName: 'Upload',
      }),
    ],
  });
  const upload = bySubcase(result.plans)['sec-file-upload'];
  assert.ok(upload);
  assert.equal(upload!.status, 'NOT_TESTED');
  assert.equal(upload!.action, 'none');
  assert.match(upload!.reason ?? '', /file bytes are not written/);
  assert.match(upload!.reason ?? '', /field-file/);
  const blob = JSON.stringify(result.plans);
  assert.doesNotMatch(blob, /writeFile|createWriteStream/);
  // No fixture.txt fill plan from security-cases
  assert.ok(!result.plans.some((p) => p.expect?.fillValue === 'fixture.txt'));
});

test('requestUrl without two ids → IDOR NOT_TESTED; no HTTP', () => {
  const result = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-API' }),
    elements: [
      el({
        elementId: 'UI-API',
        elementType: 'button',
        elementKind: 'button',
        requestUrl: 'https://example.test/api/items/1',
        accessibleName: 'Open',
      }),
    ],
  });
  const idor = bySubcase(result.plans)['sec-idor'];
  assert.ok(idor);
  assert.equal(idor!.status, 'NOT_TESTED');
  assert.match(idor!.reason ?? '', /resource ids were not supplied/);
  assert.equal(idor!.action, 'none');
});

test('requestUrl with two resource ids → IDOR NOT_TESTED not executed', () => {
  const result = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-API2' }),
    elements: [
      el({
        elementId: 'UI-API',
        elementType: 'button',
        elementKind: 'button',
        requestUrl: 'https://example.test/api/items/1',
      }),
    ],
    options: { resourceIds: ['res-a', 'res-b'] },
  });
  const idor = bySubcase(result.plans)['sec-idor'];
  assert.ok(idor);
  assert.equal(idor!.status, 'NOT_TESTED');
  assert.match(idor!.reason ?? '', /IDOR-style access is not requested/);
});

test('skips sec-input-injection when login-injection already present', () => {
  const result = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-LOGIN' }),
    elements: [
      el({
        elementId: 'UI-USER',
        elementKind: 'text-input',
        inputType: 'text',
        accessibleName: 'Username',
      }),
      el({
        elementId: 'UI-PASS',
        elementKind: 'password-input',
        inputType: 'password',
        accessibleName: 'Password',
      }),
    ],
    options: {
      existingSubcaseIds: new Set(['login-injection']),
    },
  });
  const map = bySubcase(result.plans);
  assert.equal(map['sec-input-injection'], undefined);
  assert.ok(map['sec-xss-like']);
  assert.equal(map['sec-xss-like']?.status, 'NOT_APPLICABLE');
});

test('collectExistingSubcaseIds extracts login-injection from inventory ids', () => {
  const ids = collectExistingSubcaseIds(
    [
      { id: 'INV-0042-login-injection', screenId: 'SCREEN-001' },
      { id: 'INV-0043-login-valid', screenId: 'SCREEN-001' },
      { id: 'INV-0099-login-injection', screenId: 'SCREEN-OTHER' },
    ],
    'SCREEN-001'
  );
  assert.ok(ids.has('login-injection'));
  assert.ok(ids.has('login-valid'));
});

test('gated page emits authorization bypass NOT_TESTED; omit when no auth context', () => {
  const gated = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-GATED' }),
    elements: [],
    pages: [
      {
        url: 'https://example.test/app',
        route: '/app',
        title: 'App',
        status: 200,
        ok: true,
        depth: 0,
        h1s: [],
        applicableTestTypes: applicableTestTypes('pages'),
        access: 'gated',
        gatedReason: 'login wall',
      },
    ],
  });
  assert.equal(bySubcase(gated.plans)['sec-authorization-bypass']?.status, 'NOT_TESTED');
  assert.match(
    bySubcase(gated.plans)['sec-authorization-bypass']?.reason ?? '',
    /authorization bypass is not executed/
  );

  const plain = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-PLAIN' }),
    elements: [],
  });
  assert.equal(bySubcase(plain.plans)['sec-authorization-bypass'], undefined);
  assert.equal(bySubcase(plain.plans)['sec-none']?.status, 'NOT_APPLICABLE');
});

test('sensitive password field → PLANNED observe; recorded value is masked', () => {
  const result = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-SENS' }),
    elements: [
      el({
        elementId: 'UI-PASS',
        elementKind: 'password-input',
        inputType: 'password',
        accessibleName: 'Password',
        requestBody: 'password=secret-value-xyz',
      }),
    ],
  });
  const sens = bySubcase(result.plans)['sec-sensitive-data'];
  assert.ok(sens);
  assert.equal(sens!.status, 'PLANNED');
  assert.equal(sens!.action, 'observe');
  assert.match(sens!.reason ?? '', /values are not logged/);
  const blob = JSON.stringify(result.plans);
  assert.doesNotMatch(blob, /secret-value-xyz/);
  assert.match(blob, /MASKED|mask/i);
});

test('javascript href → BLOCKED with link-cases reason; payload not stored', () => {
  const result = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-JS' }),
    elements: [
      el({
        elementId: 'UI-JS',
        elementType: 'link',
        elementKind: 'link',
        href: 'javascript:void(0)',
        accessibleName: 'Go',
      }),
    ],
  });
  const row = bySubcase(result.plans)['sec-unsafe-redirect'];
  assert.ok(row);
  assert.equal(row!.status, 'BLOCKED');
  assert.equal(row!.reason, JAVASCRIPT_HREF_NOT_FOLLOWED_REASON);
  const blob = JSON.stringify(result.plans);
  // Scheme may appear in the source module constant path only via reason text "javascript href"
  // but the href payload itself must not be stored in expect.href
  assert.equal(row!.expect?.href, undefined);
  assert.doesNotMatch(blob, /javascript:void/);
});

test('login screen emits session NOT_TESTED; ordinary page omits session', () => {
  const login = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-LOGIN2', url: 'https://example.test/login' }),
    elements: [
      el({
        elementId: 'UI-USER',
        elementKind: 'text-input',
        inputType: 'text',
        accessibleName: 'Username',
      }),
      el({
        elementId: 'UI-PASS',
        elementKind: 'password-input',
        inputType: 'password',
        accessibleName: 'Password',
      }),
    ],
  });
  assert.equal(bySubcase(login.plans)['sec-session']?.status, 'NOT_TESTED');

  const ordinary = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-ORD' }),
    elements: [el({ elementId: 'UI-T', elementKind: 'text-input' })],
  });
  assert.equal(bySubcase(ordinary.plans)['sec-session'], undefined);
});

test('production without authorizeDestructive blocks active injection; sensitive observe stays PLANNED', () => {
  const result = buildSecurityPlansForScreen({
    screen: screen({ id: 'SCREEN-PROD' }),
    elements: [
      el({ elementId: 'UI-T', elementKind: 'text-input', inputType: 'text' }),
      el({
        elementId: 'UI-PASS',
        elementKind: 'password-input',
        inputType: 'password',
        accessibleName: 'Password',
      }),
    ],
    options: { environment: 'production', authorizeDestructive: false },
  });
  const map = bySubcase(result.plans);
  assert.equal(map['sec-input-injection']?.status, 'BLOCKED');
  assert.match(map['sec-input-injection']?.reason ?? '', /not authorized against production/);
  assert.equal(map['sec-input-injection']?.action, 'none');
  assert.equal(map['sec-sensitive-data']?.status, 'PLANNED');
  assert.equal(map['sec-sensitive-data']?.action, 'observe');
});

test('scenario-inventory wires security-context rows; password security rows remain', () => {
  function pageMap(pages: PageMap['pages']): PageMap {
    return {
      generatedAt: new Date().toISOString(),
      seedUrl: 'http://app.test/',
      scopeHost: 'app.test',
      truncated: false,
      pages,
      routes: pages.map((p) => ({ path: p.route, url: p.url, title: p.title, source: 'crawl' })),
      navigation: [],
      skippedByScope: [],
      categoryStatus: [],
    };
  }
  function page(route: string): PageMap['pages'][number] {
    return {
      url: `http://app.test${route}`,
      route,
      title: route,
      status: 200,
      ok: true,
      depth: 0,
      h1s: ['Heading'],
      applicableTestTypes: applicableTestTypes('pages'),
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

  const checks = buildScenarioInventory(
    pageMap([page('/form.html')]),
    ui([
      el({
        page: 'http://app.test/form.html',
        elementId: 'UI-TEXT',
        elementKind: 'text-input',
        inputType: 'text',
        locator: '#name',
        accessibleName: 'Name',
      }),
      el({
        page: 'http://app.test/form.html',
        elementId: 'UI-EMAIL',
        elementKind: 'email-input',
        inputType: 'email',
        locator: '#email',
        accessibleName: 'Email',
        evidence: 'type=email',
      }),
    ]),
    resolveSafetyConfig()
  );

  const ctx = checks.filter((c) => c.scenarioKind === 'security-context');
  assert.ok(ctx.length > 0);
  assert.ok(
    ctx.some((c) => c.id.includes('sec-input-injection')),
    `expected sec-input-injection among ${ctx.map((c) => c.id).join(', ')}`
  );
  assert.ok(ctx.every((c) => c.action === 'observe' || c.action === 'none' || c.action === 'fill-no-submit'));

  // Password-only page still keeps scenarioKind "security" observation rows (not security-context).
  const withPassword = buildScenarioInventory(
    pageMap([page('/pw.html')]),
    ui([
      el({
        page: 'http://app.test/pw.html',
        elementId: 'UI-PASS',
        elementKind: 'password-input',
        inputType: 'password',
        locator: '#pw',
        accessibleName: 'Password',
        evidence: 'type=password',
      }),
    ]),
    resolveSafetyConfig()
  );
  const passwordObs = withPassword.filter(
    (c) => c.scenarioKind === 'security' && c.kind === 'security-observation'
  );
  assert.ok(passwordObs.length > 0, 'existing password security-observation rows must remain');

  const blob = JSON.stringify(ctx);
  assertNoExploitPayload(blob);
  assertNoDemoHosts(blob);
});
