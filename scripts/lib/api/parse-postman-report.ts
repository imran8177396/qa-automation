import type { ExpectedHttpStatus, PostmanAuthConfig, PostmanRequestConfig, QaConfig } from '../../types';
import { resolveExpectedStatus } from '../../generators/postman-tests';
import type {
  ApiAuthStance,
  ApiResultStatus,
  ApiSection27Artifact,
  ApiSection27Request,
  PostmanExecutionLike,
  PostmanReportLike,
} from './types';

const AUTH_NO_CONTRACT =
  'No authentication or authorization contract is documented (postman.auth.type is none). Authentication and authorization are NOT_EXECUTED / REQUIRES_CONFIGURATION — they are not counted as passing GET / duplicates.';

const AUTH_TOKEN_ABSENT =
  'A documented auth contract exists but QA_API_TOKEN (or the documented credential env vars) is absent. Authentication and authorization are NOT_EXECUTED / REQUIRES_CONFIGURATION.';

const TERMINOLOGY =
  'API automation via Postman CLI. Sauce Demo discovery found 0 xhr/fetch/websocket APIs; executed requests are documented in qa.config.json postman.requests, not invented from the login page. expectedStatus is the documented intended status; collection assertions.statusCode is never auto-flipped. UNVERIFIED requests are excluded from the pass count. Authentication/authorization are NOT_EXECUTED when the contract is undocumented or QA_API_TOKEN is absent.';

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

export function documentedAuthContract(auth?: PostmanAuthConfig): boolean {
  return Boolean(auth?.type && auth.type !== 'none');
}

export function resolveAuthStance(input: {
  tokenPresent: boolean;
  usernamePresent?: boolean;
  passwordPresent?: boolean;
  auth?: PostmanAuthConfig;
}): ApiAuthStance {
  const documented = documentedAuthContract(input.auth);
  const credentialsPresent =
    input.auth?.type === 'basic'
      ? Boolean(input.usernamePresent && input.passwordPresent)
      : input.tokenPresent;

  if (!documented) {
    return {
      authentication: 'NOT_EXECUTED',
      authorization: 'NOT_EXECUTED',
      reason: AUTH_NO_CONTRACT,
      tokenPresent: input.tokenPresent,
      documentedContract: false,
    };
  }

  if (!credentialsPresent) {
    return {
      authentication: 'NOT_EXECUTED',
      authorization: 'NOT_EXECUTED',
      reason: AUTH_TOKEN_ABSENT,
      tokenPresent: input.tokenPresent,
      documentedContract: true,
    };
  }

  return {
    authentication: 'EXECUTED',
    authorization: 'EXECUTED',
    reason:
      'Documented postman.auth contract is present and credentials were provided. Auth assertions run only for that documented contract — tokens are not written to reports.',
    tokenPresent: input.tokenPresent,
    documentedContract: true,
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
      source: 'capability',
      statusCode: 'NOT_EXECUTED',
      expectedStatus: 'UNVERIFIED',
      collectionAssertedStatus: null,
      collectionAssertionResult: 'NOT_EXECUTED',
      responseTimeMs: 0,
      assertion: 'Authentication contract — NOT_EXECUTED / REQUIRES_CONFIGURATION',
      result: 'NOT_EXECUTED',
      flags: ['NOT_EXECUTED', 'REQUIRES_CONFIGURATION', auth.documentedContract ? 'AUTH_TOKEN_ABSENT' : 'AUTH_CONTRACT_ABSENT'],
      includedInPassCount: false,
      note: auth.reason,
    },
    {
      testId: `TC-API-${String(startIndex + 1).padStart(3, '0')}`,
      name: 'Authorization (not executed)',
      method: 'GET',
      endpoint: 'Not Provided',
      path: '/',
      source: 'capability',
      statusCode: 'NOT_EXECUTED',
      expectedStatus: 'UNVERIFIED',
      collectionAssertedStatus: null,
      collectionAssertionResult: 'NOT_EXECUTED',
      responseTimeMs: 0,
      assertion: 'Authorization contract — NOT_EXECUTED / REQUIRES_CONFIGURATION',
      result: 'NOT_EXECUTED',
      flags: ['NOT_EXECUTED', 'REQUIRES_CONFIGURATION', auth.documentedContract ? 'AUTH_TOKEN_ABSENT' : 'AUTH_CONTRACT_ABSENT'],
      includedInPassCount: false,
      note: auth.reason,
    },
  ];
}

export function parsePostmanReportForSection27(input: {
  report: PostmanReportLike | null;
  config: QaConfig;
  tokenPresent: boolean;
  usernamePresent?: boolean;
  passwordPresent?: boolean;
  discoveryNote?: string;
  generatedAt?: string;
}): ApiSection27Artifact {
  const navDefault = input.config.postman.expectationPolicy?.navReachableDefault ?? 200;
  const executions = input.report?.run?.executions ?? [];
  const auth = resolveAuthStance({
    tokenPresent: input.tokenPresent,
    usernamePresent: input.usernamePresent,
    passwordPresent: input.passwordPresent,
    auth: input.config.postman.auth,
  });
  const flaggedAssertions = input.config.postman.requests.flatMap((request) => request.assertionFlags ?? []);
  const discoveryNote =
    input.discoveryNote ??
    'Sauce Demo discovery found 0 xhr/fetch/websocket APIs. Executed requests are documented in qa.config.json, not invented from the login page.';

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
    if (typeof expectedStatus === 'number' && actualStatus != null && actualStatus !== expectedStatus) {
      flags.push('EXPECTED_VS_ACTUAL_MISMATCH');
    }

    return {
      testId: `TC-API-${String(index + 1).padStart(3, '0')}`,
      name: exec.requestExecuted?.name ?? exec.item?.name ?? matched?.name ?? 'n/a',
      method: exec.requestExecuted?.method ?? matched?.method ?? 'GET',
      endpoint: executionEndpoint(exec),
      path: matched ? normalizePath(matched.path) : executionPath(exec),
      source: matched ? 'config' : 'discovery',
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
    terminology: TERMINOLOGY,
    discoveryNote,
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
