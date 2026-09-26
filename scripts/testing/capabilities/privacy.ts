/**
 * Optional privacy checks (PARTIAL) — caller-supplied evidence only.
 *
 * Honest limits:
 * - Does not scan a live API
 * - Does not delete user data
 * - Does not enforce retention
 * - Does not generate an export file
 * - Key-name checks are not a full privacy audit
 * - Live deletion, retention enforcement, and export jobs are not executed
 *
 * PII keys (exact name match, case-insensitive):
 *   email, phone, ssn, dateOfBirth, address, fullName
 *
 * Sensitive API keys:
 *   password, secret, token, apiKey, accessToken, refreshToken, authorization, creditCard
 *
 * Reasons may name field keys but must never include secret/password/token values.
 * Test fixtures must use placeholders such as "pii-fixture-value" and "token-fixture".
 */

import {
  makeResult,
  type EngineResultStatus,
  type TestResult,
} from '../../core/engine-contract';
import { redactSecrets } from '../../core/safety-policy';

/** Legacy sensitive-key regex used by scanSensitiveKeys (key-path scan). */
const SENSITIVE_KEY = /password|secret|token|ssn|creditcard|api[_-]?key/i;

/**
 * Explicit PII field names for privacy:pii-exposure (key-based only; no prose regex).
 * Documented list — do not invent customer-looking samples in fixtures.
 */
export const PII_FIELD_KEYS = [
  'email',
  'phone',
  'ssn',
  'dateOfBirth',
  'address',
  'fullName',
] as const;

/** Sensitive keys for privacy:sensitive-fields-in-api-responses. */
export const SENSITIVE_API_FIELD_KEYS = [
  'password',
  'secret',
  'token',
  'apiKey',
  'accessToken',
  'refreshToken',
  'authorization',
  'creditCard',
] as const;

/** Secret-like keys for privacy:logs-containing-secrets. */
export const SECRET_LOG_KEYS = [
  'secret',
  'apiKey',
  'accessToken',
  'refreshToken',
  'token',
  'authorization',
] as const;

/** Password / token keys for privacy:logs-containing-passwords-tokens. */
export const PASSWORD_TOKEN_LOG_KEYS = [
  'password',
  'token',
  'authorization',
  'accessToken',
  'refreshToken',
] as const;

export const ALLOWED_EXPORT_FORMATS = ['json', 'csv', 'pdf'] as const;

export type AllowedExportFormat = (typeof ALLOWED_EXPORT_FORMATS)[number];

const NON_PRODUCTION_ENVS = ['local', 'development', 'staging'] as const;

export type PrivacyNonProductionEnvironment = (typeof NON_PRODUCTION_ENVS)[number];

export interface PrivacyScanResult {
  exposed: string[];
  status: 'PASS' | 'FAIL' | 'NOT_TESTED';
  expected?: string;
  actual?: string[];
  reason?: string;
}

export interface PrivacyRetentionPlan {
  status: 'NOT_IMPLEMENTED';
  reason: string;
}

/**
 * Structured log entry — valuePresent flags whether a value existed; the value itself
 * must never be supplied into reasons or evidence strings.
 */
export interface PrivacyLogEntry {
  key: string;
  valuePresent: boolean;
}

/**
 * Caller-supplied evidence only. No HTTP, no log-file reads, no delete, no export write.
 * Values in payload objects are ignored for classification (keys only).
 */
