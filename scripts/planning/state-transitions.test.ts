import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSafetyConfig } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import { buildScenarioInventory } from './scenario-inventory';
import {
  MAX_INVALID_PAIRS,
  buildStateTransitionPlans,
  type StateMachineSpec,
  type StateTransitionPlan,
} from './state-transitions';

function assertNoDemoHosts(value: unknown): void {
  const blob = JSON.stringify(value);
  assert.equal(/saucedemo|jsonplaceholder|swag\s*labs|inventory\.html|example\.com/i.test(blob), false);
}

function assertNeverExecutable(plans: StateTransitionPlan[]): void {
  for (const plan of plans) {
    assert.equal(plan.executable, false);
    assert.notEqual(plan.action, 'click-button');
    assert.notEqual(plan.action, 'click-link');
    assert.notEqual(plan.status, 'PASS');
  }
}

test('empty input → one NOT_TESTED; body does not contain Pending or Paid', () => {
  const plans = buildStateTransitionPlans({});
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.subcaseId, 'state-transition-none');
  assert.equal(plans[0]?.status, 'NOT_TESTED');
  assert.match(plans[0]?.reason ?? '', /state machine was not represented in discovery or configuration/);
  const blob = JSON.stringify(plans);
  assert.equal(blob.includes('Pending'), false);
  assert.equal(blob.includes('Paid'), false);
  assert.equal(blob.includes('Processing'), false);
  assert.equal(blob.includes('Completed'), false);
  assertNeverExecutable(plans);
  assertNoDemoHosts(plans);
});

test('null machines and single label → none row, not Pending/Paid', () => {
  const plans = buildStateTransitionPlans({
    machines: null,
    observedStatusLabels: ['Open'],
  });
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.subcaseId, 'state-transition-none');
  assert.equal(JSON.stringify(plans).includes('Pending'), false);
  assert.equal(JSON.stringify(plans).includes('Paid'), false);
});

test('labels ["Open","Closed"] and no machine → states recorded, initial/invalid NOT_TESTED, no invented Open→Closed allowed', () => {
  const plans = buildStateTransitionPlans({
    observedStatusLabels: ['Open', 'Closed'],
  });

  const observed = plans.find((p) => p.subcaseId === 'state-observed');
  assert.ok(observed);
  assert.deepEqual(observed!.metadata?.representedStates, ['Open', 'Closed']);
  assert.match(observed!.expect?.note ?? '', /Open.*Closed/);

  const initial = plans.find((p) => p.subcaseId === 'state-initial');
  assert.ok(initial);
  assert.equal(initial!.status, 'NOT_TESTED');
  assert.match(initial!.reason ?? '', /initial state was not identified/);

  const actions = plans.find((p) => p.subcaseId === 'state-actions');
  assert.ok(actions);
  assert.equal(actions!.status, 'NOT_TESTED');
  assert.match(actions!.reason ?? '', /actions that cause transitions were not recorded/);

  const invalid = plans.find((p) => p.subcaseId === 'state-invalid-unconfigured');
  assert.ok(invalid);
  assert.equal(invalid!.status, 'NOT_TESTED');
  assert.match(invalid!.reason ?? '', /allowed transitions were not configured/);

  assert.equal(
    plans.some((p) => p.subcaseId.startsWith('state-allowed-')),
    false,
    'must not invent Open→Closed as allowed'
  );
  assertNeverExecutable(plans);
  assertNoDemoHosts(plans);
});

test('configured machine: allowed observe rows, invalid includes Completed→Pending/Paid, Pending→Paid not also invalid', () => {
  const machine: StateMachineSpec = {
    componentId: 'order',
    initial: 'Pending',
    states: ['Pending', 'Paid', 'Completed'],
    transitions: [
      { from: 'Pending', to: 'Paid' },
      { from: 'Paid', to: 'Completed' },
    ],
  };

  const plans = buildStateTransitionPlans({ machines: [machine] });

  const allowedPendingPaid = plans.find((p) => p.subcaseId === 'state-allowed-Pending-Paid');
  const allowedPaidCompleted = plans.find((p) => p.subcaseId === 'state-allowed-Paid-Completed');
  assert.ok(allowedPendingPaid);
  assert.ok(allowedPaidCompleted);
  assert.equal(allowedPendingPaid!.status, 'PLANNED');
  assert.equal(allowedPendingPaid!.action, 'none');
  assert.match(allowedPendingPaid!.reason ?? '', /not executed/);
  assert.equal(allowedPaidCompleted!.status, 'PLANNED');
  assert.match(allowedPaidCompleted!.reason ?? '', /not executed/);

  const invalidCompletedPending = plans.find((p) => p.subcaseId === 'state-invalid-Completed-Pending');
  const invalidCompletedPaid = plans.find((p) => p.subcaseId === 'state-invalid-Completed-Paid');
  assert.ok(invalidCompletedPending);
  assert.ok(invalidCompletedPaid);
  assert.equal(invalidCompletedPending!.status, 'PLANNED');
  assert.match(invalidCompletedPending!.reason ?? '', /not performed/);
  assert.equal(invalidCompletedPaid!.status, 'PLANNED');

  assert.equal(
    plans.some((p) => p.subcaseId === 'state-invalid-Pending-Paid'),
    false,
    'Pending→Paid must not also appear as invalid'
  );

  assertNeverExecutable(plans);
  assertNoDemoHosts(plans);
});

