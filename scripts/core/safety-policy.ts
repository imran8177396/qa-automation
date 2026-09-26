import type { SafetyConfig } from '../types';

export type RiskLabel = 'safe' | 'caution' | 'destructive' | 'unknown';

/**
 * Valid recorded outcome statuses for engine / report rows.
 * NOT_APPLICABLE is retained because engine-contract already uses it.
 * PASS and FAIL do not require a reason; the four reason-required statuses must.
 */
export const RECORDED_OUTCOME_STATUSES = [
  'PASS',
  'FAIL',
  'BLOCKED',
  'NOT_TESTED',
  'SKIPPED',
  'REQUIRES_CONFIGURATION',
  'NOT_APPLICABLE',
  'TIMEOUT',
  'CANCELLED',
  'FLAKY',
] as const;

export type RecordedOutcomeStatus = (typeof RECORDED_OUTCOME_STATUSES)[number];

const REASON_REQUIRED_STATUSES = [
  'BLOCKED',
  'NOT_TESTED',
  'SKIPPED',
  'REQUIRES_CONFIGURATION',
  'TIMEOUT',
  'CANCELLED',
  'FLAKY',
] as const;

export type ReasonRequiredStatus = (typeof REASON_REQUIRED_STATUSES)[number];

/** Desktop browser-engine emulation only — never real-device coverage. */
export const REAL_DEVICE_EMULATION_DISCLAIMER =
  'Results are desktop browser-engine emulation, not real-device testing.';

/** Automated axe is not a WCAG conformance or certification claim. */
export const A11Y_AUTOMATED_LIMIT =
  'Automated axe checks are not full WCAG compliance.';

/**
 * Explicit Never list — enforced in code via the helpers in this module
 * (and existing authorize / performance / resilience gates). Not comments-only.
 */
export const SAFETY_PROHIBITIONS = [
  'Never fabricate results — do not synthesize PASS rows for missing evidence.',
  'Never silently skip missing dependencies — record BLOCKED or NOT_TESTED with a reason.',
  'Never claim real-device coverage from desktop browser-engine emulation.',
  'Never claim WCAG compliant, full WCAG, or WCAG AA certified from automated axe alone.',
  'Never run heavy performance profiles against arbitrary production without authorization.',
  'Never run destructive resilience / chaos without authorization.',
  'Never automatically delete production data — backup/restore checks never delete data in any environment.',
  'Never log secret or credential values.',
  'Never commit .env (keep it gitignored; .env.example may stay).',
  'Never weaken assertions, thresholds, status codes, or axe severity to force PASS.',
] as const;

export interface RecordedOutcomeLike {
  status: string;
  reason?: string;
  error?: { message?: string };
  metadata?: Record<string, unknown>;
}

export function reasonRequired(status: string): boolean {
  return (REASON_REQUIRED_STATUSES as readonly string[]).includes(status);
}

/** Non-empty reason from reason / error.message / metadata.reason. */
export function recordedOutcomeReason(result: RecordedOutcomeLike): string {
  if (typeof result.reason === 'string' && result.reason.trim()) {
    return result.reason.trim();
  }
  const errorMessage = result.error?.message;
  if (typeof errorMessage === 'string' && errorMessage.trim()) {
    return errorMessage.trim();
  }
  const metaReason = result.metadata?.reason;
  if (typeof metaReason === 'string' && metaReason.trim()) {
    return metaReason.trim();
  }
  return '';
}

/**
 * Throws when BLOCKED | NOT_TESTED | SKIPPED | REQUIRES_CONFIGURATION | TIMEOUT | CANCELLED | FLAKY lack a reason.
 * PASS and FAIL do not need a reason. Never maps those reason-required statuses to PASS.
 */
export function assertRecordedOutcome(result: RecordedOutcomeLike): void {
  if (!reasonRequired(result.status)) return;
  if (!recordedOutcomeReason(result)) {
    throw new Error(
      `Recorded outcome status ${result.status} requires a non-empty reason (reason, error.message, or metadata.reason)`
    );
  }
}