export interface PrivacyEvidence {
  /**
   * Field names found in a payload. Prefer this over walking values.
   * Missing together with payload → pii-exposure / sensitive-fields NOT_TESTED
   * (unless apiFields is set for sensitive-fields).
   */
  payloadKeys?: string[];
  /**
   * Optional payload object — only keys are inspected (nested). Values are never
   * copied into reasons. Prefer obvious placeholders if a fixture must include values.
   */
  payload?: unknown;
  /** Dedicated API response field names (sensitive-fields check). */
  apiFields?: string[];
  /** Structured log entries for secret / password-token checks. */
  logEntries?: PrivacyLogEntry[];
  /**
   * Explicit deletion outcome. There is no delete implementation.
   * 'succeeded' on local|development|staging → PASS; production → BLOCKED;
   * other explicit status → FAIL; missing → NOT_TESTED.
   */
  deletionStatus?: string;
  /**
   * Age of retained data in days (caller-supplied). Compared to policyDays:
   * retainedDays <= policyDays → PASS; retainedDays > policyDays → FAIL.
   */
  retainedDays?: number;
  /** Retention policy max age in days (caller-supplied). Missing either number → NOT_TESTED. */
  policyDays?: number;
  /**
   * Explicit export outcome. 'succeeded' with format json|csv|pdf → PASS;
   * other explicit status → FAIL; missing → NOT_TESTED. No export file is written.
   */
  exportStatus?: string;
  /** Export format when status is succeeded — must be json | csv | pdf. */
  exportFormat?: string;
}

/** Optional hooks for unit tests — must never be invoked (no deletion implementation). */
export interface PrivacyHooks {
  delete?: () => void;
  export?: () => void;
  enforceRetention?: () => void;
}

export interface RunPrivacyChecksInput {
  enabled: boolean;
  /** Used for data-deletion production gate. */
  environment?: string;
  evidence?: PrivacyEvidence;
  /** Optional; if present they must not be called. */
  hooks?: PrivacyHooks;
}

export const PRIVACY_CHECK_IDS = {
  notEnabled: 'privacy:not-enabled',
  piiExposure: 'privacy:pii-exposure',
  sensitiveFieldsInApiResponses: 'privacy:sensitive-fields-in-api-responses',
  logsContainingSecrets: 'privacy:logs-containing-secrets',
  logsContainingPasswordsTokens: 'privacy:logs-containing-passwords-tokens',
  dataDeletion: 'privacy:data-deletion',
  retention: 'privacy:retention',
  export: 'privacy:export',
} as const;

const TEST_TYPE = 'privacy';
const CATEGORY = 'specialized';

const LIMITS_NOTE =
  'caller evidence only — does not scan a live API, delete user data, enforce retention, or generate an export file; key-name checks are not a full privacy audit';

const PRODUCTION_DELETION_REASON =
  'deletion is not executed and production data is never deleted; live deletion is not implemented';

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

function listSet(keys: readonly string[]): Set<string> {
  return new Set(keys.map((k) => normalizeKey(k)));
}

const PII_SET = listSet(PII_FIELD_KEYS);
const SENSITIVE_API_SET = listSet(SENSITIVE_API_FIELD_KEYS);
const SECRET_LOG_SET = listSet(SECRET_LOG_KEYS);
const PASSWORD_TOKEN_LOG_SET = listSet(PASSWORD_TOKEN_LOG_KEYS);

function walk(value: unknown, path: string, found: string[]): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, path ? `${path}[${i}]` : `[${i}]`, found));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? `${path}.${key}` : key;
    if (SENSITIVE_KEY.test(key)) {
      found.push(next);
    }
    walk(child, next, found);
  }
}

/** Collect nested object key names (leaf keys only) — values are never returned. */
function collectKeyNames(value: unknown, out: string[]): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectKeyNames(item, out);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out.push(key);
    collectKeyNames(child, out);
  }
}

function canonicalFromNormalized(normalized: string): string | undefined {
  for (const list of [
    PII_FIELD_KEYS,
    SENSITIVE_API_FIELD_KEYS,
    SECRET_LOG_KEYS,
    PASSWORD_TOKEN_LOG_KEYS,
  ]) {
    for (const name of list) {
      if (normalizeKey(name) === normalized) return name;
    }
  }
  return undefined;
}

