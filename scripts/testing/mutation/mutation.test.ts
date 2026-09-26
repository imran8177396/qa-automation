/**
 * Unit tests for in-memory mutation helpers — no suite re-run, no file writes, no Stryker.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../../lib/paths';
import {
  mutateSnippet,
  planFileMutation,
  runMutationChecks,
} from './index';

test('disabled → NOT_APPLICABLE, score null', () => {
  const report = runMutationChecks({ enabled: false });
  assert.equal(report.status, 'NOT_APPLICABLE');
  assert.equal(report.score, null);
  assert.equal(report.generated, 0);
  assert.equal(report.killed, 0);
  assert.equal(report.survived, 0);
  assert.match(report.reason, /not enabled/i);
  assert.equal(report.cases[0]?.id, 'mutation:not-enabled');
});

test('mutateSnippet(return a + b) yields a - b and differs from original', () => {
  const original = 'return a + b';
  const result = mutateSnippet(original);
  assert.ok('mutant' in result);
  assert.ok(result.mutant.includes('a - b'));
  assert.notEqual(result.mutant, original);
});

test('snippet hello → NOT_TESTED, no file writes', () => {
  const before = fs.readdirSync(ROOT);
  const result = mutateSnippet('hello');
  assert.ok('status' in result);
  assert.equal(result.status, 'NOT_TESTED');
  assert.match(result.reason, /no controlled mutation pattern/i);
  const after = fs.readdirSync(ROOT);
  assert.deepEqual(after, before);
});

test('mixed detection → generated 2, killed 1, survived 1, score 50, FAIL', () => {
  const report = runMutationChecks({
    enabled: true,
    cases: [
      { id: 'm1', original: 'a + b', mutant: 'a - b', detected: true },
      { id: 'm2', original: 'x === y', mutant: 'x !== y', detected: false },
    ],
  });
  assert.equal(report.generated, 2);
  assert.equal(report.killed, 1);
  assert.equal(report.survived, 1);
  assert.equal(report.score, 50);
  assert.equal(report.status, 'FAIL');
  assert.match(report.reason, /survived/i);
  assert.match(report.reason, /not executed/i);
});

test('both detected → killed 2, survived 0, score 100, PASS with not executed', () => {
  const report = runMutationChecks({
    enabled: true,
    cases: [
      { id: 'm1', original: 'a + b', mutant: 'a - b', detected: true },
      { id: 'm2', original: 'x === y', mutant: 'x !== y', detected: true },
    ],
  });
  assert.equal(report.killed, 2);
  assert.equal(report.survived, 0);
  assert.equal(report.score, 100);
  assert.equal(report.status, 'PASS');
  assert.match(report.reason, /not executed/i);
});

test('one case without detected → score null, not 100', () => {
  const report = runMutationChecks({
    enabled: true,
    cases: [{ id: 'm1', original: 'a + b', mutant: 'a - b' }],
  });
  assert.equal(report.score, null);
  assert.notEqual(report.score, 100);
  assert.equal(report.status, 'NOT_TESTED');
  assert.match(report.reason, /detection was not run/i);
});

test('runSuite true → BLOCKED, score null', () => {
  const report = runMutationChecks({
    enabled: true,
    runSuite: true,
    cases: [{ id: 'm1', original: 'a + b', mutant: 'a - b', detected: true }],
  });
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.score, null);
  assert.match(report.reason, /test suite for mutation is not implemented/i);
});

test('planFileMutation remains NOT_IMPLEMENTED for project files', () => {
  const plan = planFileMutation();
  assert.equal(plan.status, 'NOT_IMPLEMENTED');
  assert.match(plan.reason, /mutation of project files is not implemented/i);
});

test('PR workflow file text does not contain test:mutation', () => {
  const workflowPath = path.join(ROOT, '.github', 'workflows', 'qa-automation.yml');
  const text = fs.readFileSync(workflowPath, 'utf8');
  assert.equal(text.includes('test:mutation'), false);
});

test('source does not contain stryker import', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  assert.equal(/stryker/i.test(source), false);
  assert.equal(/from ['"]@stryker/i.test(source), false);
  const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  assert.equal(/stryker/i.test(pkg), false);
});
