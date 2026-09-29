/**
 * HTTP status matrix loader/evaluator.
 * Callers compare expected vs actual; they must not treat every 4xx as FAIL or every 2xx as complete success.
 */
import fs from 'fs';
import path from 'path';

export type HttpStatusCategory =
  | 'informational'
  | 'success'
  | 'redirection'
  | 'client_error'
  | 'server_error';

export type HttpStatusQaRelevance = 'critical' | 'high' | 'medium' | 'low' | 'none';

export interface HttpStatusEntry {
  name: string;
  category: HttpStatusCategory;
  outcome: string;
  typical_methods?: string[];
  qa_relevance: HttpStatusQaRelevance;
  response_body_expected?: boolean;
  preserve_method?: boolean;
  negative_testing?: boolean;
  authentication_related?: boolean;
  authorization_related?: boolean;
  validation_related?: boolean;
  rate_limit_related?: boolean;
  server_failure?: boolean;
  upstream_failure?: boolean;
  timeout_related?: boolean;
  special?: boolean;
  status?: 'obsolete' | 'reserved' | string;
}

export interface HttpStatusMatrix {
  version: string;
  purpose: string;
  classification: Record<string, HttpStatusCategory>;
  evaluation_rules: {
    pass_rule: string;
    fail_rule: string;
    unknown_expected_status: string;
    do_not_assume_4xx_is_failure: boolean;
    do_not_assume_2xx_means_complete_success: boolean;
    api_specification_has_priority: boolean;
  };
  statuses: Record<string, HttpStatusEntry>;
  common_api_expectations: Record<string, unknown>;
  negative_test_matrix: Array<{ scenario: string; possible_statuses: number[] }>;
  required_response_validation: string[];
  classification_examples: Array<{
    test: string;
    expected: number;
    actual: number;
    result: string;
  }>;
  engine_instructions: string[];
}

export type HttpStatusEvalResult = 'PASS' | 'FAIL' | 'SPECIFICATION_REQUIRED';

export interface HttpStatusEvaluation {
  result: HttpStatusEvalResult;
  reason: string;
  actual: number | null;
  expected: number | null;
  statusName: string | null;
  category: string | null;
  completeSuccess: false | null;
}

const MATRIX_PATH = path.join(__dirname, 'http-status-matrix.json');

const CLASS_BY_DIGIT: Record<number, HttpStatusCategory> = {
  1: 'informational',
  2: 'success',
  3: 'redirection',
  4: 'client_error',
  5: 'server_error',
};

let cachedMatrix: HttpStatusMatrix | null = null;

function isMissingStatus(value: number | null | undefined): boolean {
  return value == null || Number.isNaN(value);
}

function categoryForCode(code: number, entry: HttpStatusEntry | null): string | null {
  if (entry) return entry.category;
  const digit = Math.floor(code / 100);
  return CLASS_BY_DIGIT[digit] ?? null;
}

function nameForCode(code: number, entry: HttpStatusEntry | null): string | null {
  return entry?.name ?? null;
}

function displayName(code: number, entry: HttpStatusEntry | null): string {
  return nameForCode(code, entry) ?? 'unknown';
}

export function loadHttpStatusMatrix(): HttpStatusMatrix {
  if (cachedMatrix) return cachedMatrix;
  const raw = fs.readFileSync(MATRIX_PATH, 'utf8');
  cachedMatrix = JSON.parse(raw) as HttpStatusMatrix;
  return cachedMatrix;
}

export function lookupStatus(code: number): HttpStatusEntry | null {
  if (!Number.isFinite(code)) return null;
  const matrix = loadHttpStatusMatrix();
  return matrix.statuses[String(code)] ?? null;
}