/** Return documented field names that appear in keys (case-insensitive). Never returns values. */
function matchingNames(keys: string[], allow: Set<string>): string[] {
  const hit = new Set<string>();
  for (const key of keys) {
    const n = normalizeKey(key);
    if (!n || !allow.has(n)) continue;
    hit.add(canonicalFromNormalized(n) ?? key.trim());
  }
  return [...hit].sort();
}

function resolvePayloadKeys(evidence: PrivacyEvidence | undefined): string[] | undefined {
  if (!evidence) return undefined;
  const fromArray = Array.isArray(evidence.payloadKeys)
    ? evidence.payloadKeys.filter((k) => typeof k === 'string')
    : undefined;
  const fromPayload =
    evidence.payload !== undefined && evidence.payload !== null
      ? (() => {
          const keys: string[] = [];
          collectKeyNames(evidence.payload, keys);
          return keys;
        })()
      : undefined;

  if (fromArray === undefined && fromPayload === undefined) return undefined;
  return [...(fromArray ?? []), ...(fromPayload ?? [])];
}

function safeReason(text: string): string {
  const redacted = redactSecrets(text);
  return typeof redacted === 'string' ? redacted : text;
}

function privacyResult(
  id: string,
  name: string,
  status: EngineResultStatus,
  options: {
    reason?: string;
    assertion?: { expected?: unknown; actual?: unknown };
    metadata?: Record<string, unknown>;
  } = {}
): TestResult {
  const reason = options.reason !== undefined ? safeReason(options.reason) : undefined;
  return makeResult({
    id,
    testType: TEST_TYPE,
    category: CATEGORY,
    name,
    status,
    ...(options.assertion ? { assertion: options.assertion } : {}),
    ...(reason
      ? { error: { message: reason }, metadata: { ...(options.metadata ?? {}), reason } }
      : options.metadata
        ? { metadata: options.metadata }
        : {}),
  });
}

/**
 * Walk a JSON-like object and return key paths matching sensitive key names.
 * Finding a key is FAIL (not PASS). Non-object → NOT_TESTED.
 * Values are never included in the result.
 */
export function scanSensitiveKeys(value: unknown): PrivacyScanResult & { result: TestResult } {
  if (value === null || typeof value !== 'object') {
    const reason = 'no JSON object to scan';
    return {
      exposed: [],
      status: 'NOT_TESTED',
      reason,
      result: makeResult({
        id: 'privacy:scan',
        testType: 'privacy',
        category: 'advanced',
        name: 'Sensitive key scan',
        status: 'NOT_TESTED',
        error: { message: reason },
        metadata: { reason },
      }),
    };
  }

  const exposed: string[] = [];
  walk(value, '', exposed);

  if (exposed.length > 0) {
    return {
      exposed,
      status: 'FAIL',
      expected: 'sensitive keys absent',
      actual: exposed,
      result: makeResult({
        id: 'privacy:scan',
        testType: 'privacy',
        category: 'advanced',
        name: 'Sensitive key scan',
        status: 'FAIL',
        assertion: { expected: 'sensitive keys absent', actual: exposed },
        error: { message: `sensitive keys found: ${exposed.join(', ')}` },
      }),
    };
  }

  return {
    exposed: [],
    status: 'PASS',
    expected: 'sensitive keys absent',
    actual: [],
    result: makeResult({
      id: 'privacy:scan',
      testType: 'privacy',
      category: 'advanced',
      name: 'Sensitive key scan',
      status: 'PASS',
      assertion: { expected: 'sensitive keys absent', actual: [] },
    }),
  };
}

/** Retention and deletion are not executed (live plan remains unimplemented). */
export function planPrivacyRetention(): PrivacyRetentionPlan {
  return {
    status: 'NOT_IMPLEMENTED',
    reason: 'retention and deletion are not executed',
  };
}

