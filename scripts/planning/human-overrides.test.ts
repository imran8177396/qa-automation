import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths';
import {
  applyHumanOverrides,
  loadHumanOverridesDocument,
  type OverrideDocument,
} from './human-overrides';
import type { UniqueTestCase } from './test-case-uniqueness';

function sampleCase(overrides: Partial<UniqueTestCase> = {}): UniqueTestCase {
  return {
    testCaseId: 'negative-empty',
    screenId: 'SCREEN-1',
    elementId: 'EL-1',
    category: 'negative',
    scenario: 'empty',
    preconditions: ['none recorded'],
    steps: ['Fill the field with the recorded input. Do not submit.'],
    input: '',
    expectedResult: 'validation message',
    priority: 'medium',
    risk: 'unspecified',
    duplicateCount: 0,
    quality: {
      what: 'empty input',
      why: 'required field',
      how: 'fill-no-submit',
      expectedResult: 'validation message',
      distinction: 'empty vs filled',
      generic: false,
    },
    ...overrides,
  };
}

test('exclude with reason → case remains, excluded true, reason stored', () => {
  const cases = [sampleCase()];
  const doc: OverrideDocument = {
    version: '1',
    overrides: [
      {
        testCaseId: 'negative-empty',
        action: 'exclude',
        reason: 'duplicate of another case',
      },
    ],
  };
  const result = applyHumanOverrides(cases, doc);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0]?.excluded, true);
  assert.equal(result.cases[0]?.exclusionReason, 'duplicate of another case');
  assert.equal(result.excluded.length, 1);
  assert.equal(result.excluded[0]?.reason, 'duplicate of another case');
  assert.equal(result.rejected.length, 0);
  assert.ok(!('executable' in (result.cases[0] as object)));
  assert.notEqual(result.cases[0]?.expectedResult, 'PASS');
});

test('exclude without reason → case unchanged, rejected entry, not excluded', () => {
  const cases = [sampleCase()];
  const doc: OverrideDocument = {
    version: '1',
    overrides: [{ testCaseId: 'negative-empty', action: 'exclude' }],
  };
  const result = applyHumanOverrides(cases, doc);
  assert.equal(result.cases.length, 1);
  assert.notEqual(result.cases[0]?.excluded, true);
  assert.equal(result.excluded.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0]?.reason, 'exclude requires a recorded reason');
});

test('override priority to high → priority high, priorityReason mentions human override', () => {
  const cases = [sampleCase({ priority: 'low' })];
  const doc: OverrideDocument = {
    version: '1',
    overrides: [
      {
        testCaseId: 'negative-empty',
        action: 'override',
        priority: 'high',
      },
    ],
  };
  const result = applyHumanOverrides(cases, doc);
  assert.equal(result.cases[0]?.priority, 'high');
  assert.match(result.cases[0]?.priorityReason ?? '', /priority set by human override/);
  assert.ok(!('qualityScore' in (result.cases[0] as object)));
  assert.equal(result.rejected.length, 0);
});

test('override testData → input replaced', () => {
  const cases = [sampleCase({ input: 'old' })];
  const doc: OverrideDocument = {
    version: '1',
    overrides: [
      {
        testCaseId: 'negative-empty',
        action: 'override',
        testData: 'human-fixture',
      },
    ],
  };
  const result = applyHumanOverrides(cases, doc);
  assert.equal(result.cases[0]?.input, 'human-fixture');
});

test('authorization allow → humanAuthorization allow, and no field executable true', () => {
  const cases = [sampleCase()];
  const doc: OverrideDocument = {
    version: '1',
    overrides: [
      {
        testCaseId: 'negative-empty',
        action: 'override',
        authorization: 'allow',
      },
    ],
  };
  const result = applyHumanOverrides(cases, doc);
  assert.equal(result.cases[0]?.humanAuthorization, 'allow');
  assert.ok(!('executable' in (result.cases[0] as object)));
  assert.notEqual((result.cases[0] as { executable?: boolean }).executable, true);
});

test('unknown id → unmatched, cases length unchanged', () => {
  const cases = [sampleCase()];
  const doc: OverrideDocument = {
    version: '1',
    overrides: [
      {
        testCaseId: 'does-not-exist',
        action: 'exclude',
        reason: 'n/a',
      },
    ],
  };
  const result = applyHumanOverrides(cases, doc);
  assert.equal(result.cases.length, 1);
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0]?.reason, 'no generated test case with this id');
  assert.notEqual(result.cases[0]?.excluded, true);
});

test('null document → cases unchanged', () => {
  const cases = [sampleCase({ input: 'keep-me' })];
  const result = applyHumanOverrides(cases, null);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0]?.input, 'keep-me');
  assert.equal(result.excluded.length, 0);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.rejected.length, 0);
});

test('later include after exclude re-includes and records include reason', () => {
  const cases = [sampleCase()];
  const doc: OverrideDocument = {
    version: '1',
    overrides: [
      {
        testCaseId: 'negative-empty',
        action: 'exclude',
        reason: 'temporary',
      },
      {
        testCaseId: 'negative-empty',
        action: 'include',
        reason: 'needed after all',
      },
    ],
  };
  const result = applyHumanOverrides(cases, doc);
  assert.equal(result.cases[0]?.excluded, false);
  assert.equal(result.cases[0]?.exclusionReason, 'included by human override');
  assert.equal(result.excluded.length, 0);
});

test('module source has no demo hosts', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'human-overrides.ts'), 'utf8');
  assert.doesNotMatch(src, /saucedemo|jsonplaceholder|the-internet\.herokuapp|demoqa/i);
  assert.doesNotMatch(src, /\/users\/create/);
});

test('loadHumanOverridesDocument: absent file → null document', () => {
  const missing = path.join(ROOT, 'qa.generated-overrides.does-not-exist.json');
  const loaded = loadHumanOverridesDocument(missing);
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.document, null);
  }
});
