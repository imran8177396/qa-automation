import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { test } from 'node:test';
import {
  evaluateApiResponse,
  evaluateHttpStatus,
  fileUploadPossibleStatuses,
  loadHttpStatusMatrix,
  lookupStatus,
  negativeStatusesFor,
  planAuthenticationCases,
  planFileUploadCase,
  planNegativeStatusCases,
  rateLimitPossibleStatuses,
  shouldGenerateStatusTest,
} from './http-status-matrix';

const REQUIRED_CODES = [
  100, 101, 102, 103, 200, 201, 202, 203, 204, 205, 206, 207, 208, 226, 300, 301, 302, 303, 304,
  305, 306, 307, 308, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414,
  415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500, 501, 502, 503, 504,
  505, 506, 507, 508, 510, 511,
] as const;

const MATRIX_JSON_PATH = path.join(__dirname, 'http-status-matrix.json');

test('JSON file parses and includes every required status code', () => {
  const raw = fs.readFileSync(MATRIX_JSON_PATH, 'utf8');
  const parsed = JSON.parse(raw) as { statuses: Record<string, unknown> };
  assert.equal(Object.keys(parsed.statuses).length, REQUIRED_CODES.length);
  for (const code of REQUIRED_CODES) {
    assert.ok(parsed.statuses[String(code)], `missing status ${code}`);
  }
  assert.doesNotMatch(raw, /example\.com|localhost|demo\.|http:\/\/127/);
});

test('loadHttpStatusMatrix returns versioned matrix with evaluation rules', () => {
  const matrix = loadHttpStatusMatrix();
  assert.equal(matrix.version, '1.0.0');
  assert.equal(matrix.evaluation_rules.do_not_assume_4xx_is_failure, true);
  assert.equal(matrix.evaluation_rules.do_not_assume_2xx_means_complete_success, true);
  assert.equal(matrix.evaluation_rules.api_specification_has_priority, true);
  assert.equal(matrix.evaluation_rules.unknown_expected_status, 'SPECIFICATION_REQUIRED');
});

test('classification_examples: 201/201 PASS, 201/500 FAIL, 401/401 PASS, 401/200 FAIL, 204/204 PASS', () => {
  assert.equal(evaluateHttpStatus({ expected: 201, actual: 201 }).result, 'PASS');
  assert.equal(evaluateHttpStatus({ expected: 201, actual: 500 }).result, 'FAIL');
  assert.equal(evaluateHttpStatus({ expected: 401, actual: 401 }).result, 'PASS');
  assert.equal(evaluateHttpStatus({ expected: 401, actual: 200 }).result, 'FAIL');
  assert.equal(evaluateHttpStatus({ expected: 204, actual: 204 }).result, 'PASS');
});

test('public API matches matrix classification_examples', () => {
  const examples = loadHttpStatusMatrix().classification_examples;
  assert.equal(examples.length, 5);
  for (const example of examples) {
    assert.equal(
      evaluateHttpStatus({ expected: example.expected, actual: example.actual }).result,
      example.result
    );
  }
});

test('expected omitted yields SPECIFICATION_REQUIRED without guessing 200', () => {
  const evaluation = evaluateHttpStatus({ expected: undefined, actual: 404 });
  assert.equal(evaluation.result, 'SPECIFICATION_REQUIRED');
  assert.equal(evaluation.reason, 'expected status was not specified');
  assert.doesNotMatch(evaluation.reason, /\b200\b/);
  assert.equal(evaluation.expected, null);
  assert.equal(evaluation.actual, 404);
});

test('200/200 PASS is not completeSuccess; reason notes status match is not complete success', () => {
  const evaluation = evaluateHttpStatus({ expected: 200, actual: 200 });
  assert.equal(evaluation.result, 'PASS');
  assert.notEqual(evaluation.completeSuccess, true);
  assert.match(
    evaluation.reason,
    /status match is not complete success; body, schema, headers, content type, and response time were not validated/
  );
});

test('401 expected + 401 actual PASS; reason does not say permission', () => {
  const evaluation = evaluateHttpStatus({ expected: 401, actual: 401 });
  assert.equal(evaluation.result, 'PASS');
  assert.doesNotMatch(evaluation.reason, /permission/i);
  assert.equal(lookupStatus(401)?.authentication_related, true);
  assert.equal(lookupStatus(403)?.authorization_related, true);
});

