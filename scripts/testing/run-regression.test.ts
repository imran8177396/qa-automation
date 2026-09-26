import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planRegression, type RegressionSuiteId } from './run-regression';

const SUITE_IDS: RegressionSuiteId[] = ['unit', 'api', 'e2e'];

function byId(results: ReturnType<typeof planRegression>) {
  return new Map(results.map((row) => [row.id, row]));
}

test('selective with no include override → unit planned, api and e2e NOT_TESTED outside mode', () => {
  const results = planRegression({ mode: 'selective' });
  assert.equal(results.length, 3);
  const map = byId(results);

  for (const id of SUITE_IDS) {
    assert.ok(map.has(id), `missing suite row ${id}`);
    assert.equal(map.get(id)!.testType, 'regression');
  }

  const unit = map.get('unit')!;
  assert.equal(unit.status, 'NOT_TESTED');
  assert.equal(unit.metadata?.planned, true);
  assert.match(unit.error?.message ?? '', /planned for execution/i);

  for (const id of ['api', 'e2e'] as const) {
    const row = map.get(id)!;
    assert.equal(row.status, 'NOT_TESTED');
    assert.notEqual(row.metadata?.planned, true);
    assert.match(row.error?.message ?? '', /outside this regression mode/i);
    assert.doesNotMatch(row.error?.message ?? '', /\bPASS\b/);
    assert.notEqual(row.status, 'PASS');
  }
});

test('full without include → same unit-only default (full does not imply qa:all)', () => {
  const results = planRegression({ mode: 'full' });
  assert.equal(results.length, 3);
  const map = byId(results);

  assert.equal(map.get('unit')!.metadata?.planned, true);
  assert.equal(map.get('unit')!.status, 'NOT_TESTED');
  assert.match(map.get('api')!.error?.message ?? '', /outside this regression mode/i);
  assert.match(map.get('e2e')!.error?.message ?? '', /outside this regression mode/i);
  assert.notEqual(map.get('api')!.status, 'PASS');
  assert.notEqual(map.get('e2e')!.status, 'PASS');
});

test('change-based → NOT_TESTED and message includes not implemented', () => {
  const results = planRegression({ mode: 'change-based' });
  assert.equal(results.length, 3);
  for (const row of results) {
    assert.equal(row.status, 'NOT_TESTED');
    assert.equal(row.testType, 'regression');
    assert.match(row.error?.message ?? '', /not implemented/i);
  }
});

test('risk-based → NOT_TESTED and message includes not implemented', () => {
  const results = planRegression({ mode: 'risk-based' });
  assert.equal(results.length, 3);
  for (const row of results) {
    assert.equal(row.status, 'NOT_TESTED');
    assert.equal(row.testType, 'regression');
    assert.match(row.error?.message ?? '', /not implemented/i);
  }
});

test('engine id / testType is regression — not retest', () => {
  const results = planRegression({ mode: 'selective' });
  for (const row of results) {
    assert.equal(row.testType, 'regression');
    assert.notEqual(row.testType, 'retest');
    assert.notEqual(row.id, 'retest');
  }
});
