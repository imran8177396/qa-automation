import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UniqueTestCase } from './test-case-uniqueness';
import {
  INPUT_COLLISION_NOTE,
  buildIdentityKey,
  loadPersistedTestCases,
  reconcileTestCases,
  savePersistedTestCases,
  testCaseIdFromIdentityKey,
  type PersistedTestCase,
} from './test-case-identity';

const NOW = '2026-09-26T12:00:00.000Z';
const LATER = '2026-09-26T18:00:00.000Z';

function sampleCase(overrides: Partial<UniqueTestCase> = {}): UniqueTestCase {
  return {
    testCaseId: 'planner-temp',
    screenId: 'SCREEN-1',
    elementId: 'EL-EMAIL',
    category: 'negative',
    scenario: 'empty',
    preconditions: ['none recorded'],
    steps: ['Fill the field with the recorded input. Do not submit.'],
    input: '',
    expectedResult: 'NOT_TESTED',
    priority: 'medium',
    risk: 'unspecified',
    duplicateCount: 0,
    quality: {
      what: 'empty email',
      why: 'negative coverage',
      how: 'fill without submit',
      expectedResult: 'NOT_TESTED',
      distinction: 'empty vs invalid-format',
      generic: false,
    },
    projectId: 'proj-a',
    behavior: 'fill-no-submit',
    ...overrides,
  };
}

test('same six fields twice → same TC- id', () => {
  const a = sampleCase({ testCaseId: 'A' });
  const b = sampleCase({ testCaseId: 'B' });
  const first = reconcileTestCases({ current: [a], previous: null, now: NOW });
  const second = reconcileTestCases({ current: [b], previous: null, now: LATER });
  assert.equal(first.cases[0]!.testCaseId, second.cases[0]!.testCaseId);
  assert.match(first.cases[0]!.testCaseId, /^TC-[0-9a-f]{12}$/);
  assert.equal(first.cases[0]!.testCaseId, testCaseIdFromIdentityKey(first.persisted[0]!.identityKey));
});

test('different scenario → different id', () => {
  const empty = sampleCase({ scenario: 'empty' });
  const invalid = sampleCase({ scenario: 'invalid-format' });
  const result = reconcileTestCases({
    current: [empty, invalid],
    previous: null,
    now: NOW,
  });
  assert.notEqual(result.cases[0]!.testCaseId, result.cases[1]!.testCaseId);
  assert.equal(result.cases.every((c) => /^TC-[0-9a-f]{12}$/.test(c.testCaseId)), true);
});

test('previous contains the key → lifecycle updated, id unchanged across now', () => {
  const current = [sampleCase()];
  const first = reconcileTestCases({ current, previous: null, now: NOW });
  const id = first.cases[0]!.testCaseId;
  const second = reconcileTestCases({
    current: [sampleCase({ testCaseId: 'should-be-replaced' })],
    previous: first.persisted,
    now: LATER,
  });
  assert.equal(second.cases[0]!.testCaseId, id);
  assert.equal(second.persisted[0]!.lifecycle, 'updated');
  assert.equal(second.persisted[0]!.firstSeen, NOW);
  assert.equal(second.persisted[0]!.lastSeen, LATER);
  assert.equal(second.deprecated.length, 0);
});

test('current adds a new scenario → lifecycle new; old one still updated', () => {
  const empty = sampleCase({ scenario: 'empty' });
  const first = reconcileTestCases({ current: [empty], previous: null, now: NOW });
  const second = reconcileTestCases({
    current: [sampleCase({ scenario: 'empty' }), sampleCase({ scenario: 'invalid-format' })],
    previous: first.persisted,
    now: LATER,
  });
  const byScenario = Object.fromEntries(second.persisted.map((p) => [p.scenario, p]));
  assert.equal(byScenario['empty']?.lifecycle, 'updated');
  assert.equal(byScenario['empty']?.testCaseId, first.cases[0]!.testCaseId);
  assert.equal(byScenario['invalid-format']?.lifecycle, 'new');
  assert.match(byScenario['invalid-format']!.testCaseId, /^TC-[0-9a-f]{12}$/);
  assert.equal(second.deprecated.length, 0);
});