function checkPiiExposure(evidence: PrivacyEvidence | undefined): TestResult {
  const keys = resolvePayloadKeys(evidence);
  if (keys === undefined) {
    return privacyResult(PRIVACY_CHECK_IDS.piiExposure, 'PII exposure', 'NOT_TESTED', {
      reason: `payload keys were not supplied; ${LIMITS_NOTE}`,
    });
  }
  const hits = matchingNames(keys, PII_SET);
  if (hits.length > 0) {
    return privacyResult(PRIVACY_CHECK_IDS.piiExposure, 'PII exposure', 'FAIL', {
      reason: `PII field name(s) present: ${hits.join(', ')}; values are not recorded; ${LIMITS_NOTE}`,
      assertion: { expected: 'no PII keys', actual: hits },
    });
  }
  return privacyResult(PRIVACY_CHECK_IDS.piiExposure, 'PII exposure', 'PASS', {
    reason: `no PII field names in supplied keys; ${LIMITS_NOTE}`,
    assertion: { expected: 'no PII keys', actual: [] },
  });
}

function checkSensitiveApiFields(evidence: PrivacyEvidence | undefined): TestResult {
  const apiFields = Array.isArray(evidence?.apiFields)
    ? evidence!.apiFields.filter((k) => typeof k === 'string')
    : undefined;
  const payloadKeys = resolvePayloadKeys(evidence);
  if (apiFields === undefined && payloadKeys === undefined) {
    return privacyResult(
      PRIVACY_CHECK_IDS.sensitiveFieldsInApiResponses,
      'Sensitive fields in API responses',
      'NOT_TESTED',
      {
        reason: `apiFields / payload keys were not supplied; ${LIMITS_NOTE}`,
      }
    );
  }
  const keys = [...(apiFields ?? []), ...(payloadKeys ?? [])];
  const hits = matchingNames(keys, SENSITIVE_API_SET);
  if (hits.length > 0) {
    return privacyResult(
      PRIVACY_CHECK_IDS.sensitiveFieldsInApiResponses,
      'Sensitive fields in API responses',
      'FAIL',
      {
        reason: `sensitive field name(s) present: ${hits.join(', ')}; values are not recorded; ${LIMITS_NOTE}`,
        assertion: { expected: 'no sensitive keys', actual: hits },
      }
    );
  }
  return privacyResult(
    PRIVACY_CHECK_IDS.sensitiveFieldsInApiResponses,
    'Sensitive fields in API responses',
    'PASS',
    {
      reason: `no sensitive field names in supplied keys; ${LIMITS_NOTE}`,
      assertion: { expected: 'no sensitive keys', actual: [] },
    }
  );
}

function checkLogKeys(
  id: string,
  name: string,
  evidence: PrivacyEvidence | undefined,
  allow: Set<string>,
  label: string
): TestResult {
  if (!evidence || !Array.isArray(evidence.logEntries)) {
    return privacyResult(id, name, 'NOT_TESTED', {
      reason: `log entries were not supplied; ${LIMITS_NOTE}`,
    });
  }
  const hits: string[] = [];
  for (const entry of evidence.logEntries) {
    if (!entry || typeof entry.key !== 'string') continue;
    if (entry.valuePresent !== true) continue;
    const n = normalizeKey(entry.key);
    if (allow.has(n)) {
      hits.push(canonicalFromNormalized(n) ?? entry.key.trim());
    }
  }
  const unique = [...new Set(hits)].sort();
  if (unique.length > 0) {
    return privacyResult(id, name, 'FAIL', {
      reason: `${label} key(s) present with valuePresent=true: ${unique.join(', ')}; values are not recorded; ${LIMITS_NOTE}`,
      assertion: { expected: `no ${label} keys with values`, actual: unique },
    });
  }
  return privacyResult(id, name, 'PASS', {
    reason: `log entries present and no ${label} keys with valuePresent=true; ${LIMITS_NOTE}`,
    assertion: { expected: `no ${label} keys with values`, actual: [] },
  });
}

