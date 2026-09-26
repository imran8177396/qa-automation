import path from 'path';
import { PATHS } from '../lib/paths';
import { loadConfig } from '../lib/load-config';
import { writeJson } from '../discovery/write-json';
import { resolveApiUrl } from '../orchestrator/resolve-url';
import { classifyResponseShape } from '../lib/api/response-shape';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import {
  buildEngineSummary,
  makeResult,
  type TestResult,
} from '../core/engine-contract';
import { buildNegativeCases, type NegativeFieldSpec } from './negative-cases';
import { buildBoundaryCases, type BoundaryFieldSpec } from './boundary-cases';
import type { HttpMethod, JsonFieldType, PostmanRequestConfig, QaConfig } from '../types';

export type ContractResponseShape = 'array' | 'object' | 'empty';

export interface ContractFieldSpec extends NegativeFieldSpec, BoundaryFieldSpec {
  name: string;
}

export interface ContractDefinition {
  name: string;
  method: HttpMethod;
  path: string;
  expectedStatus: number;
  requiredFields?: string[];
  fieldTypes?: Partial<Record<string, JsonFieldType>>;
  responseShape?: ContractResponseShape;
  /** Expected response header name substrings (case-insensitive presence). */
  headers?: string[];
  /** Simple required field names on the request body — not a full JSON Schema. */
  requestSchema?: string[];
  /** Simple required field names on an error body — not a full JSON Schema. */
  errorSchema?: string[];
  /** When set, FAIL if the response lacks this header. */
  versionHeader?: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  /** Fields with constraints — drives negative/boundary case planning. */
  fields?: ContractFieldSpec[];
}

export interface ContractEngineConfig {
  enabled: boolean;
  contracts?: ContractDefinition[];
  /**
   * When true, map `postman.requests` into the contract catalog.
   * Default false so `npm run test:api` remains the Postman path and this
   * runner does not double-hit configured paths against an empty API URL.
   */
  usePostmanRequests?: boolean;
  /**
   * When false (default), negative/boundary cases are listed as NOT_TESTED.
   * When true, only safe GET query mutations are executed (see comment in execute).
   */
  executeNegative?: boolean;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null; forEach(cb: (value: string, key: string) => void): void };
  text(): Promise<string>;
}>;

function joinUrl(base: string, requestPath: string): string {
  const root = base.replace(/\/+$/, '');
  const suffix = requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
  return `${root}${suffix}`;
}

function withQuery(url: string, query?: Record<string, string>): string {
  if (!query || Object.keys(query).length === 0) return url;
  const u = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    u.searchParams.set(key, value);
  }
  return u.toString();
}

