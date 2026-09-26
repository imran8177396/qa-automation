import type {
  ExpectedHttpStatus,
  PostmanAssertionFlag,
  PostmanAssertionsConfig,
  PostmanRequestConfig,
} from '../types';

export interface ResolvedPostmanAssertions {
  /** Collection-asserted status only. Undefined when no documented collection assertion exists. */
  statusCode?: number;
  expectJson: boolean;
  maxResponseTimeMs?: number;
  responseShape?: 'array' | 'object' | 'empty';
  requiredFields?: string[];
  fieldTypes?: PostmanAssertionsConfig['fieldTypes'];
  expectError?: boolean;
  contentType?: string;
  htmlDocument?: boolean;
  bodyContains?: string[];
}

export interface PostmanTestContext {
  method: string;
  path: string;
  assertionFlags?: PostmanAssertionFlag[];
  /**
   * Documented expectedStatus from expectationPolicy (may be UNVERIFIED).
   * Never used to overwrite assertions.statusCode.
   */
  expectedStatus?: ExpectedHttpStatus;
}

const DEFAULT_EXPECT_JSON = true;

/**
 * Collection status assertions come ONLY from `request.assertions.statusCode`.
 * Global/default 200 is never applied here — that would silently flip undocumented routes.
 */
export function resolveAssertions(
  request: PostmanRequestConfig,
  globalAssertions?: PostmanAssertionsConfig
): ResolvedPostmanAssertions {
  return {
    statusCode: request.assertions?.statusCode,
    expectJson:
      request.assertions?.expectJson ?? globalAssertions?.expectJson ?? DEFAULT_EXPECT_JSON,
    maxResponseTimeMs: request.assertions?.maxResponseTimeMs ?? globalAssertions?.maxResponseTimeMs,
    responseShape: request.assertions?.responseShape ?? globalAssertions?.responseShape,
    requiredFields: request.assertions?.requiredFields ?? globalAssertions?.requiredFields,
    fieldTypes: request.assertions?.fieldTypes ?? globalAssertions?.fieldTypes,
    expectError: request.assertions?.expectError ?? globalAssertions?.expectError,
    contentType: request.assertions?.contentType ?? globalAssertions?.contentType,
    htmlDocument: request.assertions?.htmlDocument ?? globalAssertions?.htmlDocument,
    bodyContains: request.assertions?.bodyContains ?? globalAssertions?.bodyContains,
  };
}

export function resolveExpectedStatus(
  request: PostmanRequestConfig,
  navReachableDefault = 200
): ExpectedHttpStatus {
  if (request.expectedStatus === 'UNVERIFIED') return 'UNVERIFIED';
  if (typeof request.expectedStatus === 'number') return request.expectedStatus;
  if (request.reachableFromNavigation) return navReachableDefault;
  return 'UNVERIFIED';
}

function escapeJsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function requestLabel(context: PostmanTestContext): string {
  return `${context.method} ${context.path}`;
}

function statusFlagSuffix(context: PostmanTestContext): string {
  const statusFlags = (context.assertionFlags ?? []).filter((flag) => flag.assertion === 'statusCode');
  if (statusFlags.length === 0) return '';
  const names = [...new Set(statusFlags.flatMap((flag) => flag.flags))];
  return ` [FLAGGED: ${names.join('; ')}]`;
}

function expectedStatusLabel(context: PostmanTestContext): string {
  if (context.expectedStatus === 'UNVERIFIED') return 'UNVERIFIED';
  if (typeof context.expectedStatus === 'number') return String(context.expectedStatus);
  return 'UNVERIFIED';
}

/** Runtime classifier embedded in generated Postman tests (same labels as scripts/lib/api/response-shape.ts). */
function buildClassifyResponseShapeSnippet(): string[] {
  return [
    'function qaClassifyResponseShape(text) {',
    '    if (text === "") return "empty";',
    '    try {',
    '        const body = JSON.parse(text);',
    '        if (Array.isArray(body)) return "array";',
    '        if (body !== null && typeof body === "object") return "object";',
    '        return "non-json";',
    '    } catch (e) {',
    '        return "non-json";',
    '    }',
    '}',
  ];
}

function buildStatusTestLines(
  assertions: ResolvedPostmanAssertions,
  context: PostmanTestContext
): string[] {
  const label = requestLabel(context);
  const suffix = statusFlagSuffix(context);
  const expectedLabel = escapeJsString(expectedStatusLabel(context));
  const defaultName =
    assertions.statusCode != null
      ? escapeJsString(`${label} returns HTTP ${assertions.statusCode}${suffix}`)
      : escapeJsString(`${label} received an HTTP response (status not asserted — UNVERIFIED)`);

  const lines: string[] = [
    ...buildClassifyResponseShapeSnippet(),
    '(function () {',
    '    const qaCode = pm.response.code;',
    '    const qaResponseShape = qaClassifyResponseShape(pm.response.text());',
    `    const qaExpectedStatus = "${expectedLabel}";`,
    '    const qaNeedsShapeDetail = qaCode === 400 || (qaCode >= 500 && qaCode <= 599);',
    '    const qaDetail = "HTTP " + qaCode + " (actual responseShape: " + qaResponseShape + "; expected status: " + qaExpectedStatus + ")";',
    `    const qaTestName = qaNeedsShapeDetail ? ${JSON.stringify(`${label} `)} + qaDetail : "${defaultName}";`,
    '    pm.test(qaTestName, function () {',
  ];

  if (assertions.statusCode != null) {
    lines.push(
      '        if (qaNeedsShapeDetail) {',
      `            pm.expect(qaCode, qaDetail).to.eql(${assertions.statusCode});`,
      '        } else {',
      `            pm.response.to.have.status(${assertions.statusCode});`,
      '        }'
    );
  } else {
    lines.push('        pm.expect(qaCode).to.be.a("number");');
  }

  lines.push('    });', '})();');
  return lines;
}

