/**
 * Explainable priority for planned / unique test cases.
 * First-matching rule wins (highest band first). No numeric score, grade, or
 * product-type switch — only evidence signals on the case itself.
 */

export type TestPriority = 'critical' | 'high' | 'medium' | 'low' | 'unspecified';

export interface PriorityDecision {
  priority: TestPriority;
  reason: string;
  ruleId: string;
}

export interface AssignTestPriorityInput {
  category?: string | null;
  scenarioKind?: string | null;
  scenario?: string | null;
  elementType?: string | null;
  controlLabel?: string | null;
  url?: string | null;
  title?: string | null;
  existingPriority?: string | null;
}

const SOURCE_PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);

/** Login subcase / case-id token in title or scenario (e.g. login-wrong-password). */
const LOGIN_CASE_ID = /\blogin-[a-z0-9-]+\b/i;

/** Word match for payment-related labels or URL paths — not a product module. */
const PAYMENT_WORD = /pay|payment|checkout|billing/i;

const CRUD_NAME = /\b(create|edit|save)\b/i;

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function lower(value: string | null | undefined): string {
  return (nonEmpty(value) ?? '').toLowerCase();
}

/** Pathname only — never invents hosts; relative paths stay as given. */
export function urlPathname(url: string | null | undefined): string {
  const raw = nonEmpty(url);
  if (!raw) return '';
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      return new URL(raw).pathname;
    }
  } catch {
    // Fall through to slash-based parse.
  }
  const withoutQuery = raw.split(/[?#]/, 1)[0] ?? raw;
  const slash = withoutQuery.indexOf('/');
  if (slash >= 0) return withoutQuery.slice(slash);
  return withoutQuery;
}

function haystack(...parts: Array<string | null | undefined>): string {
  return parts.map((p) => nonEmpty(p) ?? '').filter(Boolean).join(' ');
}

/**
 * Assign an explainable priority from case signals.
 * Explicit source priority (critical|high|medium|low) always wins — even when
 * other signals (e.g. delete-button) would otherwise raise the band.
 */
export function assignTestPriority(input: AssignTestPriorityInput): PriorityDecision {
  const existing = lower(input.existingPriority);
  if (SOURCE_PRIORITIES.has(existing)) {
    return {
      priority: existing as Exclude<TestPriority, 'unspecified'>,
      reason: 'priority was already set on the test case',
      ruleId: 'source-priority',
    };
  }

  const kind = lower(input.scenarioKind);
  const category = lower(input.category);
  const elementType = lower(input.elementType);
  const scenario = nonEmpty(input.scenario) ?? '';
  const title = nonEmpty(input.title) ?? '';
  const controlLabel = nonEmpty(input.controlLabel) ?? '';
  const path = urlPathname(input.url);
  const titleOrScenario = haystack(title, scenario);
  const labelTitlePath = haystack(controlLabel, title, path);

  // --- CRITICAL (ordered) ---
  if (kind === 'login' || LOGIN_CASE_ID.test(titleOrScenario)) {
    return {
      priority: 'critical',
      reason: 'authentication case',
      ruleId: 'auth',
    };
  }

  if (elementType === 'delete-button' || /\bdelete\b/i.test(scenario)) {
    return {
      priority: 'critical',
      reason: 'data deletion control',
      ruleId: 'data-deletion',
    };
  }

  if (
    kind === 'role' ||
    (kind === 'security-context' &&
      (/\bauthorization\b/i.test(titleOrScenario) || /\bsession\b/i.test(titleOrScenario)))
  ) {
    return {
      priority: 'critical',
      reason: 'authorization or session case',
      ruleId: 'authorization',
    };
  }

  if (PAYMENT_WORD.test(labelTitlePath)) {
    return {
      priority: 'critical',
      reason: 'payment-related label or path',
      ruleId: 'payments',
    };
  }

  if (kind === 'workflow' && /\bworkflow-happy\b/i.test(titleOrScenario)) {
    return {
      priority: 'critical',
      reason: 'multi-step navigation workflow',
      ruleId: 'core-workflow',
    };
  }

  // --- HIGH ---
  if (kind === 'form' || elementType === 'submit-button' || category === 'form') {
    return {
      priority: 'high',
      reason: 'form submission case',
      ruleId: 'core-form',
    };
  }

  if (
    elementType === 'save-button' ||
    elementType === 'edit-button' ||
    CRUD_NAME.test(controlLabel)
  ) {
    return {
      priority: 'high',
      reason: 'create, edit, or save control',
      ruleId: 'core-crud',
    };
  }

  if (kind === 'link' || elementType === 'link') {
    return {
      priority: 'high',
      reason: 'navigation link',
      ruleId: 'navigation',
    };
  }

  // --- MEDIUM ---
  if (elementType === 'search-field' || /dynamic-search/i.test(scenario)) {
    return {
      priority: 'medium',
      reason: 'search',
      ruleId: 'search',
    };
  }

  if (/filter/i.test(elementType) || /dynamic-filter/i.test(scenario)) {
    return {
      priority: 'medium',
      reason: 'filter',
      ruleId: 'filter',
    };
  }

  if (/pagination/i.test(elementType) || /\bpagination\b/i.test(titleOrScenario)) {
    return {
      priority: 'medium',
      reason: 'pagination',
      ruleId: 'secondary-workflow',
    };
  }

  if (/settings/i.test(haystack(title, path))) {
    return {
      priority: 'medium',
      reason: 'settings',
      ruleId: 'settings',
    };
  }

  // --- LOW ---
  if (kind === 'visual' || kind === 'accessibility' || kind === 'responsive') {
    return {
      priority: 'low',
      reason: 'non-functional presentation or assistive check',
      ruleId: 'minor-ui',
    };
  }

  if (kind === 'state-transition') {
    return {
      priority: 'low',
      reason: 'state specification check',
      ruleId: 'non-critical-state',
    };
  }

  return {
    priority: 'unspecified',
    reason: 'no priority rule matched',
    ruleId: 'none',
  };
}
