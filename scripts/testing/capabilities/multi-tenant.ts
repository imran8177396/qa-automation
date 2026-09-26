/**
 * Optional multi-tenant checks over caller-supplied evidence.
 * Does not call a network, invent tenants, or assume every app is multi-tenant.
 */

import { makeResult, type TestResult } from '../../core/engine-contract';
import { compareTenantIsolation } from './tenant-isolation';

export interface TenantIdentity {
  tenantId?: string;
  organizationId?: string;
  userId?: string;
  role?: string;
}

export interface MultiTenantCase {
  identity: TenantIdentity;
  /** Response or data already captured for this identity. Not fetched here. */
  body?: unknown;
}

export interface RunMultiTenantChecksInput {
  enabled: boolean;
  tenantA?: MultiTenantCase;
  tenantB?: MultiTenantCase;
}

const TEST_TYPE = 'multi-tenant';
const CATEGORY = 'multi-tenant';

export const MULTI_TENANT_CHECK_IDS = {
  notEnabled: 'multi-tenant:not-enabled',
  tenantAOwnData: 'multi-tenant:tenant-a-own-data',
  tenantACannotAccessTenantB: 'multi-tenant:tenant-a-cannot-access-tenant-b',
  tenantBOwnData: 'multi-tenant:tenant-b-own-data',
} as const;

function bodyContains(body: unknown, needle: string): boolean {
  if (needle === '') return false;
  if (typeof body === 'string') return body.includes(needle);
  try {
    return JSON.stringify(body).includes(needle);
  } catch {
    return String(body).includes(needle);
  }
}

function identityMetadata(identity: TenantIdentity): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (identity.tenantId !== undefined) meta.tenantId = identity.tenantId;
  if (identity.organizationId !== undefined) meta.organizationId = identity.organizationId;
  if (identity.userId !== undefined) meta.userId = identity.userId;
  if (identity.role !== undefined) meta.role = identity.role;
  return meta;
}

function ownDataResult(
  id: string,
  name: string,
  caseInput: MultiTenantCase | undefined
): TestResult {
  const identity = caseInput?.identity ?? {};
  const tenantId = (identity.tenantId ?? '').trim();
  const meta = identityMetadata(identity);

  if (!tenantId) {
    const reason = 'tenantId is required';
    return makeResult({
      id,
      testType: TEST_TYPE,
      category: CATEGORY,
      name,
      status: 'REQUIRES_CONFIGURATION',
      error: { message: reason },
      metadata: { ...meta, reason },
    });
  }

  if (caseInput?.body === undefined || caseInput.body === null) {
    const reason = 'no response body to compare';
    return makeResult({
      id,
      testType: TEST_TYPE,
      category: CATEGORY,
      name,
      status: 'NOT_TESTED',
      error: { message: reason },
      metadata: { ...meta, reason },
    });
  }

  if (bodyContains(caseInput.body, tenantId)) {
    return makeResult({
      id,
      testType: TEST_TYPE,
      category: CATEGORY,
      name,
      status: 'PASS',
      assertion: { expected: 'tenant id present', actual: 'present' },
      metadata: meta,
    });
  }

  return makeResult({
    id,
    testType: TEST_TYPE,
    category: CATEGORY,
    name,
    status: 'FAIL',
    assertion: { expected: 'tenant id present', actual: 'absent' },
    error: { message: `response body does not contain tenant id (${tenantId})` },
    metadata: meta,
  });
}

function crossTenantResult(
  tenantA: MultiTenantCase | undefined,
  tenantB: MultiTenantCase | undefined
): TestResult {
  const idA = (tenantA?.identity?.tenantId ?? '').trim();
  const idB = (tenantB?.identity?.tenantId ?? '').trim();
  const meta = {
    ...identityMetadata(tenantA?.identity ?? {}),
    tenantB: idB || undefined,
  };

  const compared = compareTenantIsolation({
    tenantA: { id: idA },
    tenantB: { id: idB },
    body: tenantA?.body,
  });

  const reason =
    typeof compared.metadata?.reason === 'string'
      ? compared.metadata.reason
      : compared.error?.message;

  return makeResult({
    id: MULTI_TENANT_CHECK_IDS.tenantACannotAccessTenantB,
    testType: TEST_TYPE,
    category: CATEGORY,
    name: 'Tenant A cannot access Tenant B',
    status: compared.status,
    assertion: compared.assertion,
    error: compared.error,
    metadata: {
      ...meta,
      ...(compared.metadata ?? {}),
      ...(reason ? { reason } : {}),
    },
  });
}

/**
 * Run optional multi-tenant evidence checks. Pure comparison only — no network.
 * When `enabled` is not true, returns a single NOT_APPLICABLE result and does not
 * look for tenant ids.
 */
export function runMultiTenantChecks(input: RunMultiTenantChecksInput): TestResult[] {
  if (!input.enabled) {
    const reason = 'multi-tenant testing is not enabled for this application';
    return [
      makeResult({
        id: MULTI_TENANT_CHECK_IDS.notEnabled,
        testType: TEST_TYPE,
        category: CATEGORY,
        name: 'Multi-tenant testing',
        status: 'NOT_APPLICABLE',
        error: { message: reason },
        metadata: { reason },
      }),
    ];
  }

  return [
    ownDataResult(
      MULTI_TENANT_CHECK_IDS.tenantAOwnData,
      'Tenant A own data',
      input.tenantA
    ),
    crossTenantResult(input.tenantA, input.tenantB),
    ownDataResult(
      MULTI_TENANT_CHECK_IDS.tenantBOwnData,
      'Tenant B own data',
      input.tenantB
    ),
  ];
}