test('initial not in states → NOT_TESTED, no allowed rows', () => {
  const plans = buildStateTransitionPlans({
    machines: [
      {
        componentId: 'ticket',
        initial: 'Draft',
        states: ['Open', 'Closed'],
        transitions: [{ from: 'Open', to: 'Closed' }],
      },
    ],
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.subcaseId, 'state-initial-missing');
  assert.equal(plans[0]?.status, 'NOT_TESTED');
  assert.match(plans[0]?.reason ?? '', /initial state is not in the represented states/);
  assert.equal(plans.some((p) => p.subcaseId.startsWith('state-allowed-')), false);
  assertNeverExecutable(plans);
  assertNoDemoHosts(plans);
});

test('self-transitions count toward invalid cap; allowed self is not invalid', () => {
  const states = Array.from({ length: 5 }, (_, i) => `S${i}`);
  const machine: StateMachineSpec = {
    componentId: 'cap',
    initial: 'S0',
    states,
    transitions: [{ from: 'S0', to: 'S0' }],
  };
  // 5×5 = 25 pairs; 1 allowed → 24 invalid; cap 12 + 1 overflow row
  const plans = buildStateTransitionPlans({ machines: [machine] });
  const invalid = plans.filter((p) => p.subcaseId.startsWith('state-invalid-') && p.subcaseId !== 'state-invalid-cap');
  assert.equal(invalid.length, MAX_INVALID_PAIRS);
  assert.ok(plans.some((p) => p.subcaseId === 'state-invalid-cap'));
  assert.equal(plans.some((p) => p.subcaseId === 'state-invalid-S0-S0'), false);
  assert.ok(plans.some((p) => p.subcaseId === 'state-allowed-S0-S0'));
});

test('executeInvalid true still never clicks; invalid rows are NOT_TESTED', () => {
  const plans = buildStateTransitionPlans({
    machines: [
      {
        componentId: 'flow',
        initial: 'A',
        states: ['A', 'B'],
        transitions: [{ from: 'A', to: 'B' }],
      },
    ],
    executeInvalid: true,
  });
  const invalid = plans.filter((p) => p.subcaseId.startsWith('state-invalid-'));
  assert.ok(invalid.length > 0);
  for (const row of invalid) {
    assert.equal(row.status, 'NOT_TESTED');
    assert.equal(row.action, 'none');
  }
  assertNeverExecutable(plans);
});

test('scenario-inventory default options emit no state-transition rows and no Order machine', () => {
  const checks = buildScenarioInventory(
    {
      generatedAt: new Date().toISOString(),
      seedUrl: 'http://app.test/',
      scopeHost: 'app.test',
      truncated: false,
      pages: [
        {
          url: 'http://app.test/',
          route: '/',
          title: 'Home',
          status: 200,
          ok: true,
          depth: 0,
          h1s: ['Home'],
          applicableTestTypes: applicableTestTypes('pages'),
        },
      ],
      routes: [{ path: '/', url: 'http://app.test/', title: 'Home', source: 'crawl' }],
      navigation: [],
      skippedByScope: [],
      categoryStatus: [],
    },
    {
      generatedAt: new Date().toISOString(),
      seedUrl: 'http://app.test/',
      pagesScanned: 1,
      elements: [],
      categoryStatus: [],
    },
    resolveSafetyConfig()
  );

  assert.equal(checks.some((c) => c.scenarioKind === 'state-transition'), false);
  const blob = JSON.stringify(checks);
  assert.equal(blob.includes('Pending'), false);
  assert.equal(blob.includes('Paid'), false);
  assert.equal(blob.includes('Processing'), false);
});
