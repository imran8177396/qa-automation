import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannedChecksToCoverageItems, summarizeScenarioInventory } from './planned-scenario-items';

test('planned scenario rows feed coverage items; unexecuted PLANNED stay executable not TESTED', () => {
  const items = plannedChecksToCoverageItems([
    {
      id: 'INV-0001',
      kind: 'visibility',
      title: 'field — positive visible',
      targetUrl: 'http://app.test/a',
      status: 'PLANNED',
      scenarioKind: 'positive',
      purpose: 'text-input',
      action: 'observe',
      expect: { locator: '#a' },
    },
    {
      id: 'INV-0002',
      kind: 'boundary-values',
      title: 'field — edge',
      targetUrl: 'http://app.test/a',
      status: 'NOT_APPLICABLE',
      scenarioKind: 'edge',
      purpose: 'text-input',
      reason: 'NOT_APPLICABLE: no boundary constraint discovered',
    },
    {
      id: 'INV-0003',
      kind: 'form-submit',
      title: 'submit — safety',
      targetUrl: 'http://app.test/a',
      status: 'BLOCKED',
      scenarioKind: 'positive',
      purpose: 'button',
      reason: 'BLOCKED: no submit',
    },
  ]);

  assert.equal(items.length, 3);
  const planned = items.find((i) => i.id === 'SCN-INV-0001');
  assert.ok(planned);
  assert.equal(planned?.applicableScenarios[0]?.disposition, 'executable');
  assert.equal(planned?.applicableScenarios[0]?.tested, false);

  const na = items.find((i) => i.id === 'SCN-INV-0002');
  assert.equal(na?.coverageHint, 'not-applicable');

  const blocked = items.find((i) => i.id === 'SCN-INV-0003');
  assert.equal(blocked?.applicableScenarios[0]?.disposition, 'blocked-safety');
});

test('legacy planned checks without scenarioKind do not create scenario coverage items', () => {
  const items = plannedChecksToCoverageItems([
    {
      id: 'CHK-1',
      kind: 'page-sanity',
      title: 'load',
      targetUrl: 'http://app.test/',
      status: 'PLANNED',
    },
  ]);
  assert.equal(items.length, 0);
});

test('summarizeScenarioInventory counts kinds without claiming coverage', () => {
  const summary = summarizeScenarioInventory([
    {
      id: 'INV-1',
      kind: 'visibility',
      title: 'p',
      targetUrl: 'http://x/',
      status: 'PLANNED',
      scenarioKind: 'positive',
    },
    {
      id: 'INV-2',
      kind: 'visibility',
      title: 'n',
      targetUrl: 'http://x/',
      status: 'NOT_TESTED',
      scenarioKind: 'negative',
      reason: 'NOT_TESTED: demo',
    },
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.planned, 1);
  assert.equal(summary.gated, 1);
  assert.equal(summary.byKind.positive, 1);
  assert.equal(summary.byKind.negative, 1);
});
