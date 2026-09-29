import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateHttpStatus,
} from '../lib/api/http-status-matrix';
import {
  SPECIFICATION_REQUIRED,
  buildRolePermissionPlans,
  type RolePermissionPlan,
  type RolePermissionRule,
} from './role-cases';

function assertNoDemoHosts(value: unknown): void {
  const blob = JSON.stringify(value);
  assert.equal(/saucedemo|jsonplaceholder|swag\s*labs|inventory\.html|example\.com/i.test(blob), false);
}

function assertNoAngleBracket(value: unknown): void {
  const blob = JSON.stringify(value);
  assert.equal(blob.includes('<'), false, 'plans must not contain "<"');
}

function assertNeverExecutable(plans: RolePermissionPlan[]): void {
  for (const plan of plans) {
    assert.equal(plan.executable, false);
    assert.notEqual(plan.action, 'click-button');
    assert.notEqual(plan.action, 'click-link');
  }
}

test('roles omitted → one REQUIRES_CONFIGURATION; no default Admin/Super Admin', () => {
  const plans = buildRolePermissionPlans({});
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.subcaseId, 'role-unconfigured');
  assert.equal(plans[0]?.status, 'REQUIRES_CONFIGURATION');
  assert.match(plans[0]?.reason ?? '', /roles were not configured/);
  assertNeverExecutable(plans);
  const blob = JSON.stringify(plans);
  assert.equal(/Super Admin|"Admin"|Viewer|Manager/.test(blob), false);
  assertNoDemoHosts(plans);
  assertNoAngleBracket(plans);
});

test('roles null → one REQUIRES_CONFIGURATION', () => {
  const plans = buildRolePermissionPlans({ roles: null });
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.status, 'REQUIRES_CONFIGURATION');
});

test('roles [User] and no rules → five SPECIFICATION_REQUIRED/NOT_TESTED rows, no PASS', () => {
  const plans = buildRolePermissionPlans({ roles: ['User'], rules: [] });
  assert.equal(plans.length, 5);
  const ids = plans.map((p) => p.subcaseId).sort();
  assert.deepEqual(ids, [
    'role-allowed-action',
    'role-api-authorization',
    'role-direct-url',
    'role-forbidden-action',
    'role-hidden-ui',
  ]);
  for (const plan of plans) {
    assert.equal(plan.role, 'User');
    assert.equal(plan.status, 'NOT_TESTED');
    assert.match(plan.reason ?? '', new RegExp(`^${SPECIFICATION_REQUIRED}:`));
    assert.match(plan.reason ?? '', /permission rule for this role was not configured/);
    assert.notEqual(plan.status, 'PASS');
  }
  assertNeverExecutable(plans);
  assert.equal(JSON.stringify(plans).includes('"Admin"'), false);
  assertNoDemoHosts(plans);
  assertNoAngleBracket(plans);
});

test('forbidden edit-button disabled true → forbidden-action PASS; never executable click', () => {
  const rule: RolePermissionRule = {
    role: 'User',
    effect: 'forbidden',
    controlKind: 'edit-button',
  };
  const plans = buildRolePermissionPlans({
    roles: ['User'],
    rules: [rule],
    elements: [
      {
        elementId: 'UI-EDIT',
        screenId: 'SCREEN-001',
        type: 'edit-button',
        accessibleName: 'Edit',
        disabled: true,
      },
    ],
  });

  const forbidden = plans.find((p) => p.subcaseId === 'role-forbidden-action');
  assert.ok(forbidden);
  assert.equal(forbidden!.status, 'PASS');
  assert.match(forbidden!.reason ?? '', /disabled/i);
  assert.equal(forbidden!.executable, false);
  assert.equal(forbidden!.action, 'observe');
  assertNeverExecutable(plans);
  assertNoDemoHosts(plans);
  assertNoAngleBracket(plans);
});

test('forbidden edit-button present, disabled omitted → FAIL usable', () => {
  const plans = buildRolePermissionPlans({
    roles: ['User'],
    rules: [{ role: 'User', effect: 'forbidden', controlKind: 'edit-button' }],
    elements: [
      {
        elementId: 'UI-EDIT',
        screenId: 'SCREEN-001',
        type: 'edit-button',
        accessibleName: 'Edit item',
      },
    ],
  });

  const forbidden = plans.find((p) => p.subcaseId === 'role-forbidden-action');
  assert.ok(forbidden);
  assert.equal(forbidden!.status, 'FAIL');
  assert.match(forbidden!.reason ?? '', /usable/i);
  assertNeverExecutable(plans);
});

test('api rule expectedStatus 403, no actual → NOT_TESTED; no fake actual status stored', () => {
  // Prove evaluateHttpStatus would FAIL if fed a fake null actual — planner must not do that.
  const ifFakeActual = evaluateHttpStatus({ expected: 403, actual: null });
  assert.equal(ifFakeActual.result, 'FAIL');
  assert.match(ifFakeActual.reason, /actual status was not recorded/);

  const plans = buildRolePermissionPlans({
    roles: ['User'],
    rules: [{ role: 'User', effect: 'forbidden', api: true, expectedStatus: 403 }],
  });

  assert.equal(plans.length, 1);
  const api = plans[0]!;
  assert.equal(api.subcaseId, 'role-api-authorization');
  assert.equal(api.status, 'NOT_TESTED');
  assert.match(api.reason ?? '', /API authorization was not executed/);
  assert.match(api.reason ?? '', /403 was not sent/);
  assert.equal(api.metadata?.authorizationRelated, true);
  assert.equal(api.metadata?.actualStatus, undefined);
  assert.equal(api.metadata?.expectedStatus, 403);
  assert.doesNotMatch(JSON.stringify(plans), /"actualStatus":\s*403/);
  assert.doesNotMatch(JSON.stringify(plans), /"actual":\s*403/);
  assertNeverExecutable(plans);
});