test('current removes a scenario → deprecated stays in persisted; not PASS', () => {
  const first = reconcileTestCases({
    current: [sampleCase({ scenario: 'empty' }), sampleCase({ scenario: 'invalid-format' })],
    previous: null,
    now: NOW,
  });
  const removedId = first.cases.find((c) => c.scenario === 'invalid-format')!.testCaseId;
  const second = reconcileTestCases({
    current: [sampleCase({ scenario: 'empty' })],
    previous: first.persisted,
    now: LATER,
  });
  assert.equal(second.deprecated.length, 1);
  assert.equal(second.deprecated[0]!.lifecycle, 'deprecated');
  assert.equal(second.deprecated[0]!.testCaseId, removedId);
  assert.equal(second.deprecated[0]!.scenario, 'invalid-format');
  assert.ok(second.persisted.some((p) => p.lifecycle === 'deprecated' && p.testCaseId === removedId));
  assert.ok(second.persisted.some((p) => p.lifecycle === 'updated' && p.scenario === 'empty'));
  assert.notEqual(second.deprecated[0]!.lifecycle, 'PASS' as PersistedTestCase['lifecycle']);
  assert.doesNotMatch(JSON.stringify(second.deprecated), /"PASS"/);
});

test('two cases with identical six fields but different input → second key notes input suffix; ids differ', () => {
  const a = sampleCase({ input: 'userexample.com', testCaseId: 'first' });
  const b = sampleCase({ input: 'user@@example.com', testCaseId: 'second' });
  const result = reconcileTestCases({ current: [a, b], previous: null, now: NOW });
  assert.notEqual(result.cases[0]!.testCaseId, result.cases[1]!.testCaseId);
  assert.equal(result.cases[0]!.identityNote, undefined);
  assert.equal(result.cases[1]!.identityNote, INPUT_COLLISION_NOTE);
  assert.ok(result.persisted[1]!.identityKey.includes('user@@example.com'));
  assert.equal(
    result.persisted[0]!.identityKey,
    buildIdentityKey({
      projectId: 'proj-a',
      screenId: 'SCREEN-1',
      elementId: 'EL-EMAIL',
      behavior: 'fill-no-submit',
      category: 'negative',
      scenario: 'empty',
    })
  );
});

test('no Date.now in hash — fixed now only affects firstSeen/lastSeen', () => {
  const current = [sampleCase()];
  const a = reconcileTestCases({ current, previous: null, now: NOW });
  const b = reconcileTestCases({ current, previous: null, now: LATER });
  assert.equal(a.cases[0]!.testCaseId, b.cases[0]!.testCaseId);
  assert.equal(a.persisted[0]!.identityKey, b.persisted[0]!.identityKey);
  assert.equal(a.persisted[0]!.firstSeen, NOW);
  assert.equal(b.persisted[0]!.firstSeen, LATER);
});

test('previous null → all new; deprecated empty', () => {
  const result = reconcileTestCases({
    current: [sampleCase(), sampleCase({ scenario: 'spaces' })],
    previous: null,
    now: NOW,
  });
  assert.equal(result.persisted.every((p) => p.lifecycle === 'new'), true);
  assert.deepEqual(result.deprecated, []);
});

test('missing stored testCaseId falls back to hash', () => {
  const current = [sampleCase()];
  const key = buildIdentityKey({
    projectId: 'proj-a',
    screenId: 'SCREEN-1',
    elementId: 'EL-EMAIL',
    behavior: 'fill-no-submit',
    category: 'negative',
    scenario: 'empty',
  });
  const previous: PersistedTestCase[] = [
    {
      testCaseId: '   ',
      identityKey: key,
      projectId: 'proj-a',
      screenId: 'SCREEN-1',
      elementId: 'EL-EMAIL',
      behavior: 'fill-no-submit',
      category: 'negative',
      scenario: 'empty',
      lifecycle: 'new',
      firstSeen: NOW,
      lastSeen: NOW,
    },
  ];
  const result = reconcileTestCases({ current, previous, now: LATER });
  assert.equal(result.cases[0]!.testCaseId, testCaseIdFromIdentityKey(key));
  assert.equal(result.persisted[0]!.lifecycle, 'updated');
});

test('load/save round-trip; corrupt JSON throws and does not wipe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-identity-'));
  const filePath = path.join(dir, 'test-case-identities.json');
  assert.equal(loadPersistedTestCases(filePath), null);

  const first = reconcileTestCases({
    current: [sampleCase()],
    previous: null,
    now: NOW,
  });
  savePersistedTestCases(filePath, first.persisted);
  const loaded = loadPersistedTestCases(filePath);
  assert.ok(loaded);
  assert.equal(loaded!.length, 1);
  assert.equal(loaded![0]!.testCaseId, first.cases[0]!.testCaseId);

  fs.writeFileSync(filePath, '{not-json', 'utf8');
  assert.throws(
    () => loadPersistedTestCases(filePath),
    /Corrupt test-case identities JSON/
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{not-json');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('identity module source has no demo hosts or Date.now in hash path', () => {
  const src = fs.readFileSync(
    path.join(__dirname, 'test-case-identity.ts'),
    'utf8'
  );
  assert.doesNotMatch(src, /saucedemo|jsonplaceholder|the-internet\.herokuapp/i);
  assert.doesNotMatch(src, /Date\.now\s*\(/);
});
