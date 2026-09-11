import type { ExpectedHttpStatus, PostmanRequestConfig, QaConfig } from '../../types';
import { resolveExpectedStatus } from '../../generators/postman-tests';
import type {
  ApiAuthStance,
  ApiResultStatus,
  ApiSection27Artifact,
  ApiSection27Request,
  PostmanExecutionLike,
  PostmanReportLike,
} from './types';

const AUTH_NOT_EXECUTED_REASON =
  'QA_API_TOKEN is absent and no application auth contract is documented. Authentication and authorization are NOT_EXECUTED — they are not counted as passing GET / duplicates.';

export function normalizeApiResultStatus(status: string | undefined): 'PASS' | 'FAIL' {
  const upper = (status ?? '').toUpperCase();
  if (upper === 'PASSED' || upper === 'PASS' || upper === 'EXPECTED') return 'PASS';
  return 'FAIL';
}

export function executionEndpoint(exec: PostmanExecutionLike): string {
  const url = exec.requestExecuted?.url;
  if (!url) return 'Not Provided';
  const host = url.host?.join('.') ?? '';
  const reqPath = url.path?.filter(Boolean).join('/') ?? '';
  const protocol = url.protocol ?? 'https';
  const suffix = reqPath ? `/${reqPath}` : '/';
  return `${protocol}://${host}${suffix}`.replace(/([^:]\/)\/+/g, '$1');
}

export function executionPath(exec: PostmanExecutionLike): string {
  const url = exec.requestExecuted?.url;
  if (!url?.path?.length) return '/';
  const joined = `/${url.path.filter(Boolean).join('/')}`;
  return joined === '/' ? '/' : joined.replace(/\/+$/, '') || '/';
}

function matchRequest(config: QaConfig, exec: PostmanExecutionLike): PostmanRequestConfig | undefined {
  const name = exec.requestExecuted?.name ?? exec.item?.name;
  const method = (exec.requestExecuted?.method ?? 'GET').toUpperCase();
  const path = executionPath(exec);
  const byName = config.postman.requests.find((request) => request.enabled !== false && request.name === name);
  if (byName) return byName;
  return config.postman.requests.find(
    (request) => request.enabled !== false && request.method === method && normalizePath(request.path) === path
  );
}

function normalizePath(path: string): string {
  if (!path || path === '/') return '/';
  return `/${path.replace(/^\//, '').replace(/\/+$/, '')}`;
}

function collectionTestsPassed(exec: PostmanExecutionLike): boolean {
  const tests = exec.tests ?? [];
  if (tests.length === 0) return true;
  return tests.every((test) => normalizeApiResultStatus(test.status) === 'PASS');
}

export function resolveAuthStance(tokenPresent: boolean): ApiAuthStance {
  if (tokenPresent) {
    return {
      authentication: 'EXECUTED',
      authorization: 'EXECUTED',
      reason: 'QA_API_TOKEN is present. Auth assertions run only when postman.auth.type is not none and the target documents the contract.',
      tokenPresent: true,
    };
  }
  return {
    authentication: 'NOT_EXECUTED',
    authorization: 'NOT_EXECUTED',
    reason: AUTH_NOT_EXECUTED_REASON,
    tokenPresent: false,
  };
}

function decideResult(input: {
  expectedStatus: ExpectedHttpStatus;
  actualStatus: number | null;
  collectionPassed: boolean;
}): { result: ApiResultStatus; includedInPassCount: boolean; expectedVsActual?: { expected: string; actual: string } } {
  const actual = input.actualStatus == null ? 'Not Provided' : String(input.actualStatus);

  if (input.expectedStatus === 'UNVERIFIED') {
    if (!input.collectionPassed) {
      return {
        result: 'FAIL',
        includedInPassCount: false,
        expectedVsActual: { expected: 'UNVERIFIED (collection assertion failed)', actual },
      };
    }
    return {
      result: 'UNVERIFIED',
      includedInPassCount: false,
      expectedVsActual: { expected: 'UNVERIFIED', actual },
    };
  }

  const expectedVsActual = { expected: String(input.expectedStatus), actual };
  if (input.actualStatus == null || input.actualStatus !== input.expectedStatus || !input.collectionPassed) {
    return { result: 'FAIL', includedInPassCount: true, expectedVsActual };
  }
  return { result: 'PASS', includedInPassCount: true, expectedVsActual };
}

