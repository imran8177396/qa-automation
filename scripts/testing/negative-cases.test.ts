import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNegativeCases } from './negative-cases';

const REQUIRED_IDS = [
  'missing',
  'null',
  'empty',
  'wrong-type',
  'invalid-enum',
  'invalid-format',
  'too-long',
  'too-short',
  'duplicate',
  'unauthorized',
  'forbidden',
  'malformed-json',
  'unexpected-field',
] as const;

test('buildNegativeCases emits required case ids (no network)', () => {
  const cases = buildNegativeCases({
    name: 'email',
    type: 'string',
    format: 'email',
    enumValues: ['a', 'b'],
    minLength: 2,
    maxLength: 10,
  });
  const ids = cases.map((c) => c.id);
  for (const suffix of REQUIRED_IDS) {
    assert.ok(
      ids.includes(`email:${suffix}`),
      `expected case id email:${suffix}`
    );
  }
  assert.equal(cases.length, REQUIRED_IDS.length);
});