function contractsFromPostman(requests: PostmanRequestConfig[]): ContractDefinition[] {
  return requests
    .filter((row) => row.enabled !== false)
    .map((row) => {
      const expected =
        typeof row.assertions?.statusCode === 'number'
          ? row.assertions.statusCode
          : typeof row.expectedStatus === 'number'
            ? row.expectedStatus
            : 200;
      return {
        name: row.name,
        method: row.method,
        path: row.path,
        expectedStatus: expected,
        requiredFields: row.assertions?.requiredFields,
        fieldTypes: row.assertions?.fieldTypes,
        responseShape: row.assertions?.responseShape,
        query: row.query,
        body: row.body,
      };
    });
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function collectHeaderNames(headers: {
  forEach(cb: (value: string, key: string) => void): void;
}): string[] {
  const names: string[] = [];
  headers.forEach((_value, key) => names.push(key));
  return names;
}

function assertContractResponse(input: {
  contract: ContractDefinition;
  status: number;
  bodyText: string;
  headerNames: string[];
  getHeader: (name: string) => string | null;
}): { ok: true } | { ok: false; expected: unknown; actual: unknown; message: string } {
  const { contract, status, bodyText, headerNames, getHeader } = input;

  if (status !== contract.expectedStatus) {
    return {
      ok: false,
      expected: contract.expectedStatus,
      actual: status,
      message: `expected status ${contract.expectedStatus}, got ${status}`,
    };
  }

  if (contract.versionHeader) {
    const present = getHeader(contract.versionHeader);
    if (present == null) {
      return {
        ok: false,
        expected: contract.versionHeader,
        actual: headerNames,
        message: `missing version header "${contract.versionHeader}"`,
      };
    }
  }

  if (contract.headers?.length) {
    const lower = headerNames.map((h) => h.toLowerCase());
    for (const needle of contract.headers) {
      const found = lower.some((h) => h.includes(needle.toLowerCase()));
      if (!found) {
        return {
          ok: false,
          expected: needle,
          actual: headerNames,
          message: `missing expected response header substring "${needle}"`,
        };
      }
    }
  }

  const shape = classifyResponseShape(bodyText);
  if (contract.responseShape && shape !== contract.responseShape) {
    return {
      ok: false,
      expected: contract.responseShape,
      actual: shape,
      message: `expected responseShape ${contract.responseShape}, got ${shape}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = bodyText === '' ? null : JSON.parse(bodyText);
  } catch {
    parsed = undefined;
  }

  if (contract.requiredFields?.length) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        expected: contract.requiredFields,
        actual: shape,
        message: 'requiredFields need a JSON object body',
      };
    }
    const obj = parsed as Record<string, unknown>;
    for (const field of contract.requiredFields) {
      if (!(field in obj)) {
        return {
          ok: false,
          expected: field,
          actual: Object.keys(obj),
          message: `missing required field "${field}"`,
        };
      }
    }
  }

  if (contract.fieldTypes) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        expected: contract.fieldTypes,
        actual: shape,
        message: 'fieldTypes need a JSON object body',
      };
    }
    const obj = parsed as Record<string, unknown>;
    for (const [field, expectedType] of Object.entries(contract.fieldTypes)) {
      if (!(field in obj)) continue;
      const actualType = jsonTypeOf(obj[field]);
      if (actualType !== expectedType) {
        return {
          ok: false,
          expected: expectedType,
          actual: actualType,
          message: `field "${field}" type mismatch`,
        };
      }
    }
  }

  if (contract.errorSchema?.length && status >= 400) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        expected: contract.errorSchema,
        actual: shape,
        message: 'errorSchema needs a JSON object body',
      };
    }
    const obj = parsed as Record<string, unknown>;
    for (const field of contract.errorSchema) {
      if (!(field in obj)) {
        return {
          ok: false,
          expected: field,
          actual: Object.keys(obj),
          message: `missing errorSchema field "${field}"`,
        };
      }
    }
  }

  return { ok: true };
}

function planNegativeBoundaryResults(
  contract: ContractDefinition,
  executeNegative: boolean
): TestResult[] {
  const fields = contract.fields ?? [];
  const planned: TestResult[] = [];
  const reason =
    'negative/boundary cases planned but executeNegative is false';

  for (const field of fields) {
    for (const neg of buildNegativeCases(field)) {
      planned.push(
        makeResult({
          id: `contract:${contract.name}:neg:${neg.id}`,
          testType: 'contract',
          category: 'functional',
          name: `${contract.name} negative: ${neg.description}`,
          status: 'NOT_TESTED',
          error: { message: executeNegative ? 'deferred to safe GET query mutation path' : reason },
          metadata: {
            reason: executeNegative
              ? 'negative case cataloged; execution gated to safe GET query mutations'
              : reason,
            caseKind: neg.kind,
            value: neg.value,
            contract: contract.name,
            field: field.name,
          },
        })
      );
    }
    for (const bound of buildBoundaryCases(field)) {
      planned.push(
        makeResult({
          id: `contract:${contract.name}:bound:${bound.id}`,
          testType: 'contract',
          category: 'functional',
          name: `${contract.name} boundary: ${bound.description}`,
          status: 'NOT_TESTED',
          error: { message: executeNegative ? 'deferred to safe GET query mutation path' : reason },
          metadata: {
            reason: executeNegative
              ? 'boundary case cataloged; execution gated to safe GET query mutations'
              : reason,
            value: bound.value,
            contract: contract.name,
            field: field.name,
          },
        })
      );
    }
  }
  return planned;
}

/**
 * Prefer safe GET query mutations over POST.
 * When executeNegative is true and method is GET, mutate one query param per case
 * and GET the URL. Non-GET methods keep planned NOT_TESTED rows (no invented writes).
 */
async function executeSafeGetMutations(input: {
  contract: ContractDefinition;
  apiUrl: string;
  fetchImpl: FetchLike;
  cases: TestResult[];
}): Promise<TestResult[]> {
  const { contract, apiUrl, fetchImpl, cases } = input;
  if (contract.method !== 'GET') {
    return cases.map((row) =>
      makeResult({
        ...row,
        status: 'NOT_TESTED',
        error: {
          message:
            'negative/boundary execution limited to GET query mutations; non-GET left NOT_TESTED',
        },
        metadata: {
          ...row.metadata,
          reason:
            'negative/boundary execution limited to GET query mutations; non-GET left NOT_TESTED',
        },
      })
    );
  }

  const out: TestResult[] = [];
  for (const row of cases) {
    const field = typeof row.metadata?.field === 'string' ? row.metadata.field : 'q';
    const rawValue = row.metadata?.value;
    const queryValue =
      rawValue === undefined || rawValue === null
        ? ''
        : typeof rawValue === 'object'
          ? JSON.stringify(rawValue)
          : String(rawValue);
    const target = withQuery(joinUrl(apiUrl, contract.path), {
      ...(contract.query ?? {}),
      [field]: queryValue,
    });
    const started = Date.now();
    try {
      const response = await fetchImpl(target, { method: 'GET' });
      const durationMs = Date.now() - started;
      // Negative/boundary probes record the observed status; they do not flip the
      // contract's expectedStatus. Observation-only: non-2xx is still PASS for the
      // probe when the request completed (server rejected invalid input).
      out.push(
        makeResult({
          id: row.id,
          testType: 'contract',
          category: 'functional',
          name: row.name,
          status: 'PASS',
          durationMs,
          target,
          assertion: { expected: 'request completed', actual: response.status },
          metadata: {
            ...row.metadata,
            executed: true,
            mutation: 'query',
          },
        })
      );
    } catch (error: unknown) {
      const durationMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      out.push(
        makeResult({
          id: row.id,
          testType: 'contract',
          category: 'functional',
          name: row.name,
          status: 'FAIL',
          durationMs,
          target,
          error: { message: `connection error: ${message}` },
          metadata: { ...row.metadata, executed: true, mutation: 'query' },
        })
      );
    }
  }
  return out;
}

export async function runContractTests(options?: {
  config?: ContractEngineConfig;
  qaConfig?: QaConfig;
  apiUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  writeSummary?: boolean;
}): Promise<TestResult[]> {
  const env = options?.env ?? process.env;
  const qa = options?.qaConfig ?? loadConfig();
  const engineConfig: ContractEngineConfig =
    options?.config ??
    ({
      enabled: qa.tests?.contract?.enabled ?? false,
      contracts: qa.tests?.contract?.contracts,
      usePostmanRequests: qa.tests?.contract?.usePostmanRequests ?? false,
      executeNegative: qa.tests?.contract?.executeNegative ?? false,
    } satisfies ContractEngineConfig);

  const fetchImpl = options?.fetchImpl ?? (globalThis.fetch as FetchLike);
  const writeSummary = options?.writeSummary !== false;
  const results: TestResult[] = [];

  if (!engineConfig.enabled) {
    results.push(
      makeResult({
        id: 'contract:disabled',
        testType: 'contract',
        category: 'functional',
        name: 'Contract engine',
        status: 'NOT_TESTED',
        error: { message: 'contract engine disabled' },
        metadata: { reason: 'contract engine disabled' },
      })
    );
    if (writeSummary) writeContractSummary(results);
    return results;
  }

  const apiUrl =
    options?.apiUrl ??
    resolveApiUrl({
      envUrl: env.QA_API_URL,
      apiUrl: qa.urls?.api,
    });

  let contracts = engineConfig.contracts ?? [];
  if (contracts.length === 0 && engineConfig.usePostmanRequests === true) {
    contracts = contractsFromPostman(qa.postman?.requests ?? []);
  }

  if (!apiUrl.trim()) {
    results.push(
      makeResult({
        id: 'contract:no-api-url',
        testType: 'contract',
        category: 'functional',
        name: 'Contract API base URL',
        status: 'REQUIRES_CONFIGURATION',
        error: {
          message: 'API URL empty — set QA_API_URL or urls.api (never invent a host)',
        },
        metadata: { reason: 'API URL empty' },
      })
    );
    // Still surface planned negative/boundary catalog when contracts exist.
    for (const contract of contracts) {
      results.push(
        ...planNegativeBoundaryResults(contract, engineConfig.executeNegative === true).map(
          (row) =>
            makeResult({
              ...row,
              status: 'REQUIRES_CONFIGURATION',
              error: {
                message: 'API URL empty — negative/boundary not executed',
              },
              metadata: {
                ...row.metadata,
                reason: 'API URL empty — negative/boundary not executed',
              },
            })
        )
      );
    }
    if (contracts.length === 0) {
      results.push(
        makeResult({
          id: 'contract:no-contracts',
          testType: 'contract',
          category: 'functional',
          name: 'Contract catalog',
          status: 'REQUIRES_CONFIGURATION',
          error: {
            message:
              'no contracts configured (set tests.contract.contracts or usePostmanRequests true)',
          },
          metadata: { reason: 'no contracts configured' },
        })
      );
    }
    if (writeSummary) writeContractSummary(results);
    return results;
  }

  if (contracts.length === 0) {
    results.push(
      makeResult({
        id: 'contract:no-contracts',
        testType: 'contract',
        category: 'functional',
        name: 'Contract catalog',
        status: 'REQUIRES_CONFIGURATION',
        error: {
          message:
            'no contracts configured (set tests.contract.contracts or usePostmanRequests true)',
        },
        metadata: { reason: 'no contracts configured' },
      })
    );
    if (writeSummary) writeContractSummary(results);
    return results;
  }

  for (const contract of contracts) {
    const id = `contract:${contract.method}:${contract.name}`;
    const target = withQuery(joinUrl(apiUrl, contract.path), contract.query);
    const started = Date.now();

    if (contract.requestSchema?.length && !contract.body) {
      results.push(
        makeResult({
          id: `${id}:request-schema`,
          testType: 'contract',
          category: 'functional',
          name: `${contract.name} requestSchema`,
          status: 'REQUIRES_CONFIGURATION',
          target,
          error: {
            message: 'requestSchema listed but no request body configured',
          },
          metadata: { reason: 'requestSchema without body' },
        })
      );
    }

    try {
      const init: {
        method: string;
        headers: Record<string, string>;
        body?: string;
      } = {
        method: contract.method,
        headers: { Accept: 'application/json' },
      };
      if (contract.body !== undefined && contract.method !== 'GET' && contract.method !== 'DELETE') {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(contract.body);
      }

      const response = await fetchImpl(target, init);
      const bodyText = await response.text();
      const durationMs = Date.now() - started;
      const headerNames = collectHeaderNames(response.headers);
      const assertion = assertContractResponse({
        contract,
        status: response.status,
        bodyText,
        headerNames,
        getHeader: (name) => response.headers.get(name),
      });

      if (assertion.ok) {
        results.push(
          makeResult({
            id,
            testType: 'contract',
            category: 'functional',
            name: contract.name,
            status: 'PASS',
            durationMs,
            target,
            assertion: { expected: contract.expectedStatus, actual: response.status },
            evidence: { response: { status: response.status, shape: classifyResponseShape(bodyText) } },
          })
        );
      } else {
        results.push(
          makeResult({
            id,
            testType: 'contract',
            category: 'functional',
            name: contract.name,
            status: 'FAIL',
            durationMs,
            target,
            assertion: { expected: assertion.expected, actual: assertion.actual },
            error: { message: assertion.message },
          })
        );
      }
    } catch (error: unknown) {
      const durationMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      results.push(
        makeResult({
          id,
          testType: 'contract',
          category: 'functional',
          name: contract.name,
          status: 'FAIL',
          durationMs,
          target,
          error: { message: `connection error: ${message}` },
        })
      );
    }

    const planned = planNegativeBoundaryResults(
      contract,
      engineConfig.executeNegative === true
    );
    if (engineConfig.executeNegative === true && planned.length > 0) {
      const executed = await executeSafeGetMutations({
        contract,
        apiUrl,
        fetchImpl,
        cases: planned,
      });
      results.push(...executed);
    } else {
      results.push(...planned);
    }
  }

  if (writeSummary) writeContractSummary(results);
  return results;
}

export function writeContractSummary(results: TestResult[]): string {
  const summary = buildEngineSummary({
    engine: 'contract',
    testType: 'contract',
    results,
  });
  const out = path.join(PATHS.reports.contract, 'summary.json');
  writeJson(out, summary);
  return out;
}

async function main(): Promise<void> {
  logStep('Contract engine');
  const results = await runContractTests();
  const summary = buildEngineSummary({
    engine: 'contract',
    testType: 'contract',
    results,
  });
  for (const row of results) {
    console.log(`${row.status}\t${row.name}\t${row.error?.message ?? row.target ?? ''}`);
  }
  if (summary.failCount > 0) {
    logError(`${summary.failCount} contract FAIL(s) — see reports/contract/`);
    process.exit(1);
  }
  if (summary.requiresConfigurationCount > 0) {
    logWarn('Contract REQUIRES_CONFIGURATION — see reports/contract/');
    return;
  }
  if (summary.notTestedCount > 0 && summary.passCount === 0) {
    logWarn('Contract NOT_TESTED — engine disabled or cases planned only');
    return;
  }
  logSuccess('Contract engine completed');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
