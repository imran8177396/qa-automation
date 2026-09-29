import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths';
import {
  deduplicateTestCases,
  equivalenceKey,
  normalizeScenario,
  type DedupableTestCase,
} from './test-case-uniqueness';

function baseCase(overrides: Partial<DedupableTestCase> = {}): DedupableTestCase {
  return {
    id: 'SRC-KEEP',
    screenId: 'SCREEN-1',
    elementId: 'EL-EMAIL',
    category: 'negative',
    action: 'fill-no-submit',
    status: 'PLANNED',
    input: 'userexample.com',
    ...overrides,
  };
}

test('three equivalent titles + same input → 1 case, invalid-format, duplicateCount 2', () => {
  const cases: DedupableTestCase[] = [
    baseCase({ id: 'SRC-A', title: 'Enter invalid email' }),
    baseCase({ id: 'TC-002', title: 'Enter malformed email' }),
    baseCase({ id: 'SRC-C', title: 'Enter incorrect email format' }),
  ];
  const { kept, removed } = deduplicateTestCases(cases);
  assert.equal(kept.length, 1);
  assert.equal(removed, 2);
  assert.equal(kept[0]?.scenario, 'invalid-format');
  assert.equal(kept[0]?.duplicateCount, 2);
  assert.equal(kept[0]?.testCaseId, 'SRC-A');
  assert.equal(kept.some((c) => c.testCaseId === 'TC-002'), false);
  assert.equal(kept[0]?.expectedResult, 'PLANNED');
  assert.notEqual(kept[0]?.expectedResult, 'PASS');
});

test('different inputs stay distinct (missing-@ vs double-@)', () => {
  const cases: DedupableTestCase[] = [
    baseCase({ id: 'missing', title: 'Enter invalid email', input: 'userexample.com' }),
    baseCase({ id: 'missing-2', title: 'Enter malformed email', input: 'userexample.com' }),
    baseCase({ id: 'missing-3', title: 'Enter incorrect email format', input: 'userexample.com' }),
    baseCase({ id: 'double', title: 'Enter invalid email', input: 'user@@example.com' }),
  ];
  const { kept, removed } = deduplicateTestCases(cases);
  assert.equal(kept.length, 2);
  assert.equal(removed, 2);
  const byInput = Object.fromEntries(kept.map((c) => [c.input, c]));
  assert.equal(byInput['userexample.com']?.duplicateCount, 2);
  assert.equal(byInput['user@@example.com']?.duplicateCount, 0);
  assert.equal(byInput['user@@example.com']?.testCaseId, 'double');
});

test('email fixture identities stay distinct when inputs differ', () => {
  const cases: DedupableTestCase[] = [
    baseCase({
      id: 'neg-missing-at',
      title: 'Email — negative-missing-at (missing @)',
      input: 'userexample.com',
    }),
    baseCase({
      id: 'neg-spaces',
      title: 'Email — negative-spaces (spaces)',
      input: 'user @example.com',
    }),
    baseCase({
      id: 'neg-double',
      title: 'Email — negative-double-at (double @)',
      input: 'user@@example.com',
    }),
  ];
  const { kept, removed } = deduplicateTestCases(cases);
  assert.equal(kept.length, 3);
  assert.equal(removed, 0);
  assert.notEqual(equivalenceKey(cases[0]!), equivalenceKey(cases[1]!));
  assert.match(kept[0]?.scenario ?? '', /missing-at|missing/);
  assert.match(kept[1]?.scenario ?? '', /spaces/);
});

test('priority unspecified when the source omitted it', () => {
  const { kept } = deduplicateTestCases([baseCase({ title: 'Enter invalid email' })]);
  assert.equal(kept[0]?.priority, 'unspecified');
  assert.equal(kept[0]?.risk, 'unspecified');
  assert.equal(kept[0]?.priorityRuleId, 'none');
  assert.equal(
    Object.prototype.hasOwnProperty.call(kept[0], 'qualityScore'),
    false
  );
});

test('priority and risk only accepted when critical|high|medium|low', () => {
  const { kept } = deduplicateTestCases([
    baseCase({
      title: 'Enter invalid email',
      priority: 'high',
      risk: 'urgent',
    }),
  ]);
  assert.equal(kept[0]?.priority, 'high');
  assert.equal(kept[0]?.risk, 'unspecified');
  // Source priority wins — assignTestPriority is not applied to overwrite it.
  assert.equal(kept[0]?.priorityRuleId, undefined);
});

test('login scenarioKind gets explainable critical priority when source omitted it', () => {
  const { kept } = deduplicateTestCases([
    baseCase({
      id: 'login-row',
      title: 'Auth — login-wrong-password',
      scenarioKind: 'login',
      category: 'login',
      elementType: 'password-input',
      input: null,
    }),
  ]);
  assert.equal(kept[0]?.priority, 'critical');
  assert.equal(kept[0]?.priorityRuleId, 'auth');
  assert.equal(kept[0]?.priorityReason, 'authentication case');
  assert.equal(
    Object.prototype.hasOwnProperty.call(kept[0], 'qualityScore'),
    false
  );
});

