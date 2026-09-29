import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { PageMap } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { FORM_SUBMIT_NOT_AUTHORIZED_REASON } from './button-cases';
import { LOGIN_FIXTURES, buildAccessGateCoverageNotes, isLoginScreen } from './login-cases';
import { buildScenarioInventory } from './scenario-inventory';

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

function page(route: string, status = 200, access?: PageMap['pages'][number]['access']): PageMap['pages'][number] {
  return {
    url: `http://app.test${route}`,
    route,
    title: route,
    status,
    ok: status < 400,
    depth: 0,
    h1s: status < 400 ? ['Heading'] : [],
    applicableTestTypes: applicableTestTypes('pages'),
    ...(access ? { access } : {}),
  };
}

function element(overrides: Partial<UiElementRecord>): UiElementRecord {
  return {
    page: 'http://app.test/signin',
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

function loginRows(checks: ReturnType<typeof buildScenarioInventory>) {
  return checks.filter((c) => c.scenarioKind === 'login');
}

function rowBySuffix(checks: ReturnType<typeof buildScenarioInventory>, suffix: string) {
  return loginRows(checks).find((c) => typeof c.id === 'string' && c.id.endsWith(suffix));
}

test('password + email + submit → fill positives/negatives/injection present; submit not PLANNED', () => {
  const email = element({
    elementId: 'UI-EMAIL',
    page: 'http://app.test/account',
    inputType: 'email',
    elementKind: 'email-input',
    accessibleName: 'Email',
    locator: '#email',
  });
  const pwd = element({
    elementId: 'UI-PWD',
    page: 'http://app.test/account',
    inputType: 'password',
    elementKind: 'password-input',
    accessibleName: 'Password',
    locator: '#password',
  });
  const submit = element({
    elementId: 'UI-SUBMIT',
    page: 'http://app.test/account',
    elementType: 'button',
    elementKind: 'submit-button',
    tag: 'button',
    accessibleName: 'Sign in',
    locator: 'text=Sign in',
    isSubmit: true,
    potentialAction: 'click',
  });

  const checks = buildScenarioInventory(
    pageMap([page('/account')]),
    ui([email, pwd, submit]),
    safety
  );
  const rows = loginRows(checks);
  assert.ok(rows.length > 0, 'login rows expected when password + email present');

  for (const id of [
    'login-valid-credentials',
    'login-wrong-username',
    'login-wrong-password',
    'login-both-wrong',
    'login-empty-username',
    'login-empty-password',
    'login-unknown-account',
    'login-injection',
  ]) {
    const row = rowBySuffix(checks, id);
    assert.ok(row, `missing ${id}`);
    assert.equal(row!.status, 'PLANNED');
    assert.equal(row!.action, 'fill-no-submit');
  }

  const injection = rowBySuffix(checks, 'login-injection');
  assert.equal(injection?.expect?.fillValue, LOGIN_FIXTURES.injectionUsername);
  assert.equal(injection?.expect?.fillValue, 'script-like-fixture');
  const blob = JSON.stringify(injection);
  assert.equal(blob.includes('<'), false);
  assert.equal(blob.includes(' OR '), false);

  const submitLogin = rowBySuffix(checks, 'login-submit');
  assert.ok(submitLogin);
  assert.equal(submitLogin?.status, 'BLOCKED');
  assert.equal(submitLogin?.reason, FORM_SUBMIT_NOT_AUTHORIZED_REASON);
  assert.notEqual(submitLogin?.status, 'PLANNED');

  const success = rowBySuffix(checks, 'login-success');
  assert.equal(success?.status, 'NOT_TESTED');
  assert.match(success?.reason ?? '', /login success was not observed because the form is not submitted/);

  const plannedSubmitters = rows.filter(
    (c) =>
      c.status === 'PLANNED' &&
      (c.kind === 'form-submit' || c.action === 'click-button' || String(c.action) === 'submit')
  );
  assert.equal(plannedSubmitters.length, 0, 'planned login rows that would submit must be 0');
});

test('login-rapid is a single NOT_TESTED row (no repeated attempts)', () => {
  const email = element({
    elementId: 'UI-EMAIL',
    page: 'http://app.test/account',
    inputType: 'email',
    elementKind: 'email-input',
  });
  const pwd = element({
    elementId: 'UI-PWD',
    page: 'http://app.test/account',
    inputType: 'password',
    elementKind: 'password-input',
  });
  const checks = buildScenarioInventory(pageMap([page('/account')]), ui([email, pwd]), safety);
  const rapid = loginRows(checks).filter((c) => c.id.endsWith('login-rapid'));
  assert.equal(rapid.length, 1);
  assert.equal(rapid[0]!.status, 'NOT_TESTED');
  assert.match(rapid[0]!.reason ?? '', /rapid login attempts are not executed/);
  assert.match(rapid[0]!.reason ?? '', /no repeated authentication/);
});

test('text input only, no password, no gated access → zero login rows', () => {
  const text = element({
    elementId: 'UI-TEXT',
    page: 'http://app.test/form.html',
    inputType: 'text',
    elementKind: 'text-input',
    accessibleName: 'Notes',
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([text]), safety);
  assert.equal(loginRows(checks).length, 0);
  assert.equal(
    isLoginScreen({
      screen: { id: 'SCREEN-001', url: 'http://app.test/form.html', state: 'default', source: 'direct-url' },
      elements: [text],
      page: page('/form.html'),
    }),
    false
  );
});

test('locked and expired are NOT_TESTED', () => {
  const email = element({
    elementId: 'UI-EMAIL',
    page: 'http://app.test/account',
    inputType: 'email',
    elementKind: 'email-input',
  });
  const pwd = element({
    elementId: 'UI-PWD',
    page: 'http://app.test/account',
    inputType: 'password',
    elementKind: 'password-input',
  });
  const checks = buildScenarioInventory(pageMap([page('/account')]), ui([email, pwd]), safety);
  const locked = rowBySuffix(checks, 'login-locked-account');
  const expired = rowBySuffix(checks, 'login-expired-credentials');
  assert.equal(locked?.status, 'NOT_TESTED');
  assert.match(locked?.reason ?? '', /locked account was not in discovery evidence/);
  assert.equal(expired?.status, 'NOT_TESTED');
  assert.match(expired?.reason ?? '', /expired credentials were not in discovery evidence/);
});

test('no demo hosts in login plan payloads', () => {
  const email = element({
    elementId: 'UI-EMAIL',
    page: 'http://app.test/signin',
    inputType: 'email',
    elementKind: 'email-input',
  });
  const pwd = element({
    elementId: 'UI-PWD',
    page: 'http://app.test/signin',
    inputType: 'password',
    elementKind: 'password-input',
  });
  const checks = buildScenarioInventory(pageMap([page('/signin')]), ui([email, pwd]), safety);
  const blob = JSON.stringify(loginRows(checks));
  assert.ok(!/demo\.|example\.com\/login|the-internet|saucedemo|localhost:3000/i.test(blob));
});

test('generic auth route alone qualifies; no invented username/password fill rows', () => {
  const checks = buildScenarioInventory(pageMap([page('/login')]), ui([]), safety);
  const rows = loginRows(checks);
  assert.ok(rows.length > 0, 'auth route /login should emit login rows');
  assert.equal(rowBySuffix(checks, 'login-valid-credentials'), undefined);
  assert.equal(rowBySuffix(checks, 'login-wrong-username'), undefined);
  assert.equal(rowBySuffix(checks, 'login-wrong-password'), undefined);
  assert.equal(rowBySuffix(checks, 'login-injection'), undefined);
  const fillRows = rows.filter((r) => r.action === 'fill-no-submit');
  assert.equal(fillRows.length, 0, 'no credential fills when no fields discovered');
  assert.ok(!rows.some((r) => r.status === ('PASS' as typeof r.status)));
});

test('injection is one row with script-like-fixture only — not a payload list', () => {
  const email = element({
    elementId: 'UI-EMAIL',
    page: 'http://app.test/account',
    inputType: 'email',
    elementKind: 'email-input',
  });
  const pwd = element({
    elementId: 'UI-PWD',
    page: 'http://app.test/account',
    inputType: 'password',
    elementKind: 'password-input',
  });
  const checks = buildScenarioInventory(pageMap([page('/account')]), ui([email, pwd]), safety);
  const injections = loginRows(checks).filter((c) => c.id.endsWith('login-injection'));
  assert.equal(injections.length, 1);
  assert.equal(injections[0]!.expect?.fillValue, 'script-like-fixture');
  assert.match(injections[0]!.reason ?? '', /inert credential fixture/);
  assert.match(injections[0]!.reason ?? '', /not an exploit/);
  assert.match(injections[0]!.reason ?? '', /not a brute-force/);
});

test('access gate coverage notes are REQUIRES_CONFIGURATION and never navigate or PASS', () => {
  const notes = buildAccessGateCoverageNotes({
    layers: [
      {
        gate: 'public',
        status: 'DISCOVERED',
        reason: 'screens crawled without an authentication gate',
        screenIds: [],
      },
      {
        gate: 'login',
        status: 'NOT_TESTED',
        reason: 'no login screen was discovered',
        screenIds: [],
      },
      {
        gate: 'role',
        status: 'REQUIRES_CONFIGURATION',
        reason: 'role was not supplied',
        screenIds: [],
      },
      {
        gate: 'permission',
        status: 'REQUIRES_CONFIGURATION',
        reason: 'permission was not supplied',
        screenIds: [],
      },
    ],
    publicScreenIds: [],
  });
  assert.equal(notes.length, 2);
  for (const note of notes) {
    assert.equal(note.status, 'REQUIRES_CONFIGURATION');
    assert.equal(note.action, 'none');
    assert.match(note.reason, /was not supplied/);
  }
  assert.equal(buildAccessGateCoverageNotes(undefined).length, 0);
});

test('SSO-style auth screen with only Continue button → zero username/password fill rows', () => {
  const continueBtn = element({
    elementId: 'UI-CONTINUE',
    page: 'http://app.test/login',
    elementType: 'button',
    elementKind: 'button',
    tag: 'button',
    accessibleName: 'Continue',
    locator: 'text=Continue',
    potentialAction: 'click',
  });
  const checks = buildScenarioInventory(pageMap([page('/login')]), ui([continueBtn]), safety);
  const rows = loginRows(checks);
  assert.ok(rows.length > 0, 'auth route still qualifies');
  const credentialFillIds = [
    'login-valid-credentials',
    'login-wrong-username',
    'login-wrong-password',
    'login-both-wrong',
    'login-empty-username',
    'login-empty-password',
    'login-unknown-account',
    'login-injection',
  ];
  for (const id of credentialFillIds) {
    assert.equal(rowBySuffix(checks, id), undefined, `must not invent ${id}`);
  }
  const inventingFills = rows.filter(
    (r) =>
      r.action === 'fill-no-submit' &&
      /username|password|user-fixture|password-fixture/i.test(
        `${r.expect?.fillValue ?? ''} ${r.expect?.note ?? ''} ${r.reason ?? ''}`
      )
  );
  assert.equal(inventingFills.length, 0, 'no invented username/password fills');
});

test('auth screen with tel + otp and no password → no login-wrong-password; phone/otp via field planners', () => {
  const phone = element({
    elementId: 'UI-TEL',
    page: 'http://app.test/signin',
    inputType: 'tel',
    elementKind: 'text-input',
    accessibleName: 'Phone',
    locator: '#phone',
    attributes: { type: 'tel', name: 'phone' },
  });
  const otp = element({
    elementId: 'UI-OTP',
    page: 'http://app.test/signin',
    inputType: 'text',
    elementKind: 'otp-field',
    accessibleName: 'OTP',
    locator: '#otp',
    attributes: { type: 'text', name: 'otp' },
  });
  const checks = buildScenarioInventory(pageMap([page('/signin')]), ui([phone, otp]), safety);
  assert.equal(rowBySuffix(checks, 'login-wrong-password'), undefined);
  assert.equal(rowBySuffix(checks, 'login-empty-password'), undefined);
  assert.equal(rowBySuffix(checks, 'login-wrong-username'), undefined);

  const phoneField = checks.filter(
    (c) => c.scenarioKind === 'field' && c.targetElementId === 'UI-TEL'
  );
  const otpField = checks.filter(
    (c) =>
      (c.scenarioKind === 'field' || c.scenarioKind === 'positive' || c.scenarioKind === 'negative') &&
      c.targetElementId === 'UI-OTP'
  );
  assert.ok(
    phoneField.some((c) => /phone/i.test(c.id) || /phone/i.test(c.title)),
    'phone field planner rows expected for type=tel'
  );
  assert.ok(otpField.length > 0, 'otp planned via existing text/number builders, not invented password');
});

test('auth screen with email + password still emits email/password login fills because fields exist', () => {
  const email = element({
    elementId: 'UI-EMAIL',
    page: 'http://app.test/login',
    inputType: 'email',
    elementKind: 'email-input',
    accessibleName: 'Email',
  });
  const pwd = element({
    elementId: 'UI-PWD',
    page: 'http://app.test/login',
    inputType: 'password',
    elementKind: 'password-input',
    accessibleName: 'Password',
  });
  const checks = buildScenarioInventory(pageMap([page('/login')]), ui([email, pwd]), safety);
  assert.equal(rowBySuffix(checks, 'login-valid-credentials')?.status, 'PLANNED');
  assert.equal(rowBySuffix(checks, 'login-wrong-password')?.status, 'PLANNED');
  assert.equal(rowBySuffix(checks, 'login-wrong-username')?.status, 'PLANNED');
  const emailPlans = checks.filter(
    (c) =>
      c.targetElementId === 'UI-EMAIL' &&
      (c.scenarioKind === 'field' ||
        c.scenarioKind === 'positive' ||
        c.scenarioKind === 'negative' ||
        c.scenarioKind === 'edge')
  );
  const pwdPlans = checks.filter(
    (c) =>
      c.targetElementId === 'UI-PWD' &&
      (c.scenarioKind === 'field' ||
        c.scenarioKind === 'positive' ||
        c.scenarioKind === 'negative' ||
        c.scenarioKind === 'edge')
  );
  assert.ok(emailPlans.length > 0, 'email element still gets type-driven cases because it exists');
  assert.ok(pwdPlans.length > 0, 'password element still gets type-driven cases because it exists');
});

test('ordinary number input with maxlength gets number/edge cases without requiring a login screen', () => {
  const num = element({
    elementId: 'UI-QTY',
    page: 'http://app.test/form.html',
    inputType: 'number',
    elementKind: 'number-input',
    accessibleName: 'Quantity',
    locator: '#qty',
    maxLength: '5',
    attributes: { type: 'number', maxlength: '5', max: '99' },
  });
  const checks = buildScenarioInventory(pageMap([page('/form.html')]), ui([num]), safety);
  assert.equal(loginRows(checks).length, 0);
  const numberish = checks.filter(
    (c) =>
      c.targetElementId === 'UI-QTY' &&
      (c.scenarioKind === 'field' || c.scenarioKind === 'edge' || c.scenarioKind === 'positive')
  );
  assert.ok(numberish.length > 0, 'number/edge/field cases expected from discovered constraints');
  assert.ok(
    numberish.some(
      (c) =>
        /number|edge|max|min/i.test(`${c.id} ${c.title}`) ||
        c.kind === 'boundary-values' ||
        c.scenarioKind === 'edge'
    ),
    'number or edge cases from maxlength/max constraints'
  );
});

test('login-cases and scenario-inventory sources do not mandate username+password for every login screen', () => {
  const root = path.resolve(__dirname);
  const loginSrc = readFileSync(path.join(root, 'login-cases.ts'), 'utf8');
  const inventorySrc = readFileSync(path.join(root, 'scenario-inventory.ts'), 'utf8');
  for (const src of [loginSrc, inventorySrc]) {
    assert.equal(/always has username/i.test(src), false);
    assert.equal(/username and password (are |fields were )?mandatory/i.test(src), false);
    assert.equal(/require(s|d)? (both |the )?username and password/i.test(src), false);
    assert.equal(/hasFields\s*=\s*Boolean\(\s*username\s*&&\s*password\s*\)/.test(src), false);
  }
  assert.match(loginSrc, /Fill rows emit only for discovered/);
  assert.match(inventorySrc, /field- and constraint-driven/);
});
