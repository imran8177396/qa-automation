import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoundaryCases } from './boundary-cases';

test('buildBoundaryCases emits min/max family and always-on ids (no network)', () => {
  const cases = buildBoundaryCases({ name: 'age', min: 1, max: 100 });
  const ids = new Set(cases.map((c) => c.id));

  for (const suffix of [
    'min',
    'min-1',
    'min+1',
    'max',
    'max-1',
    'max+1',
    '0',
    '-1',
    'null',
    'empty',
    'whitespace',
    'large',
    'special-chars',
    'unicode',
  ]) {
    assert.ok(ids.has(`age:${suffix}`), `expected case id age:${suffix}`);
  }
});

test('buildBoundaryCases still emits always-on ids when min/max omitted', () => {
  const cases = buildBoundaryCases({ name: 'token' });
  const ids = new Set(cases.map((c) => c.id));
  for (const suffix of ['0', '-1', 'null', 'empty', 'whitespace', 'large', 'special-chars', 'unicode']) {
    assert.ok(ids.has(`token:${suffix}`), `expected case id token:${suffix}`);
  }
  assert.equal(ids.has('token:min'), false);
  assert.equal(ids.has('token:max'), false);
});
