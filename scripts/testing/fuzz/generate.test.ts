/**
 * Unit tests for scripts/testing/fuzz — generation only; no network or payloads.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateFuzzInputs, FUZZ_VERY_LONG_LENGTH, type FuzzTarget } from './generate';

const REQUIRED_KINDS = [
  'very-long-string',
  'unicode',
  'special-characters',
  'null',
  'empty',
  'unexpected-type',
  'large-number',
  'negative-number',
  'malformed-json',
  'nested-object',
  'array',
  'boundary',
] as const;

const TARGETS: FuzzTarget[] = ['api', 'ui', 'form', 'database', 'security'];

const FORBIDDEN = /drop table|<script|ignore previous instructions|saucedemo|jsonplaceholder/i;

test('every required kind is present at least once', () => {
  const inputs = generateFuzzInputs();
  const kinds = new Set(inputs.map((i) => i.kind));
  for (const kind of REQUIRED_KINDS) {
    assert.ok(kinds.has(kind), `missing kind: ${kind}`);
  }
});

test('very-long-string length is exactly 10000', () => {
  const long = generateFuzzInputs().filter((i) => i.kind === 'very-long-string');
  assert.ok(long.length >= 1);
  for (const item of long) {
    assert.equal(typeof item.value, 'string');
    assert.equal((item.value as string).length, FUZZ_VERY_LONG_LENGTH);
    assert.equal((item.value as string).length, 10_000);
  }
});

test('each FuzzTarget returns a non-empty array', () => {
  for (const target of TARGETS) {
    const inputs = generateFuzzInputs(target);
    assert.ok(inputs.length > 0, `expected non-empty for ${target}`);
    assert.ok(inputs.every((i) => i.target === target));
  }
});

test('security notes include not an exploit or not executed', () => {
  const inputs = generateFuzzInputs('security');
  assert.ok(inputs.length > 0);
  for (const item of inputs) {
    assert.match(
      item.note,
      /not an exploit|not executed/i,
      `security note missing disclaimer: ${item.id}`
    );
  }
});

test('no forbidden exploit or fixture strings', () => {
  const all = [
    ...generateFuzzInputs(),
    ...TARGETS.flatMap((t) => generateFuzzInputs(t)),
  ];
  const serialized = JSON.stringify(all);
  assert.ok(!FORBIDDEN.test(serialized), 'catalog must not match forbidden pattern');
  assert.ok(!serialized.includes('<script'));
  assert.ok(!serialized.toLowerCase().includes('drop table'));
  assert.ok(!serialized.toLowerCase().includes('ignore previous instructions'));
});

test('malformed JSON values are strings that JSON.parse rejects', () => {
  const malformed = generateFuzzInputs().filter((i) => i.kind === 'malformed-json');
  assert.ok(malformed.length >= 2);
  for (const item of malformed) {
    assert.equal(typeof item.value, 'string');
    assert.throws(() => JSON.parse(item.value as string));
  }
});
