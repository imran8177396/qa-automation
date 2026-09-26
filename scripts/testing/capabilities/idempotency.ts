/**
 * Compares already-captured responses for idempotency evidence.
 * Live repeated requests are not sent because they can create duplicate operations.
 */

import { makeResult, type TestResult } from '../../core/engine-contract';

export interface IdempotentResponse {
  status: number;
  resourceId?: string;
}

/**
 * Compare two captured results. Does not send POST/PUT.
 * Note: live repeated requests are not sent because they can create duplicate operations.
 */
export function compareIdempotentResponses(
  first: IdempotentResponse | null | undefined,
  second: IdempotentResponse | null | undefined
): TestResult {
  if (!first || !second) {
    const reason = 'two responses are required';
    return makeResult({
      id: 'idempotency:compare',
      testType: 'idempotency',
      category: 'advanced',
      name: 'Idempotent response comparison',
      status: 'NOT_TESTED',
      error: { message: reason },
      metadata: {
        reason,
        note: 'live repeated requests are not sent because they can create duplicate operations',
      },
    });
  }

  if (first.status !== second.status) {
    return makeResult({
      id: 'idempotency:compare',
      testType: 'idempotency',
      category: 'advanced',
      name: 'Idempotent response comparison',
      status: 'FAIL',
      assertion: { expected: first.status, actual: second.status },
      error: { message: 'repeated request returned a different status code' },
      metadata: {
        note: 'live repeated requests are not sent because they can create duplicate operations',
      },
    });
  }

  const id1 = first.resourceId;
  const id2 = second.resourceId;
  const has1 = typeof id1 === 'string' && id1.length > 0;
  const has2 = typeof id2 === 'string' && id2.length > 0;

  if (!has1 || !has2) {
    const reason = 'resource id was not returned; duplicate creation was not verified';
    return makeResult({
      id: 'idempotency:compare',
      testType: 'idempotency',
      category: 'advanced',
      name: 'Idempotent response comparison',
      status: 'NOT_TESTED',
      error: { message: reason },
      metadata: {
        reason,
        note: 'live repeated requests are not sent because they can create duplicate operations',
      },
    });
  }

  if (id1 !== id2) {
    return makeResult({
      id: 'idempotency:compare',
      testType: 'idempotency',
      category: 'advanced',
      name: 'Idempotent response comparison',
      status: 'FAIL',
      assertion: { expected: id1, actual: id2 },
      error: { message: 'repeated request returned a different resource id' },
      metadata: {
        note: 'live repeated requests are not sent because they can create duplicate operations',
      },
    });
  }

  return makeResult({
    id: 'idempotency:compare',
    testType: 'idempotency',
    category: 'advanced',
    name: 'Idempotent response comparison',
    status: 'PASS',
    assertion: { expected: id1, actual: id2 },
    metadata: {
      note: 'live repeated requests are not sent because they can create duplicate operations',
    },
  });
}