/**
 * Fails when a report string claims real-device coverage while realDevice is false.
 * Allows the standard emulation disclaimer (which contains "not real-device").
 */
export function assertNoRealDeviceClaim(text: string, realDevice = false): void {
  if (realDevice) return;
  const forbidden = [
    /\breal[- ]device coverage\b/i,
    /\bcoverage on real[- ]devices?\b/i,
    /\btested on real[- ]devices?\b/i,
    /\breal[- ]device certified\b/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      throw new Error(
        `Report claims real-device coverage while realDevice is false: ${text.slice(0, 200)}`
      );
    }
  }
}

/**
 * Fails on positive WCAG compliance / certification claims.
 * Allows negations such as A11Y_AUTOMATED_LIMIT ("not full WCAG compliance").
 */
export function assertNoFullWcagClaim(text: string): void {
  if (/WCAG compliant/i.test(text) || /WCAG AA certified/i.test(text)) {
    throw new Error(`Report must not claim WCAG compliance/certification: ${text.slice(0, 200)}`);
  }
  if (/full WCAG/i.test(text) && !/not full WCAG/i.test(text)) {
    throw new Error(`Report must not claim full WCAG: ${text.slice(0, 200)}`);
  }
}

export interface SafetyConfigResolved {
  enabled: boolean;
  dangerKeywords: string[];
  allowlist: Array<{ url: string; selector: string; reason: string }>;
}

const DEFAULT_DANGER_KEYWORDS = [
  'delete',
  'remove',
  'destroy',
  'purchase',
  'buy now',
  'checkout',
  'pay',
  'payment',
  'subscribe',
  'unsubscribe',
  'deactivate',
  'cancel account',
  'close account',
  'send payment',
  'send money',
  'submit order',
  'confirm order',
  'place order',
  'log out all',
  'logout',
  'log out',
  'sign out',
  'signout',
  'reset app state',
  'terminate',
  'reset password',
  'change password',
];

export function resolveSafetyConfig(input?: SafetyConfig): SafetyConfigResolved {
  return {
    enabled: input?.enabled ?? true,
    dangerKeywords: input?.dangerKeywords ?? DEFAULT_DANGER_KEYWORDS,
    allowlist: input?.allowlist ?? [],
  };
}

export interface ClassifiableCandidate {
  text?: string;
  ariaLabel?: string;
  href?: string;
  formMethod?: string;
  /** Page URL the candidate was found on — matched against config.allowlist entries. */
  pageUrl?: string;
  /** Locator/selector identifying the candidate — matched against config.allowlist entries. */
  selector?: string;
}

/**
 * Report-only risk labeling. This NEVER authorizes execution — see authorize() below, which is
 * hardcoded and does not consult this function. A pure keyword blocklist is a false-negative trap
 * (icon-only buttons, non-English labels, dynamically-injected text all sail through unmatched),
 * so classify() exists only to surface risk to a human in the report, not to gate automation.
 *
 * safety.enabled=false skips labeling entirely (returns 'unknown'). A safety.allowlist entry whose
 * url and selector both match the candidate downgrades the result to 'safe' — this only affects the
 * report label, never authorize()'s hardcoded execution gate.
 */
export function classify(candidate: ClassifiableCandidate, config: SafetyConfigResolved): RiskLabel {
  if (!config.enabled) return 'unknown';

  const isAllowlisted = config.allowlist.some(
    (entry) => entry.url === candidate.pageUrl && entry.selector === candidate.selector
  );
  if (isAllowlisted) return 'safe';

  const haystack = [candidate.text, candidate.ariaLabel, candidate.href]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  const isStateChangingGet = Boolean(
    candidate.href && /[?&](action|do|cmd)=(delete|remove|cancel|deactivate)/i.test(candidate.href)
  );

  if (!haystack && !candidate.formMethod) return 'unknown';

  const matchesKeyword = config.dangerKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
  if (matchesKeyword || isStateChangingGet) return 'destructive';

  const method = candidate.formMethod?.toUpperCase();
  if (method && method !== 'GET') return 'caution';

  return 'safe';
}