function authRows(auth: ApiAuthStance, startIndex: number): ApiSection27Request[] {
  if (auth.authentication !== 'NOT_EXECUTED') return [];
  return [
    {
      testId: `TC-API-${String(startIndex).padStart(3, '0')}`,
      name: 'Authentication (not executed)',
      method: 'GET',
      endpoint: 'Not Provided',
      path: '/',
      statusCode: 'NOT_EXECUTED',
      expectedStatus: 'UNVERIFIED',
      collectionAssertedStatus: null,
      collectionAssertionResult: 'NOT_EXECUTED',
      responseTimeMs: 0,
      assertion: 'Authentication contract — NOT_EXECUTED because QA_API_TOKEN is absent',
      result: 'NOT_EXECUTED',
      flags: ['NOT_EXECUTED', 'AUTH_TOKEN_ABSENT'],
      includedInPassCount: false,
      note: auth.reason,
    },
    {
      testId: `TC-API-${String(startIndex + 1).padStart(3, '0')}`,
      name: 'Authorization (not executed)',
      method: 'GET',
      endpoint: 'Not Provided',
      path: '/',
      statusCode: 'NOT_EXECUTED',
      expectedStatus: 'UNVERIFIED',
      collectionAssertedStatus: null,
      collectionAssertionResult: 'NOT_EXECUTED',
      responseTimeMs: 0,
      assertion: 'Authorization contract — NOT_EXECUTED because QA_API_TOKEN is absent',
      result: 'NOT_EXECUTED',
      flags: ['NOT_EXECUTED', 'AUTH_TOKEN_ABSENT'],
      includedInPassCount: false,
      note: auth.reason,
    },
  ];
}

export function parsePostmanReportForSection27(input: {
  report: PostmanReportLike | null;
  config: QaConfig;
  tokenPresent: boolean;
  generatedAt?: string;
}): ApiSection27Artifact {
  const navDefault = input.config.postman.expectationPolicy?.navReachableDefault ?? 200;
  const executions = input.report?.run?.executions ?? [];
  const auth = resolveAuthStance(input.tokenPresent);
  const flaggedAssertions = input.config.postman.requests.flatMap((request) => request.assertionFlags ?? []);

  const requests: ApiSection27Request[] = executions.map((exec, index) => {
    const matched = matchRequest(input.config, exec);
    const expectedStatus = matched ? resolveExpectedStatus(matched, navDefault) : 'UNVERIFIED';
    const actualStatus = exec.response?.code ?? null;
    const collectionPassed = collectionTestsPassed(exec);
    const decided = decideResult({ expectedStatus, actualStatus, collectionPassed });
    const assertionNames =
      (exec.tests ?? [])
        .map((test) => test.name)
        .filter((name): name is string => Boolean(name))
        .join('; ') ||
      (expectedStatus === 'UNVERIFIED'
        ? 'No documented status expectation (UNVERIFIED)'
        : 'Status not named in Postman report');
    const flags = [...(matched?.assertionFlags?.flatMap((flag) => flag.flags) ?? [])];
    if (expectedStatus === 'UNVERIFIED') flags.push('UNVERIFIED');
    if (
      typeof expectedStatus === 'number' &&
      actualStatus != null &&
      actualStatus !== expectedStatus
    ) {
      flags.push('EXPECTED_VS_ACTUAL_MISMATCH');
    }

    return {
      testId: `TC-API-${String(index + 1).padStart(3, '0')}`,
      name: exec.requestExecuted?.name ?? exec.item?.name ?? matched?.name ?? 'n/a',
      method: exec.requestExecuted?.method ?? matched?.method ?? 'GET',
      endpoint: executionEndpoint(exec),
      path: matched ? normalizePath(matched.path) : executionPath(exec),
      statusCode: actualStatus == null ? 'Not Provided' : String(actualStatus),
      expectedStatus,
      collectionAssertedStatus: matched?.assertions?.statusCode ?? null,
      collectionAssertionResult: collectionPassed ? 'PASS' : 'FAIL',
      responseTimeMs: exec.response?.responseTime ?? 0,
      assertion: assertionNames,
      result: decided.result,
      flags: [...new Set(flags)],
      expectedVsActual: decided.expectedVsActual,
      includedInPassCount: decided.includedInPassCount,
      note: matched?.assertionFlags?.[0]?.note,
    };
  });

  requests.push(...authRows(auth, requests.length + 1));

  const passed = requests.filter((row) => row.result === 'PASS' && row.includedInPassCount).length;
  const failed = requests.filter((row) => row.result === 'FAIL').length;
  const unverified = requests.filter((row) => row.result === 'UNVERIFIED').length;
  const notExecuted = requests.filter((row) => row.result === 'NOT_EXECUTED').length;
  const includedInPassCount = requests.filter((row) => row.includedInPassCount).length;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    collection: input.report?.run?.meta?.collectionName ?? input.config.postman.collectionName,
    terminology:
      'API automation via Postman CLI. expectedStatus is the documented intended status; collection assertions.statusCode is never auto-flipped. UNVERIFIED requests are excluded from the pass count. Authentication/authorization are NOT_EXECUTED when QA_API_TOKEN is absent.',
    auth,
    requests,
    counts: {
      passed,
      failed,
      unverified,
      notExecuted,
      excludedFromPassCount: requests.length - includedInPassCount,
      includedInPassCount,
    },
    flaggedAssertions,
  };
}

export function apiStagePassed(artifact: ApiSection27Artifact): boolean {
  return artifact.counts.failed === 0;
}