function checkDataDeletion(
  evidence: PrivacyEvidence | undefined,
  environment: string | undefined,
  hooks: PrivacyHooks | undefined
): TestResult {
  // hooks.delete must never be called — there is no delete implementation.
  void hooks;

  const envRaw = typeof environment === 'string' ? environment.trim() : '';
  if (envRaw === 'production') {
    return privacyResult(PRIVACY_CHECK_IDS.dataDeletion, 'Data deletion', 'BLOCKED', {
      reason: PRODUCTION_DELETION_REASON,
      metadata: { environment: 'production' },
    });
  }

  const status = evidence?.deletionStatus;
  if (status === undefined || status === null || String(status).trim() === '') {
    return privacyResult(PRIVACY_CHECK_IDS.dataDeletion, 'Data deletion', 'NOT_TESTED', {
      reason: `deletionStatus was not supplied; deletion is never invoked; ${LIMITS_NOTE}`,
    });
  }

  const normalized = String(status).trim();
  const isNonProd = (NON_PRODUCTION_ENVS as readonly string[]).includes(envRaw);

  if (normalized === 'succeeded') {
    if (!isNonProd) {
      return privacyResult(PRIVACY_CHECK_IDS.dataDeletion, 'Data deletion', 'NOT_TESTED', {
        reason: `deletionStatus=succeeded requires an explicit non-production environment (local|development|staging); deletion is never invoked; ${LIMITS_NOTE}`,
      });
    }
    return privacyResult(PRIVACY_CHECK_IDS.dataDeletion, 'Data deletion', 'PASS', {
      reason: `caller evidence reports deletionStatus=succeeded on ${envRaw}; deletion is never invoked; ${LIMITS_NOTE}`,
      assertion: { expected: 'succeeded', actual: normalized },
      metadata: { environment: envRaw },
    });
  }

  return privacyResult(PRIVACY_CHECK_IDS.dataDeletion, 'Data deletion', 'FAIL', {
    reason: `caller evidence reports deletionStatus=${JSON.stringify(normalized)}; expected succeeded; deletion is never invoked; ${LIMITS_NOTE}`,
    assertion: { expected: 'succeeded', actual: normalized },
  });
}

function checkRetention(evidence: PrivacyEvidence | undefined): TestResult {
  const retained = evidence?.retainedDays;
  const policy = evidence?.policyDays;
  if (typeof retained !== 'number' || typeof policy !== 'number' || Number.isNaN(retained) || Number.isNaN(policy)) {
    return privacyResult(PRIVACY_CHECK_IDS.retention, 'Retention', 'NOT_TESTED', {
      reason: `retainedDays and/or policyDays were not supplied as numbers; retention is not enforced; ${LIMITS_NOTE}`,
    });
  }
  if (retained < 0 || policy < 0) {
    return privacyResult(PRIVACY_CHECK_IDS.retention, 'Retention', 'NOT_TESTED', {
      reason: `retainedDays and policyDays must be >= 0; retention is not enforced; ${LIMITS_NOTE}`,
    });
  }
  // Comparison: retainedDays <= policyDays → PASS; retainedDays > policyDays → FAIL.
  if (retained <= policy) {
    return privacyResult(PRIVACY_CHECK_IDS.retention, 'Retention', 'PASS', {
      reason: `retainedDays (${retained}) <= policyDays (${policy}); retention is not enforced and expired data is not deleted; ${LIMITS_NOTE}`,
      assertion: { expected: 'retainedDays <= policyDays', actual: { retainedDays: retained, policyDays: policy } },
    });
  }
  return privacyResult(PRIVACY_CHECK_IDS.retention, 'Retention', 'FAIL', {
    reason: `retainedDays (${retained}) > policyDays (${policy}); retention is not enforced and expired data is not deleted; ${LIMITS_NOTE}`,
    assertion: { expected: 'retainedDays <= policyDays', actual: { retainedDays: retained, policyDays: policy } },
  });
}

