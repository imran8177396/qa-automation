/**
 * Structured execution-log tests (observability PARTIAL).
 * Fixtures use clearly fake markers — never real customer samples.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OBSERVABILITY_STATUS,
  formatExecutionLog,
  toExecutionLog,
  type ExecutionLog,
} from './observability';
import { makeResult } from '../engine-contract';
import { redactSecrets } from '../safety-policy';

/** Deterministic fixture markers — asserted absent from JSON output. */
const FIXTURE_EMAIL = 'pii-fixture@example.com';
const FIXTURE_TOKEN = 'token-fixture';
const FIXTURE_PASSWORD = 'password-fixture';

const REQUIRED_KEYS: (keyof ExecutionLog)[] = [
  'runId',
  'testId',
  'engine',
  'startTime',
  'endTime',
  'duration',
  'status',
  'target',
  'environment',
  'error',
  'retryCount',
];

describe('observability execution logs', () => {
  it('capability stays PARTIAL', () => {
    assert.equal(OBSERVABILITY_STATUS, 'PARTIAL');
  });

  it('log contains all required keys', () => {
    const log = toExecutionLog({
      id: 't-keys',
      status: 'PASS',
      metadata: { runId: 'run-1', environment: 'local', engine: 'unit' },
    });
    for (const key of REQUIRED_KEYS) {
      assert.ok(key in log, `missing ${key}`);
    }
    assert.deepEqual(Object.keys(log), REQUIRED_KEYS);
  });

  it('duration computed from fixed ISO start/end (not Date.now())', () => {
    const log = toExecutionLog({
      id: 't-dur',
      status: 'PASS',
      metadata: {
        runId: 'run-dur',
        startTime: '2020-01-01T00:00:00.000Z',
        endTime: '2020-01-01T00:00:01.500Z',
      },
    });
    assert.equal(log.startTime, '2020-01-01T00:00:00.000Z');
    assert.equal(log.endTime, '2020-01-01T00:00:01.500Z');
    assert.equal(log.duration, 1500);
  });

  it('missing end → duration null', () => {
    const log = toExecutionLog({
      id: 't-no-end',
      status: 'PASS',
      metadata: {
        runId: 'run-x',
        startTime: '2020-01-01T00:00:00.000Z',
      },
    });
    assert.equal(log.endTime, null);
    assert.equal(log.duration, null);
  });

  it('end before start → duration null (not negative)', () => {
    const log = toExecutionLog({
      id: 't-rev',
      status: 'FAIL',
      metadata: {
        runId: 'run-rev',
        startTime: '2020-01-01T00:00:02.000Z',
        endTime: '2020-01-01T00:00:01.000Z',
      },
    });
    assert.equal(log.duration, null);
  });

  it('password/token/cookie/api key in error string absent from JSON', () => {
    const log = toExecutionLog({
      id: 't-secrets',
      status: 'FAIL',
      error: {
        message: `auth failed password=${FIXTURE_PASSWORD} token=${FIXTURE_TOKEN} api_key=${FIXTURE_TOKEN} Cookie: session=${FIXTURE_TOKEN}`,
      },
      metadata: { runId: 'run-s' },
    });
    const line = formatExecutionLog(log);
    assert.doesNotMatch(line, new RegExp(FIXTURE_PASSWORD));
    assert.doesNotMatch(line, new RegExp(FIXTURE_TOKEN));
    assert.match(line, /\[MASKED\]/);
    assert.equal(log.status, 'FAIL');
  });

  it('email fixture absent from JSON', () => {
    const log = toExecutionLog({
      id: 't-email',
      status: 'FAIL',
      error: { message: `contact ${FIXTURE_EMAIL} failed` },
      metadata: { runId: 'run-e' },
    });
    const line = formatExecutionLog(log);
    assert.doesNotMatch(line, new RegExp(FIXTURE_EMAIL.replace(/\./g, '\\.')));
    assert.match(String(log.error), /\[MASKED\]/);
  });

  it('URL userinfo masked', () => {
    const log = toExecutionLog({
      id: 't-url',
      status: 'PASS',
      target: `https://user:${FIXTURE_PASSWORD}@example.test/path`,
      metadata: { runId: 'run-u' },
    });
    assert.doesNotMatch(String(log.target), new RegExp(FIXTURE_PASSWORD));
    assert.doesNotMatch(formatExecutionLog(log), new RegExp(FIXTURE_PASSWORD));
    assert.match(String(log.target), /\[MASKED\]@/);
  });

  it('status FAIL stays FAIL inside the log', () => {
    const log = toExecutionLog({
      id: 't-fail',
      status: 'FAIL',
      error: { message: 'assertion failed' },
      metadata: { runId: 'run-f' },
    });
    assert.equal(log.status, 'FAIL');
    assert.notEqual(log.status, 'PASS');
  });

  it('FLAKY without attempt count → retryCount null', () => {
    const log = toExecutionLog({
      id: 't-flaky',
      status: 'FLAKY',
      error: { message: 'intermittent' },
      metadata: { runId: 'run-flaky', reason: 'intermittent' },
    });
    assert.equal(log.retryCount, null);
  });

  it('attempts: 2 → retryCount 1', () => {
    const log = toExecutionLog({
      id: 't-attempts',
      status: 'PASS',
      metadata: { runId: 'run-a', attempts: 2 },
    });
    assert.equal(log.retryCount, 1);
  });

  it('blank testId throws', () => {
    assert.throws(
      () => toExecutionLog({ id: '   ', status: 'PASS', metadata: { runId: 'r' } }),
      /testId/
    );
    assert.throws(() => toExecutionLog({ status: 'PASS' }), /testId/);
  });

  it('JSON.parse(formatExecutionLog(log)) deep-equals the log', () => {
    const log = toExecutionLog({
      id: 't-json',
      status: 'BLOCKED',
      error: { message: 'gated' },
      metadata: {
        runId: 'run-j',
        environment: 'staging',
        engine: 'security',
        startTime: '2020-06-01T12:00:00.000Z',
        endTime: '2020-06-01T12:00:00.250Z',
        reason: 'gated',
      },
    });
    assert.deepEqual(JSON.parse(formatExecutionLog(log)), log);
  });

  it('already-masked [MASKED] is not double-wrapped', () => {
    const log = toExecutionLog({
      id: 't-masked',
      status: 'FAIL',
      error: { message: '[MASKED]' },
      metadata: { runId: 'run-m' },
    });
    assert.equal(log.error, '[MASKED]');
  });

  it('absent runId becomes NOT_AVAILABLE (no invented UUID)', () => {
    const log = toExecutionLog({ id: 't-norun', status: 'PASS' });
    assert.equal(log.runId, 'NOT_AVAILABLE');
    assert.equal(log.engine, 'NOT_AVAILABLE');
    assert.equal(log.environment, 'NOT_AVAILABLE');
  });

  it('makeResult attaches masked executionLog without changing FAIL status', () => {
    const result = makeResult({
      id: 'mr-1',
      testType: 'unit',
      category: 'functional',
      name: 'attach',
      status: 'FAIL',
      target: `https://u:${FIXTURE_PASSWORD}@host.test/`,
      error: { message: `login password=${FIXTURE_PASSWORD} for ${FIXTURE_EMAIL}` },
      metadata: {
        engine: 'unit',
        startTime: '2021-01-01T00:00:00.000Z',
        endTime: '2021-01-01T00:00:00.100Z',
        attempts: 3,
      },
    });
    assert.equal(result.status, 'FAIL');
    const log = result.metadata?.executionLog as ExecutionLog;
    assert.ok(log);
    assert.equal(log.status, 'FAIL');
    assert.equal(log.testId, 'mr-1');
    assert.equal(log.duration, 100);
    assert.equal(log.retryCount, 2);
    assert.equal(log.runId, result.metadata?.runId);
    const line = formatExecutionLog(log);
    assert.doesNotMatch(line, new RegExp(FIXTURE_PASSWORD));
    assert.doesNotMatch(line, new RegExp(FIXTURE_EMAIL.replace(/\./g, '\\.')));
  });
});

describe('redactSecrets extensions for execution logs', () => {
  it('masks Bearer, cookie assignment, and URL userinfo', () => {
    const text = redactSecrets(
      `Bearer ${FIXTURE_TOKEN}; cookie=${FIXTURE_TOKEN}; https://a:${FIXTURE_PASSWORD}@h.test`
    ) as string;
    assert.doesNotMatch(text, new RegExp(FIXTURE_TOKEN));
    assert.doesNotMatch(text, new RegExp(FIXTURE_PASSWORD));
    assert.match(text, /\[REDACTED\]/);
  });

  it('masks object keys for authorization and email', () => {
    const out = redactSecrets({
      authorization: FIXTURE_TOKEN,
      email: FIXTURE_EMAIL,
      ok: true,
    }) as Record<string, unknown>;
    assert.equal(out.authorization, '[REDACTED]');
    assert.equal(out.email, '[REDACTED]');
    assert.equal(out.ok, true);
  });
});