test('api rule without expectedStatus → reason contains SPECIFICATION_REQUIRED', () => {
  const plans = buildRolePermissionPlans({
    roles: ['User'],
    rules: [{ role: 'User', effect: 'forbidden', api: true }],
  });
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.status, 'NOT_TESTED');
  assert.match(plans[0]?.reason ?? '', new RegExp(SPECIFICATION_REQUIRED));
  assert.match(plans[0]?.reason ?? '', /expected status was not specified/);
  assert.equal(plans[0]?.metadata?.authorizationRelated, true);
  assertNeverExecutable(plans);
});

test('role Manager with no rules does not get a forbidden edit PASS', () => {
  const plans = buildRolePermissionPlans({
    roles: ['Manager'],
    rules: [],
    elements: [
      {
        elementId: 'UI-EDIT',
        screenId: 'SCREEN-001',
        type: 'edit-button',
        accessibleName: 'Edit',
        disabled: true,
      },
    ],
  });
  assert.equal(plans.length, 5);
  assert.equal(
    plans.some((p) => p.status === 'PASS'),
    false
  );
  const forbidden = plans.find((p) => p.subcaseId === 'role-forbidden-action');
  assert.ok(forbidden);
  assert.equal(forbidden!.status, 'NOT_TESTED');
  assert.match(forbidden!.reason ?? '', new RegExp(SPECIFICATION_REQUIRED));
  assertNeverExecutable(plans);
});

test('rule role not in configured list → NOT_TESTED ignored row', () => {
  const plans = buildRolePermissionPlans({
    roles: ['User'],
    rules: [{ role: 'Admin', effect: 'forbidden', controlKind: 'edit-button' }],
  });
  assert.ok(plans.some((p) => p.subcaseId === 'role-rule-unknown-role'));
  const ignored = plans.find((p) => p.subcaseId === 'role-rule-unknown-role');
  assert.equal(ignored?.status, 'NOT_TESTED');
  assert.match(ignored?.reason ?? '', /rule role is not in the configured role list/);
  // User still gets five unconfigured rows
  assert.equal(plans.filter((p) => p.role === 'User').length, 5);
  assert.equal(JSON.stringify(plans).includes('Super Admin'), false);
});

test('production without authorize flags blocks forbidden API and direct URL; observe UI may remain', () => {
  const plans = buildRolePermissionPlans({
    roles: ['User'],
    rules: [
      { role: 'User', effect: 'forbidden', api: true, expectedStatus: 403 },
      { role: 'User', effect: 'forbidden', url: 'http://app.test/secret' },
      { role: 'User', effect: 'forbidden', controlKind: 'edit-button' },
    ],
    elements: [
      {
        elementId: 'UI-EDIT',
        screenId: 'SCREEN-001',
        type: 'edit-button',
        accessibleName: 'Edit',
        disabled: true,
      },
    ],
    screens: [{ id: 'SCREEN-001', url: 'http://app.test/secret' }],
    options: { environment: 'production', authorizeDestructive: false },
  });

  const api = plans.find((p) => p.subcaseId === 'role-api-authorization');
  const url = plans.find((p) => p.subcaseId === 'role-direct-url');
  const forbidden = plans.find((p) => p.subcaseId === 'role-forbidden-action');
  assert.equal(api?.status, 'BLOCKED');
  assert.match(api?.reason ?? '', /not authorized against production/);
  assert.equal(url?.status, 'BLOCKED');
  assert.equal(forbidden?.status, 'PASS');
  assertNeverExecutable(plans);
  assertNoDemoHosts(plans);
  assertNoAngleBracket(plans);
});

test('allowed control present → PLANNED observe; disabled → FAIL', () => {
  const planned = buildRolePermissionPlans({
    roles: ['User'],
    rules: [{ role: 'User', effect: 'allowed', controlKind: 'edit-button' }],
    elements: [
      {
        elementId: 'UI-EDIT',
        screenId: 'SCREEN-001',
        type: 'edit-button',
        accessibleName: 'Edit',
      },
    ],
  });
  assert.equal(planned[0]?.status, 'PLANNED');
  assert.equal(planned[0]?.action, 'observe');
  assert.match(planned[0]?.expect?.note ?? '', /control is present/);

  const failed = buildRolePermissionPlans({
    roles: ['User'],
    rules: [{ role: 'User', effect: 'allowed', controlKind: 'edit-button' }],
    elements: [
      {
        elementId: 'UI-EDIT',
        screenId: 'SCREEN-001',
        type: 'edit-button',
        accessibleName: 'Edit',
        disabled: true,
      },
    ],
  });
  assert.equal(failed[0]?.status, 'FAIL');
  assert.match(failed[0]?.reason ?? '', /allowed control is disabled/);
});

test('evaluateHttpStatus is used only when both expected and actual exist', () => {
  const plans = buildRolePermissionPlans({
    roles: ['User'],
    rules: [{ role: 'User', effect: 'forbidden', api: true, expectedStatus: 403 }],
    options: {
      actualStatusByRule: new Map([['User:forbidden:::api=true:0', 403]]),
    },
  });
  assert.equal(plans[0]?.status, 'PASS');
  assert.equal(plans[0]?.metadata?.actualStatus, 403);
  assert.match(plans[0]?.reason ?? '', /matches expected 403/);
});