test('409 is client_error, not server_error', () => {
  assert.equal(lookupStatus(409)?.category, 'client_error');
  assert.notEqual(lookupStatus(409)?.category, 'server_error');
});

test('lookupStatus returns flags for common negative and auth codes', () => {
  const notFound = lookupStatus(404);
  assert.equal(notFound?.name, 'Not Found');
  assert.equal(notFound?.negative_testing, true);

  assert.equal(lookupStatus(401)?.authentication_related, true);
  assert.equal(lookupStatus(403)?.authorization_related, true);
  assert.equal(lookupStatus(422)?.validation_related, true);
  assert.equal(lookupStatus(429)?.rate_limit_related, true);

  assert.equal(lookupStatus(305)?.status, 'obsolete');
  assert.equal(lookupStatus(306)?.status, 'reserved');
});

test('negativeStatusesFor returns matrix codes or empty for unknown scenarios', () => {
  assert.deepEqual(negativeStatusesFor('missing_authentication'), [401]);
  assert.deepEqual(negativeStatusesFor('not-a-scenario'), []);
});

test('evaluateApiResponse API-LOGIN-001: expected 200 actual 401 FAIL with both codes', () => {
  const evaluation = evaluateApiResponse({
    testCaseId: 'API-LOGIN-001',
    endpoint: '/api/login',
    method: 'POST',
    expectedStatus: 200,
    actualStatus: 401,
    responseTimeMs: 42,
    timestamp: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(evaluation.testCaseId, 'API-LOGIN-001');
  assert.equal(evaluation.endpoint, '/api/login');
  assert.equal(evaluation.result, 'FAIL');
  assert.match(evaluation.reason, /200/);
  assert.match(evaluation.reason, /401/);
  assert.equal(evaluation.requestHeadersNote, undefined);
  assert.equal(evaluation.requestBodyNote, undefined);
});

test('evaluateApiResponse 204 empty body PASS; non-empty body FAIL; null body observation does not fail', () => {
  const empty = evaluateApiResponse({
    expectedStatus: 204,
    actualStatus: 204,
    actualBodyEmpty: true,
  });
  assert.equal(empty.result, 'PASS');

  const missingObs = evaluateApiResponse({
    expectedStatus: 204,
    actualStatus: 204,
    actualBodyEmpty: null,
  });
  assert.equal(missingObs.result, 'PASS');
  assert.deepEqual(missingObs.notes, ['body emptiness was not recorded']);

  const nonEmpty = evaluateApiResponse({
    expectedStatus: 204,
    actualStatus: 204,
    actualBodyEmpty: false,
  });
  assert.equal(nonEmpty.result, 'FAIL');
  assert.equal(nonEmpty.reason, '204 No Content must have an empty body');

  const statusMismatch = evaluateApiResponse({
    expectedStatus: 204,
    actualStatus: 200,
    actualBodyEmpty: true,
  });
  assert.equal(statusMismatch.result, 'FAIL');
  assert.match(statusMismatch.reason, /204/);
  assert.match(statusMismatch.reason, /200/);
});

test('evaluateApiResponse missing expected → SPECIFICATION_REQUIRED', () => {
  const evaluation = evaluateApiResponse({ actualStatus: 200 });
  assert.equal(evaluation.result, 'SPECIFICATION_REQUIRED');
  assert.equal(evaluation.expectedStatus, null);
});

test('planNegativeStatusCases missing_required_field without expected → SPECIFICATION_REQUIRED', () => {
  const plan = planNegativeStatusCases({ scenario: 'missing_required_field' });
  assert.equal(plan.expectedStatus, null);
  assert.equal(plan.result, 'SPECIFICATION_REQUIRED');
  assert.ok(plan.possibleStatuses.includes(400));
  assert.ok(plan.possibleStatuses.includes(422));
});

test('planNegativeStatusCases with expectedStatus 422 uses 422', () => {
  const plan = planNegativeStatusCases({ scenario: 'missing_required_field', expectedStatus: 422 });
  assert.equal(plan.expectedStatus, 422);
  assert.equal(plan.resultIfMatched, 'PASS');
  assert.equal(plan.note, undefined);
});

test('planNegativeStatusCases unknown scenario → SPECIFICATION_REQUIRED', () => {
  const plan = planNegativeStatusCases({ scenario: 'totally-unknown' });
  assert.equal(plan.result, 'SPECIFICATION_REQUIRED');
  assert.deepEqual(plan.possibleStatuses, []);
  assert.equal(plan.expectedStatus, null);
});

test('planNegativeStatusCases single matrix status still SPECIFICATION_REQUIRED without caller expected', () => {
  const plan = planNegativeStatusCases({ scenario: 'malformed_json' });
  assert.equal(plan.expectedStatus, null);
  assert.equal(plan.result, 'SPECIFICATION_REQUIRED');
  assert.deepEqual(plan.possibleStatuses, [400]);
});

test('shouldGenerateStatusTest skips 418 unless explicitly required', () => {
  assert.equal(shouldGenerateStatusTest(418, false), false);
  assert.equal(shouldGenerateStatusTest(418, true), true);
  assert.equal(shouldGenerateStatusTest(404, true), true);
  assert.equal(shouldGenerateStatusTest(305, false), false);
  assert.equal(shouldGenerateStatusTest(306, false), false);
  assert.equal(shouldGenerateStatusTest(418, false, true), true);
});

test('planAuthenticationCases authRequired false → []', () => {
  assert.deepEqual(
    planAuthenticationCases({ endpoint: '/resource', method: 'GET', authRequired: false }),
    []
  );
});

test('planAuthenticationCases authRequired true without expectedUnauthorized → SPECIFICATION_REQUIRED', () => {
  const plans = planAuthenticationCases({
    endpoint: '/resource',
    method: 'GET',
    authRequired: true,
  });
  const missing = plans.find((plan) => plan.name === 'missing-token');
  assert.ok(missing);
  assert.equal(missing!.result, 'SPECIFICATION_REQUIRED');
  assert.equal(missing!.expectedStatus, null);
  assert.equal(missing!.metadata.authenticationRelated, true);
  assert.doesNotMatch(JSON.stringify(missing), /no permission/i);

  const forbidden = plans.find((plan) => plan.name === 'insufficient-permission');
  assert.ok(forbidden);
  assert.equal(forbidden!.result, 'SPECIFICATION_REQUIRED');
  assert.equal(forbidden!.metadata.authorizationRelated, true);
});

test('planAuthenticationCases uses explicit 401/403 when provided', () => {
  const plans = planAuthenticationCases({
    endpoint: '/resource',
    method: 'GET',
    authRequired: true,
    successStatus: 200,
    expectedUnauthorized: 401,
    expectedForbidden: 403,
  });
  assert.equal(plans.find((p) => p.name === 'missing-token')?.expectedStatus, 401);
  assert.equal(plans.find((p) => p.name === 'invalid-token')?.expectedStatus, 401);
  assert.equal(plans.find((p) => p.name === 'expired-token')?.expectedStatus, 401);
  assert.equal(plans.find((p) => p.name === 'insufficient-permission')?.expectedStatus, 403);
  assert.equal(plans.find((p) => p.name === 'valid-authentication')?.expectedStatus, 200);
});

test('rate limit and file upload possibles come from matrix conventions', () => {
  assert.deepEqual(rateLimitPossibleStatuses(), [429]);
  assert.deepEqual(fileUploadPossibleStatuses(), {
    unsupported: [400, 415, 422],
    tooLarge: [413],
    duplicate: [409],
  });
  const plan = planFileUploadCase({ scenario: 'unsupported' });
  assert.equal(plan.result, 'SPECIFICATION_REQUIRED');
  assert.equal(plan.expectedStatus, null);
  assert.equal(planFileUploadCase({ scenario: 'tooLarge', expectedStatus: 413 }).expectedStatus, 413);
});

test('module source has no demo hosts', () => {
  const source = fs.readFileSync(path.join(__dirname, 'http-status-matrix.ts'), 'utf8');
  assert.doesNotMatch(source, /example\.com|localhost|demo\.|http:\/\/127/);
});
