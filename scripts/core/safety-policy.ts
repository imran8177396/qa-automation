import type { SafetyConfig } from '../types';

export type RiskLabel = 'safe' | 'caution' | 'destructive' | 'unknown';

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
