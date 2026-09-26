import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyRetry,
  DEFAULT_RETRY_ENABLED,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  resolveRetryMaxAttemptsAllowed,
} from './flaky';

describe('classifyRetry', () => {
  it('defaults stay disabled with maxAttempts 2', () => {
    assert.equal(DEFAULT_RETRY_ENABLED, false);
    assert.equal(DEFAULT_RETRY_MAX_ATTEMPTS, 2);
    assert.equal(resolveRetryMaxAttemptsAllowed({ enabled: false, maxAttempts: 2 }), 1);
    assert.equal(resolveRetryMaxAttemptsAllowed({ enabled: true, maxAttempts: 2 }), 2);
  });

  it('throws when enabled and maxAttempts < 1', () => {
    assert.throws(() => resolveRetryMaxAttemptsAllowed({ enabled: true, maxAttempts: 0 }), /maxAttempts/);
    assert.throws(() => classifyRetry([], { enabled: true, maxAttempts: 0 }), /maxAttempts/);
  });

  it('enabled false ignores maxAttempts and classifies a single outcome', () => {
    const result = classifyRetry([{ attempt: 1, status: 'FAIL' }], {
      enabled: false,
      maxAttempts: 99,
    });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.maxAttemptsAllowed, 1);
  });

  it('all PASS → PASS; all FAIL → FAIL; mixed → FLAKY never PASS', () => {
    assert.equal(
      classifyRetry(
        [
          { attempt: 1, status: 'PASS' },
          { attempt: 2, status: 'PASS' },
        ],
        { enabled: true, maxAttempts: 2 }
      ).status,
      'PASS'
    );

    const allFail = classifyRetry(
      [
        { attempt: 1, status: 'FAIL' },
        { attempt: 2, status: 'FAIL' },
      ],
      { enabled: true, maxAttempts: 2 }
    );
    assert.equal(allFail.status, 'FAIL');
    assert.match(allFail.reason ?? '', /attempt 1 FAIL/);
    assert.match(allFail.reason ?? '', /attempt 2 FAIL/);

    const flaky = classifyRetry(
      [
        { attempt: 1, status: 'FAIL' },
        { attempt: 2, status: 'PASS' },
      ],
      { enabled: true, maxAttempts: 2 }
    );
    assert.equal(flaky.status, 'FLAKY');
    assert.notEqual(flaky.status, 'PASS');
    assert.match(flaky.reason ?? '', /attempt 1 FAIL/);
    assert.match(flaky.reason ?? '', /attempt 2 PASS/);
  });

  it('TIMEOUT or CANCELLED stays that status and is not FLAKY or PASS', () => {
    const timeout = classifyRetry([{ attempt: 1, status: 'TIMEOUT' }], {
      enabled: true,
      maxAttempts: 2,
    });
    assert.equal(timeout.status, 'TIMEOUT');
    assert.notEqual(timeout.status, 'PASS');
    assert.notEqual(timeout.status, 'FLAKY');

    const cancelled = classifyRetry(
      [
        { attempt: 1, status: 'FAIL' },
        { attempt: 2, status: 'CANCELLED' },
      ],
      { enabled: true, maxAttempts: 2 }
    );
    assert.equal(cancelled.status, 'CANCELLED');
    assert.notEqual(cancelled.status, 'PASS');
  });
});
