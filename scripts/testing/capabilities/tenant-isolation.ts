/**
 * Compares caller-supplied evidence for multi-tenant isolation.
 * Does not call a network or invent tenant records.
 */

import { makeResult, type TestResult } from '../../core/engine-contract';

export interface TenantIsolationInput {
  tenantA: { id: string };
  tenantB: { id: string };
  /** Response body already captured by the caller (string or JSON value). */
  body: unknown;
}

function bodyContains(body: unknown, needle: string): boolean {
  if (needle === '') return false;
  if (typeof body === 'string') return body.includes(needle);
  try {
    return JSON.stringify(body).includes(needle);
  } catch {
    return String(body).includes(needle);
  }
}

/**
 * Check that a response body for tenantA does not leak tenantB's id (and vice versa
 * is the caller's responsibility by swapping arguments). Pure comparison only.
 */
export function compareTenantIsolation(input: TenantIsolationInput): TestResult {
  const idA = (input.tenantA?.id ?? '').trim();
  const idB = (input.tenantB?.id ?? '').trim();

  if (!idA || !idB) {
    const reason = 'tenant ids are required';
    return makeResult({
      id: 'tenant-isolation:compare',
      testType: 'tenant-isolation',
      category: 'advanced',
      name: 'Tenant isolation comparison',
      status: 'REQUIRES_CONFIGURATION',
      error: { message: reason },
      metadata: { reason },
    });
  }

  if (input.body === undefined || input.body === null) {
    const reason = 'no response body to compare';
    return makeResult({
      id: 'tenant-isolation:compare',
      testType: 'tenant-isolation',
      category: 'advanced',
      name: 'Tenant isolation comparison',
      status: 'NOT_TESTED',
      error: { message: reason },
      metadata: { reason },
    });
  }

  // Body is for tenantA; other tenant id must be absent.
  if (bodyContains(input.body, idB)) {
    return makeResult({
      id: 'tenant-isolation:compare',
      testType: 'tenant-isolation',
      category: 'advanced',
      name: 'Tenant isolation comparison',
      status: 'FAIL',
      assertion: { expected: 'other tenant id absent', actual: 'found' },
      error: { message: `response body contains other tenant id (${idB})` },
      metadata: { tenantA: idA, tenantB: idB },
    });
  }

  return makeResult({
    id: 'tenant-isolation:compare',
    testType: 'tenant-isolation',
    category: 'advanced',
    name: 'Tenant isolation comparison',
    status: 'PASS',
    assertion: { expected: 'other tenant id absent', actual: 'absent' },
    metadata: { tenantA: idA, tenantB: idB },
  });
}
