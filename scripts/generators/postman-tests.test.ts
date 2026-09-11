import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PostmanRequestConfig } from '../types';
import { buildPostmanTestScript, resolveAssertions, resolveExpectedStatus } from './postman-tests';

const solutions: PostmanRequestConfig = {
  name: 'GET /solutions — documented 404',
  method: 'GET',
  path: '/solutions',
  reachableFromNavigation: true,
  expectedStatus: 404,
  assertions: { statusCode: 404, expectJson: false },
  assertionFlags: [
    {
      assertion: 'statusCode',
      expected: 404,
      lastObserved: 404,
      flags: ['DOCUMENTED_INTENDED_STATUS', 'USER_CONFIRMED'],
      note: 'User confirmed: GET /solutions is intentionally HTTP 404.',
    },
  ],
};

test('resolveAssertions() does not apply a 200 default to collection status', () => {
  const resolved = resolveAssertions(
    { name: 'PUT /', method: 'PUT', path: '/', expectedStatus: 'UNVERIFIED', assertions: { expectJson: false } },
    { statusCode: 200, expectJson: true }
  );
  assert.equal(resolved.statusCode, undefined);
  assert.equal(resolved.expectJson, false);
});

test('resolveAssertions() keeps the existing /solutions 404 collection assertion', () => {
  const resolved = resolveAssertions(solutions, { statusCode: 200 });
  assert.equal(resolved.statusCode, 404);
});

test('resolveExpectedStatus() uses documented 404 over the nav-reachable default', () => {
  assert.equal(resolveExpectedStatus(solutions), 404);
  assert.equal(resolveAssertions(solutions).statusCode, 404);
});

test('resolveExpectedStatus() uses the nav-reachable default when expectedStatus is omitted', () => {
  assert.equal(
    resolveExpectedStatus({
      name: 'GET /about',
      method: 'GET',
      path: '/about',
      reachableFromNavigation: true,
    }),
    200
  );
});

test('resolveExpectedStatus() marks undocumented routes UNVERIFIED', () => {
  assert.equal(
    resolveExpectedStatus({ name: 'GET /api/', method: 'GET', path: '/api/', expectedStatus: 'UNVERIFIED' }),
    'UNVERIFIED'
  );
});

test('generated /solutions script still asserts 404 and uses a descriptive flagged name', () => {
  const script = buildPostmanTestScript(resolveAssertions(solutions), {
    method: 'GET',
    path: '/solutions',
    assertionFlags: solutions.assertionFlags,
  }).join('\n');
  assert.match(script, /GET \/solutions returns HTTP 404 \[FLAGGED:/);
  assert.match(script, /pm\.response\.to\.have\.status\(404\)/);
  assert.doesNotMatch(script, /to\.have\.status\(200\)/);
});

test('UNVERIFIED requests do not assert an observed status code', () => {
  const script = buildPostmanTestScript(
    resolveAssertions({ name: 'PUT /', method: 'PUT', path: '/', expectedStatus: 'UNVERIFIED', assertions: { expectJson: false } }),
    { method: 'PUT', path: '/' }
  ).join('\n');
  assert.match(script, /status not asserted — UNVERIFIED/);
  assert.doesNotMatch(script, /to\.have\.status\(/);
});