export function evaluateHttpStatus(input: {
  expected: number | null | undefined;
  actual: number | null | undefined;
}): HttpStatusEvaluation {
  if (isMissingStatus(input.expected)) {
    const actual = isMissingStatus(input.actual) ? null : input.actual!;
    const entry = actual == null ? null : lookupStatus(actual);
    return {
      result: 'SPECIFICATION_REQUIRED',
      reason: 'expected status was not specified',
      actual,
      expected: null,
      statusName: actual == null ? null : nameForCode(actual, entry),
      category: actual == null ? null : categoryForCode(actual, entry),
      completeSuccess: null,
    };
  }

  const expected = input.expected!;

  if (isMissingStatus(input.actual)) {
    const entry = lookupStatus(expected);
    return {
      result: 'FAIL',
      reason: 'actual status was not recorded',
      actual: null,
      expected,
      statusName: nameForCode(expected, entry),
      category: categoryForCode(expected, entry),
      completeSuccess: null,
    };
  }

  const actual = input.actual!;
  const expectedEntry = lookupStatus(expected);
  const actualEntry = lookupStatus(actual);

  if (actual === expected) {
    let reason = `actual status ${actual} matches expected ${expected}`;
    if (actualEntry?.category === 'success') {
      reason +=
        '; status match is not complete success; body, schema, headers, content type, and response time were not validated';
    }
    return {
      result: 'PASS',
      reason,
      actual,
      expected,
      statusName: nameForCode(actual, actualEntry),
      category: categoryForCode(actual, actualEntry),
      completeSuccess: null,
    };
  }

  return {
    result: 'FAIL',
    reason: `expected ${expected} (${displayName(expected, expectedEntry)}); actual ${actual} (${displayName(actual, actualEntry)})`,
    actual,
    expected,
    statusName: nameForCode(actual, actualEntry),
    category: categoryForCode(actual, actualEntry),
    completeSuccess: null,
  };
}

export function negativeStatusesFor(scenario: string): number[] {
  const matrix = loadHttpStatusMatrix();
  const row = matrix.negative_test_matrix.find((item) => item.scenario === scenario);
  return row ? [...row.possible_statuses] : [];
}

/** Codes that must not drive new generated status assertions unless the caller requires them. */
const OBSOLETE_OR_SPECIAL_GENERATION_CODES = new Set([305, 306, 418]);

/**
 * Whether to generate a new test that asserts this status code.
 * 305, 306, and 418 stay in the JSON for lookup/classification, but generation of a new
 * test for those codes is skipped unless `explicitlyRequired` is true.
 * Classification of an observed response is always allowed (`classifyingActualResponse: true`).
 * Other codes: generate only when explicitly required or when classifying an actual response.
 */
export function shouldGenerateStatusTest(
  code: number,
  explicitlyRequired: boolean,
  classifyingActualResponse = false
): boolean {
  if (classifyingActualResponse) return true;
  if (OBSOLETE_OR_SPECIAL_GENERATION_CODES.has(code)) return explicitlyRequired;
  return explicitlyRequired;
}

export interface ApiResponseEvaluationInput {
  testCaseId?: string;
  endpoint?: string;
  method?: string;
  url?: string;
  expectedStatus?: number | null;
  actualStatus?: number | null;
  expectedBodyEmpty?: boolean | null;
  actualBodyEmpty?: boolean | null;
  responseTimeMs?: number | null;
  timestamp?: string;
  /** Already-masked note only — never pass raw Authorization/Cookie headers. */
  requestHeadersNote?: string;
  /** Already-masked note only — never pass raw request bodies with secrets. */
  requestBodyNote?: string;
}

export interface ApiResponseEvaluation {
  testCaseId?: string;
  endpoint?: string;
  method?: string;
  url?: string;
  expectedStatus: number | null;
  actualStatus: number | null;
  responseTimeMs?: number | null;
  result: HttpStatusEvalResult;
  reason: string;
  timestamp: string;
  requestHeadersNote?: string;
  requestBodyNote?: string;
  notes?: string[];
}

/**
 * Normalized API status (+ optional 204 body emptiness) evaluation.
 * Does not accept raw headers/bodies; optional *Note fields must already be masked by the caller.
 */
