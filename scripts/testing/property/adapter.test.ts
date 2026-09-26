/**
 * Unit tests for the property sample adapter — no fast-check, no network.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  BuiltinSampleAdapter,
  FastCheckAdapter,
  roundTripProperty,
  runPropertyChecks,
  sortingAdjacentProperty,
} from './index';

const reverse = (s: string): string => s.split('').reverse().join('');

test('builtin sorting property PASS on [[3,1,2],[5,5]]', async () => {
  const adapter = new BuiltinSampleAdapter();
  const result = await adapter.run(sortingAdjacentProperty([[3, 1, 2], [5, 5]]));
  assert.equal(result.status, 'PASS');
  assert.match(result.reason, /all 2 samples satisfied/);
  assert.equal(result.counterexample, undefined);
});

test('builtin FAIL returns counterexample and status FAIL not PASS', async () => {
  const adapter = new BuiltinSampleAdapter();
  const result = await adapter.run({
    name: 'adjacent ordered without sorting',
    samples: [[2, 1]],
    predicate: (arr) => arr[0]! <= arr[1]!,
  });
  assert.equal(result.status, 'FAIL');
  assert.notEqual(result.status, 'PASS');
  assert.equal(result.reason, 'property failed');
  assert.deepEqual(result.counterexample, [2, 1]);
});

test('empty samples → NOT_TESTED', async () => {
  const adapter = new BuiltinSampleAdapter();
  const result = await adapter.run(sortingAdjacentProperty([]));
  assert.equal(result.status, 'NOT_TESTED');
  assert.equal(result.reason, 'no samples were supplied');
});

test('round-trip reverse/reverse PASS; broken encode FAIL', async () => {
  const adapter = new BuiltinSampleAdapter();

  const pass = await adapter.run(roundTripProperty(['ab', 'a'], reverse, reverse));
  assert.equal(pass.status, 'PASS');

  const fail = await adapter.run(
    roundTripProperty(['ab'], (s) => `${s}x`, (s) => s)
  );
  assert.equal(fail.status, 'FAIL');
  assert.equal(fail.reason, 'property failed');
  assert.equal(fail.counterexample, 'ab');
});

test('FastCheckAdapter.available === false and run() is BLOCKED', async () => {
  const adapter = new FastCheckAdapter();
  assert.equal(adapter.available, false);
  assert.equal(adapter.kind, 'fast-check');
  assert.match(adapter.reason ?? '', /fast-check/);

  const result = await adapter.run({
    name: 'any',
    samples: [1],
    predicate: () => true,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.reason, /fast-check/);
  assert.notEqual(result.status, 'PASS');
});

test('disabled → NOT_APPLICABLE', async () => {
  const results = await runPropertyChecks({
    enabled: false,
    adapter: new BuiltinSampleAdapter(),
    properties: [sortingAdjacentProperty([[1, 2]])],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.name, 'property:not-enabled');
  assert.equal(results[0]?.status, 'NOT_APPLICABLE');
  assert.match(results[0]?.reason ?? '', /not enabled/i);
});

test('unavailable adapter → BLOCKED without running properties as PASS', async () => {
  const results = await runPropertyChecks({
    enabled: true,
    adapter: new FastCheckAdapter(),
    properties: [sortingAdjacentProperty([[3, 1, 2]])],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.name, 'property:adapter');
  assert.equal(results[0]?.status, 'BLOCKED');
  assert.match(results[0]?.reason ?? '', /fast-check/);
});

test('source does not contain fast-check import or require', () => {
  const dir = path.dirname(__filename);
  const sources = ['adapter.ts', 'examples.ts', 'index.ts'].map((f) =>
    fs.readFileSync(path.join(dir, f), 'utf8')
  );
  const joined = sources.join('\n');
  assert.equal(joined.includes("from 'fast-check'"), false);
  assert.equal(joined.includes('from "fast-check"'), false);
  assert.equal(joined.includes("require('fast-check')"), false);
  assert.equal(joined.includes('require("fast-check")'), false);
});

test('sorting [[3,1,2],[]] and reverse round-trip PASS via runPropertyChecks', async () => {
  const results = await runPropertyChecks({
    enabled: true,
    adapter: new BuiltinSampleAdapter(),
    properties: [
      sortingAdjacentProperty([[3, 1, 2], []]),
      roundTripProperty(['ab', 'a'], reverse, reverse),
    ],
  });
  assert.equal(results.length, 2);
  assert.equal(results[0]?.status, 'PASS');
  assert.equal(results[1]?.status, 'PASS');
  assert.equal(
    results[0]?.name,
    'sorting ascending never decreases between adjacent values'
  );
  assert.equal(results[1]?.name, 'encoding then decoding returns the original value');
});