test('source priority high is not overwritten by delete-button signals', () => {
  const { kept } = deduplicateTestCases([
    baseCase({
      title: 'Delete row',
      priority: 'high',
      elementType: 'delete-button',
      scenarioKind: 'button',
      input: null,
    }),
  ]);
  assert.equal(kept[0]?.priority, 'high');
  assert.equal(kept[0]?.priorityRuleId, undefined);
});

test('steps do not contain Submit', () => {
  const { kept } = deduplicateTestCases([
    baseCase({ title: 'Enter invalid email', action: 'fill-no-submit' }),
  ]);
  assert.equal(kept[0]?.steps.length, 1);
  assert.match(kept[0]?.steps[0] ?? '', /Fill the field with the recorded input\. Do not submit\./);
  // No submit action step (capital Submit); "Do not submit." is required.
  assert.equal(/\bSubmit\b/.test(kept[0]?.steps.join(' ') ?? ''), false);
});

test('observe and none/blocked steps', () => {
  const observe = deduplicateTestCases([
    baseCase({ title: 'Observe field', action: 'observe', input: null }),
  ]).kept[0];
  assert.match(observe?.steps[0] ?? '', /Observe the recorded evidence/);
  assert.equal(/\bSubmit\b/.test(observe?.steps.join(' ') ?? ''), false);

  const none = deduplicateTestCases([
    baseCase({ title: 'Blocked case', action: 'none', status: 'BLOCKED' }),
  ]).kept[0];
  assert.equal(none?.steps[0], 'Do not execute.');
  assert.equal(none?.expectedResult, 'BLOCKED');
});

test('empty list → kept [] removed 0', () => {
  const { kept, removed, keptIndexes } = deduplicateTestCases([]);
  assert.deepEqual(kept, []);
  assert.equal(removed, 0);
  assert.deepEqual(keptIndexes, []);
});

test('preconditions default to none recorded; never invent login', () => {
  const { kept } = deduplicateTestCases([baseCase({ title: 'Enter invalid email' })]);
  assert.deepEqual(kept[0]?.preconditions, ['none recorded']);
  assert.equal(kept[0]?.preconditions.join(' ').toLowerCase().includes('logged in'), false);
});

test('expectedResult uses expect.note; never fabricates PASS', () => {
  const withNote = deduplicateTestCases([
    baseCase({
      title: 'Enter invalid email',
      status: 'PLANNED',
      expect: { note: 'constraint invalid; form not submitted', fillValue: 'userexample.com' },
      input: undefined,
    }),
  ]).kept[0];
  assert.equal(withNote?.expectedResult, 'constraint invalid; form not submitted');
  assert.equal(withNote?.input, 'userexample.com');
  assert.notEqual(withNote?.expectedResult, 'PASS');

  const onlyPassWhenSourcePass = deduplicateTestCases([
    baseCase({
      title: 'Enter invalid email',
      status: 'PASS',
      executionResult: 'PASS',
    }),
  ]).kept[0];
  assert.equal(onlyPassWhenSourcePass?.expectedResult, 'PASS');
});

test('normalizeScenario maps synonyms and preserves protected phrases', () => {
  assert.equal(normalizeScenario('Enter invalid email'), 'invalid-format');
  assert.equal(normalizeScenario('Enter malformed email'), 'invalid-format');
  assert.equal(normalizeScenario('Enter incorrect email format'), 'invalid-format');
  assert.equal(normalizeScenario('wrong format'), 'invalid-format');
  assert.match(normalizeScenario('negative-missing-at (missing @)'), /missing/);
  assert.match(normalizeScenario('negative-double-at (double @)'), /double/);
  assert.match(normalizeScenario('negative-spaces (spaces)'), /spaces/);
  assert.match(normalizeScenario('negative-too-short'), /too-short/);
  assert.match(normalizeScenario('subdomain positive'), /subdomain/);
  assert.notEqual(normalizeScenario('missing @'), 'invalid-format');
});

test('stable id prefers subcaseId over id; does not invent TC-001', () => {
  const { kept } = deduplicateTestCases([
    baseCase({
      id: 'INV-0009-negative-malformed',
      subcaseId: 'negative-malformed',
      title: 'Enter malformed email',
    }),
  ]);
  assert.equal(kept[0]?.testCaseId, 'negative-malformed');
  assert.equal(kept[0]?.testCaseId.startsWith('TC-'), false);
});

test('module has no demo hosts and no fabricated PASS defaults', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'test-case-uniqueness.ts'), 'utf8');
  assert.doesNotMatch(src, /saucedemo|swag.?labs|the-internet\.herokuapp|demo\.|example\.com\/login/i);
  assert.doesNotMatch(src, /expectedResult:\s*['"]PASS['"]/);
  assert.doesNotMatch(src, /priority:\s*['"]high['"]/);
});

test('kept cases always include quality with five non-empty answers', () => {
  const { kept } = deduplicateTestCases([baseCase({ title: 'Enter invalid email' })]);
  const q = kept[0]!.quality;
  assert.ok(q.what.trim().length > 0);
  assert.ok(q.why.trim().length > 0);
  assert.ok(q.how.trim().length > 0);
  assert.ok(q.expectedResult.trim().length > 0);
  assert.ok(q.distinction.trim().length > 0);
  assert.equal(typeof q.generic, 'boolean');
});