export function evaluateApiResponse(input: ApiResponseEvaluationInput): ApiResponseEvaluation {
  const expectedStatus = isMissingStatus(input.expectedStatus) ? null : input.expectedStatus!;
  const actualStatus = isMissingStatus(input.actualStatus) ? null : input.actualStatus!;
  const statusEval = evaluateHttpStatus({
    expected: expectedStatus,
    actual: actualStatus,
  });

  const notes: string[] = [];
  let result = statusEval.result;
  let reason = statusEval.reason;

  const expectedEntry = expectedStatus == null ? null : lookupStatus(expectedStatus);
  const expectsEmptyBody =
    expectedStatus === 204 && expectedEntry?.response_body_expected === false;

  if (expectsEmptyBody && actualStatus === 204) {
    if (input.actualBodyEmpty === false) {
      result = 'FAIL';
      reason = '204 No Content must have an empty body';
    } else if (input.actualBodyEmpty == null) {
      notes.push('body emptiness was not recorded');
    }
  }

  const out: ApiResponseEvaluation = {
    testCaseId: input.testCaseId,
    endpoint: input.endpoint,
    method: input.method,
    url: input.url,
    expectedStatus,
    actualStatus,
    responseTimeMs: input.responseTimeMs ?? null,
    result,
    reason,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };

  if (input.requestHeadersNote != null) out.requestHeadersNote = input.requestHeadersNote;
  if (input.requestBodyNote != null) out.requestBodyNote = input.requestBodyNote;
  if (notes.length > 0) out.notes = notes;

  return out;
}

export interface NegativeStatusPlan {
  scenario: string;
  expectedStatus: number | null;
  possibleStatuses: number[];
  result?: 'SPECIFICATION_REQUIRED';
  resultIfMatched?: 'PASS';
  note?: string;
}

/**
 * Plans a negative status case from the matrix. Never auto-picks among multiple possibles
 * (e.g. 400 vs 422). A caller-supplied expectedStatus wins even when outside the matrix list.
 */
export function planNegativeStatusCases(input: {
  scenario: string;
  expectedStatus?: number | null;
}): NegativeStatusPlan {
  const possibleStatuses = negativeStatusesFor(input.scenario);
  const hasExpected = !isMissingStatus(input.expectedStatus);

  if (possibleStatuses.length === 0 && !hasExpected) {
    return {
      scenario: input.scenario,
      expectedStatus: null,
      possibleStatuses: [],
      result: 'SPECIFICATION_REQUIRED',
    };
  }

  if (hasExpected) {
    const expectedStatus = input.expectedStatus!;
    const plan: NegativeStatusPlan = {
      scenario: input.scenario,
      expectedStatus,
      possibleStatuses,
      resultIfMatched: 'PASS',
    };
    if (possibleStatuses.length > 0 && !possibleStatuses.includes(expectedStatus)) {
      plan.note = 'specification overrides the generic matrix';
    }
    return plan;
  }

  return {
    scenario: input.scenario,
    expectedStatus: null,
    possibleStatuses,
    result: 'SPECIFICATION_REQUIRED',
  };
}

export interface AuthCasePlan {
  name:
    | 'valid-authentication'
    | 'missing-token'
    | 'invalid-token'
    | 'expired-token'
    | 'insufficient-permission'
    | 'sufficient-permission';
  endpoint: string;
  method: string;
  expectedStatus: number | null;
  possibleStatuses?: number[];
  result?: 'SPECIFICATION_REQUIRED';
  resultIfMatched?: 'PASS';
  metadata: {
    authenticationRelated?: boolean;
    authorizationRelated?: boolean;
  };
}

/**
 * Auth/negative plans only when authRequired === true. Never invents 401/403 expectations
 * without an explicit expectedUnauthorized / expectedForbidden from the caller.
 */