export function buildPostmanTestScript(
  assertions: ResolvedPostmanAssertions,
  context: PostmanTestContext
): string[] {
  const label = requestLabel(context);
  const lines: string[] = [];

  lines.push(...buildStatusTestLines(assertions, context));

  if (assertions.maxResponseTimeMs != null) {
    if (lines.length > 0) lines.push('');
    lines.push(
      `pm.test("${escapeJsString(`${label} response time is under ${assertions.maxResponseTimeMs}ms`)}", function () {`,
      `    pm.expect(pm.response.responseTime).to.be.below(${assertions.maxResponseTimeMs});`,
      `});`
    );
  }

  if (assertions.contentType) {
    const expected = escapeJsString(assertions.contentType.toLowerCase());
    lines.push(
      '',
      `pm.test("${escapeJsString(`${label} Content-Type includes ${assertions.contentType}`)}", function () {`,
      `    const contentType = (pm.response.headers.get("Content-Type") || "").toLowerCase();`,
      `    pm.expect(contentType).to.include("${expected}");`,
      `});`
    );
  }

  if (assertions.htmlDocument) {
    lines.push(
      '',
      `pm.test("${escapeJsString(`${label} body is an HTML document`)}", function () {`,
      '    const body = pm.response.text().toLowerCase();',
      '    pm.expect(body).to.match(/<!doctype html|<html/);',
      '});'
    );
  }

  if (assertions.expectJson) {
    lines.push('', `pm.test("${escapeJsString(`${label} response is JSON`)}", function () {`, '    pm.response.to.be.json;', '});');
  }

  if (assertions.responseShape === 'array') {
    lines.push(
      '',
      `pm.test("${escapeJsString(`${label} response body is an array`)}", function () {`,
      '    pm.expect(pm.response.json()).to.be.an("array");',
      '});'
    );
  } else if (assertions.responseShape === 'object') {
    lines.push(
      '',
      `pm.test("${escapeJsString(`${label} response body is an object`)}", function () {`,
      '    pm.expect(pm.response.json()).to.be.an("object");',
      '});'
    );
  } else if (assertions.responseShape === 'empty') {
    lines.push(
      '',
      `pm.test("${escapeJsString(`${label} response body is empty`)}", function () {`,
      '    pm.expect(pm.response.text()).to.equal("");',
      '});'
    );
  }

  for (const rawField of assertions.requiredFields ?? []) {
    const field = escapeJsString(rawField);
    if (assertions.responseShape === 'array') {
      lines.push(
        '',
        `pm.test("${escapeJsString(`${label} array items include field ${rawField}`)}", function () {`,
        `    const body = pm.response.json();`,
        `    pm.expect(body).to.be.an("array").that.is.not.empty;`,
        `    pm.expect(body[0]).to.have.property("${field}");`,
        `});`
      );
    } else {
      lines.push(
        '',
        `pm.test("${escapeJsString(`${label} response includes field ${rawField}`)}", function () {`,
        `    pm.expect(pm.response.json()).to.have.property("${field}");`,
        `});`
      );
    }
  }

  for (const [rawField, rawTypeName] of Object.entries(assertions.fieldTypes ?? {})) {
    if (!rawTypeName) continue;
    const field = escapeJsString(rawField);
    const typeName = escapeJsString(rawTypeName);
    if (assertions.responseShape === 'array') {
      lines.push(
        '',
        `pm.test("${escapeJsString(`${label} array item field ${rawField} is ${rawTypeName}`)}", function () {`,
        `    const body = pm.response.json();`,
        `    pm.expect(body).to.be.an("array").that.is.not.empty;`,
        `    pm.expect(body[0]).to.have.property("${field}");`,
        `    pm.expect(body[0]["${field}"]).to.be.a("${typeName}");`,
        `});`
      );
    } else {
      lines.push(
        '',
        `pm.test("${escapeJsString(`${label} field ${rawField} is ${rawTypeName}`)}", function () {`,
        `    pm.expect(pm.response.json()).to.have.property("${field}");`,
        `    pm.expect(pm.response.json()["${field}"]).to.be.a("${typeName}");`,
        `});`
      );
    }
  }

  for (const rawSnippet of assertions.bodyContains ?? []) {
    const snippet = escapeJsString(rawSnippet);
    lines.push(
      '',
      `pm.test("${escapeJsString(`${label} body contains ${rawSnippet}`)}", function () {`,
      `    pm.expect(pm.response.text()).to.include("${snippet}");`,
      `});`
    );
  }

  if (assertions.expectError) {
    lines.push(
      '',
      `pm.test("${escapeJsString(`${label} error response recorded`)}", function () {`,
      '    pm.expect(pm.response.code).to.be.at.least(400);',
      '});'
    );
  }

  return lines;
}