function checkExport(evidence: PrivacyEvidence | undefined, hooks: PrivacyHooks | undefined): TestResult {
  // hooks.export must never be called — no export file is written.
  void hooks;

  const status = evidence?.exportStatus;
  if (status === undefined || status === null || String(status).trim() === '') {
    return privacyResult(PRIVACY_CHECK_IDS.export, 'Export', 'NOT_TESTED', {
      reason: `exportStatus was not supplied; export files are not written; ${LIMITS_NOTE}`,
    });
  }
  const normalized = String(status).trim();
  if (normalized === 'succeeded') {
    const formatRaw =
      typeof evidence?.exportFormat === 'string' ? evidence.exportFormat.trim().toLowerCase() : '';
    if ((ALLOWED_EXPORT_FORMATS as readonly string[]).includes(formatRaw)) {
      return privacyResult(PRIVACY_CHECK_IDS.export, 'Export', 'PASS', {
        reason: `caller evidence reports exportStatus=succeeded with format=${formatRaw}; export files are not written and row values are not recorded; ${LIMITS_NOTE}`,
        assertion: { expected: 'succeeded', actual: normalized },
        metadata: { exportFormat: formatRaw },
      });
    }
    return privacyResult(PRIVACY_CHECK_IDS.export, 'Export', 'FAIL', {
      reason: `exportStatus=succeeded but format must be one of json|csv|pdf; export files are not written; ${LIMITS_NOTE}`,
      assertion: { expected: 'json|csv|pdf', actual: formatRaw || '(missing)' },
    });
  }
  return privacyResult(PRIVACY_CHECK_IDS.export, 'Export', 'FAIL', {
    reason: `caller evidence reports exportStatus=${JSON.stringify(normalized)}; expected succeeded; export files are not written; ${LIMITS_NOTE}`,
    assertion: { expected: 'succeeded', actual: normalized },
  });
}

/**
 * Classify caller-supplied privacy evidence into normalized TestResult rows.
 * Shared with security callers — does not check tests.privacy.enabled.
 * Never invokes delete/export/retention hooks. Never echoes secret values.
 */
export function classifyPrivacyEvidence(
  evidence: PrivacyEvidence,
  options: { environment?: string; hooks?: PrivacyHooks } = {}
): TestResult[] {
  return [
    checkPiiExposure(evidence),
    checkSensitiveApiFields(evidence),
    checkLogKeys(
      PRIVACY_CHECK_IDS.logsContainingSecrets,
      'Logs containing secrets',
      evidence,
      SECRET_LOG_SET,
      'secret'
    ),
    checkLogKeys(
      PRIVACY_CHECK_IDS.logsContainingPasswordsTokens,
      'Logs containing passwords/tokens',
      evidence,
      PASSWORD_TOKEN_LOG_SET,
      'password/token'
    ),
    checkDataDeletion(evidence, options.environment, options.hooks),
    checkRetention(evidence),
    checkExport(evidence, options.hooks),
  ];
}

/**
 * Optional privacy checks. Disabled → single NOT_APPLICABLE (privacy:not-enabled).
 * Enabled → seven evidence-driven results (missing evidence → NOT_TESTED per check).
 * No HTTP, no delete, no retention enforcement, no export file write.
 */
export function runPrivacyChecks(input: RunPrivacyChecksInput): TestResult[] {
  if (input.enabled !== true) {
    return [
      privacyResult(PRIVACY_CHECK_IDS.notEnabled, 'Privacy testing', 'NOT_APPLICABLE', {
        reason:
          'privacy testing is not enabled for this application; live deletion, retention enforcement, and export jobs are not executed; key-name checks are not a full privacy audit',
      }),
    ];
  }

  const evidence = input.evidence ?? {};
  return classifyPrivacyEvidence(evidence, {
    environment: input.environment,
    hooks: input.hooks,
  });
}