export function planAuthenticationCases(input: {
  endpoint: string;
  method: string;
  successStatus?: number | null;
  authRequired?: boolean | null;
  expectedUnauthorized?: number | null;
  expectedForbidden?: number | null;
}): AuthCasePlan[] {
  if (input.authRequired !== true) return [];

  const unauthorizedPossibles = negativeStatusesFor('missing_authentication');
  const forbiddenPossibles = negativeStatusesFor('insufficient_permission');
  const hasUnauthorized = !isMissingStatus(input.expectedUnauthorized);
  const hasForbidden = !isMissingStatus(input.expectedForbidden);
  const hasSuccess = !isMissingStatus(input.successStatus);

  const authNegative = (
    name: AuthCasePlan['name']
  ): AuthCasePlan => {
    if (hasUnauthorized) {
      return {
        name,
        endpoint: input.endpoint,
        method: input.method,
        expectedStatus: input.expectedUnauthorized!,
        possibleStatuses: unauthorizedPossibles,
        resultIfMatched: 'PASS',
        metadata: { authenticationRelated: true },
      };
    }
    return {
      name,
      endpoint: input.endpoint,
      method: input.method,
      expectedStatus: null,
      possibleStatuses: unauthorizedPossibles.length > 0 ? unauthorizedPossibles : [401],
      result: 'SPECIFICATION_REQUIRED',
      metadata: { authenticationRelated: true },
    };
  };

  const validAuth: AuthCasePlan = hasSuccess
    ? {
        name: 'valid-authentication',
        endpoint: input.endpoint,
        method: input.method,
        expectedStatus: input.successStatus!,
        resultIfMatched: 'PASS',
        metadata: { authenticationRelated: true },
      }
    : {
        name: 'valid-authentication',
        endpoint: input.endpoint,
        method: input.method,
        expectedStatus: null,
        result: 'SPECIFICATION_REQUIRED',
        metadata: { authenticationRelated: true },
      };

  const sufficient: AuthCasePlan = hasSuccess
    ? {
        name: 'sufficient-permission',
        endpoint: input.endpoint,
        method: input.method,
        expectedStatus: input.successStatus!,
        resultIfMatched: 'PASS',
        metadata: { authorizationRelated: true },
      }
    : {
        name: 'sufficient-permission',
        endpoint: input.endpoint,
        method: input.method,
        expectedStatus: null,
        result: 'SPECIFICATION_REQUIRED',
        metadata: { authorizationRelated: true },
      };

  const insufficient: AuthCasePlan = hasForbidden
    ? {
        name: 'insufficient-permission',
        endpoint: input.endpoint,
        method: input.method,
        expectedStatus: input.expectedForbidden!,
        possibleStatuses: forbiddenPossibles,
        resultIfMatched: 'PASS',
        metadata: { authorizationRelated: true },
      }
    : {
        name: 'insufficient-permission',
        endpoint: input.endpoint,
        method: input.method,
        expectedStatus: null,
        possibleStatuses: forbiddenPossibles.length > 0 ? forbiddenPossibles : [403],
        result: 'SPECIFICATION_REQUIRED',
        metadata: { authorizationRelated: true },
      };

  return [
    validAuth,
    authNegative('missing-token'),
    authNegative('invalid-token'),
    authNegative('expired-token'),
    insufficient,
    sufficient,
  ];
}

/** Rate-limit possibles from the matrix (`rate_limit_exceeded` → 429). */
export function rateLimitPossibleStatuses(): number[] {
  return negativeStatusesFor('rate_limit_exceeded');
}

/**
 * FILE_UPLOAD_POSSIBLE — matrix-backed possibilities only (do not invent a single upload code):
 * unsupported → 400, 415, 422; tooLarge → 413; duplicate → 409.
 */
export function fileUploadPossibleStatuses(): {
  unsupported: number[];
  tooLarge: number[];
  duplicate: number[];
} {
  return {
    unsupported: [400, 415, 422],
    tooLarge: [413],
    duplicate: [409],
  };
}

export interface FileUploadPlan {
  scenario: 'unsupported' | 'tooLarge' | 'duplicate';
  expectedStatus: number | null;
  possibleStatuses: number[];
  result?: 'SPECIFICATION_REQUIRED';
  resultIfMatched?: 'PASS';
}

/** Plans a file-upload negative case. Does not generate a live upload. */
export function planFileUploadCase(input: {
  scenario: 'unsupported' | 'tooLarge' | 'duplicate';
  expectedStatus?: number | null;
}): FileUploadPlan {
  const possibles = fileUploadPossibleStatuses()[input.scenario];
  if (!isMissingStatus(input.expectedStatus)) {
    return {
      scenario: input.scenario,
      expectedStatus: input.expectedStatus!,
      possibleStatuses: possibles,
      resultIfMatched: 'PASS',
    };
  }
  return {
    scenario: input.scenario,
    expectedStatus: null,
    possibleStatuses: possibles,
    result: 'SPECIFICATION_REQUIRED',
  };
}