export interface AuthorizableAction {
  kind: 'click-link' | 'click-button' | 'submit-form' | 'fill-field';
  isSubmitControl?: boolean;
  /** True when the action is bound to a POST/PUT/PATCH/DELETE request, or a non-idempotent GET. */
  correlatesWithStateChange?: boolean;
}

/**
 * Default-deny gate for anything an automatically-generated check might do. This is hardcoded and
 * intentionally NOT driven by classify()'s keyword output — the asymmetry between a false negative
 * (a real destructive action fires) and a false positive (a form only gets field-presence checks
 * instead of a live submit) means the safe default has to hold even when classification is wrong
 * or absent. No generated check may submit a form or trigger a state-changing request, ever, in
 * this framework phase, regardless of config.
 */
export function authorize(action: AuthorizableAction): boolean {
  if (action.kind === 'submit-form') return false;
  if (action.kind === 'click-button' && action.isSubmitControl) return false;
  if (action.correlatesWithStateChange) return false;
  return action.kind === 'click-link' || action.kind === 'fill-field' || action.kind === 'click-button';
}

/** Replacement token used by redactSecrets (execution logs map this to [MASKED]). */
export const REDACTED_PLACEHOLDER = '[REDACTED]' as const;

const ALREADY_MASKED = new Set(['[REDACTED]', '[MASKED]']);

/**
 * Keys whose values are always redacted (case-insensitive substring match).
 * Covers passwords, API keys, tokens, cookies, session material, and common PII keys.
 */
const SECRET_KEY_PATTERN =
  /password|passwd|secret|api[_-]?key|token|authorization|set-cookie|cookie|session|ssn|email|phone/i;

/** Inline `password=…` / `token: …` / `cookie: …` style assignments in free-form text. */
const SECRET_ASSIGNMENT_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|authorization|set-cookie|cookie|session|ssn)\s*[=:]\s*[^\s&;,]+/gi;

/** Bearer token material — keep the label, mask the secret portion. */
const BEARER_TOKEN_PATTERN = /\bBearer\s+(?!\[(?:REDACTED|MASKED)\])[^\s,;]+/gi;

/** URL userinfo (https://user:pass@host) — mask credentials before the host. */
const URL_USERINFO_PATTERN = /(https?:\/\/)([^/\s"'<>]+@)/gi;

/** Email-shaped substrings (PII). */
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Phone-like digit runs (7+ digits with optional separators). */
const PHONE_PATTERN = /(?<![A-Za-z0-9])(?:\+?\d[\d\s().-]{6,}\d)(?![A-Za-z0-9])/g;

/**
 * Redact secret-like field values in plain objects / arrays / strings.
 * Object keys matching password|passwd|secret|token|api_key|cookie|authorization|session|ssn|email|phone
 * become `[REDACTED]`. Strings with assignments, Bearer tokens, URL userinfo, emails, and
 * phone-like digit strings have secret/PII portions replaced with `[REDACTED]`.
 * Already-masked `[REDACTED]` / `[MASKED]` values are left alone (no double-wrap).
 * Never returns raw secret-like values. Used by observability, safety-budget, and makeResult.
 */
export function redactSecrets<T>(value: T): T {
  return redactSecretsInner(value) as T;
}

function redactSecretAssignmentsInString(text: string): string {
  if (ALREADY_MASKED.has(text.trim())) {
    return text.trim() === '[MASKED]' ? '[MASKED]' : REDACTED_PLACEHOLDER;
  }
  let out = text.replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=${REDACTED_PLACEHOLDER}`);
  out = out.replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED_PLACEHOLDER}`);
  out = out.replace(URL_USERINFO_PATTERN, (_m, protocol: string) => `${protocol}${REDACTED_PLACEHOLDER}@`);
  out = out.replace(EMAIL_PATTERN, REDACTED_PLACEHOLDER);
  out = out.replace(PHONE_PATTERN, REDACTED_PLACEHOLDER);
  return out;
}

function redactSecretsInner(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSecretAssignmentsInString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretsInner(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = REDACTED_PLACEHOLDER;
      } else {
        out[key] = redactSecretsInner(nested);
      }
    }
    return out;
  }
  return value;
}
