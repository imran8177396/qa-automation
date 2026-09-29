export type CheckStatus =
  | 'PLANNED'
  | 'PASS'
  | 'FAIL'
  | 'BLOCKED'
  | 'NOT_TESTED'
  | 'REQUIRES_CONFIGURATION'
  | 'NOT_APPLICABLE';

/**
 * High-level inventory scenario taxonomy. Distinct from CheckKind (harness procedure).
 * Applicable categories become planned/blocked rows; excluded categories are summarized.
 * Keep scenarioKind "edge" for boundary (tests assert it); use PlannedCheck.category "boundary".
 * "usability-accessibility" is legacy — new rows use accessibility | usability.
 */
export type ScenarioKind =
  | 'positive'
  | 'negative'
  | 'edge'
  | 'field'
  | 'button'
  | 'link'
  | 'form'
  | 'login'
  | 'role'
  | 'api-ui'
  | 'validation'
  | 'security'
  /** Context-aware security plans (sec-*); distinct from password security-observation rows. */
  | 'security-context'
  | 'accessibility'
  | 'usability'
  | 'usability-accessibility'
  | 'workflow'
  | 'state-transition'
  | 'visual'
  /** Discovery-driven file / pagination / search+filter rows (dynamic-*). */
  | 'dynamic'
  | 'page-reached';

/**
 * Inventory category names (fixed list). boundary aliases scenarioKind "edge".
 */
export type InventoryCategory =
  | 'positive'
  | 'negative'
  | 'boundary'
  | 'validation'
  | 'security'
  | 'accessibility'
  | 'usability';

/**
 * Generic purpose from discovery evidence only (tag/role/type/name/href).
 * Never invent business meaning (checkout, pay, etc.).
 */
export type ElementPurpose =
  | 'navigation-link'
  | 'button'
  | 'text-input'
  | 'password-input'
  | 'hidden-input'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'form'
  | 'unknown';

/** Planned action — never submit or a state-changing click marked executable. */
export type PlannedAction = 'observe' | 'fill-no-submit' | 'click-link' | 'click-button' | 'none';

export type CheckKind =
  | 'page-sanity'
  | 'broken-link'
  | 'form-presence'
  | 'form-boundary'
  | 'visibility'
  | 'enabled-state'
  | 'editability'
  | 'required-state'
  | 'required-validation'
  | 'accessible-name'
  | 'valid-input'
  | 'invalid-input'
  | 'empty-input'
  | 'whitespace-input'
  | 'long-input'
  | 'unicode-input'
  | 'special-characters'
  | 'validation-state'
  | 'error-recovery'
  | 'boundary-values'
  | 'click-behavior'
  | 'click-link'
  | 'click-button'
  | 'link-href'
  | 'navigation'
  | 'select-options'
  | 'select-change'
  | 'toggle-state'
  | 'form-submit'
  | 'security-observation'
  | 'keyboard-focus'
  | 'visual-observation';

export type ControlKind = 'text' | 'select' | 'checkbox' | 'radio' | 'link' | 'button' | 'component';

export interface PlannedCheck {
  id: string;
  kind: CheckKind;
  title: string;
  targetUrl: string;
  targetElementId?: string;
  status: CheckStatus;
  /** Present when status !== 'PLANNED'. Prefixed with the status, e.g. "BLOCKED: ...". */
  reason?: string;
  /** Inventory taxonomy — optional for backward-compatible planned-check rows. */
  scenarioKind?: ScenarioKind;
  /**
   * Inventory category alias for the fixed applicability list.
   * When scenarioKind is "edge", category is "boundary". Prefer this for reporting.
   */
  category?: InventoryCategory;
  /** Generic purpose from scan evidence — optional on legacy rows. */
  purpose?: ElementPurpose;
  /** Safe action class — never "submit". Optional on legacy rows. */
  action?: PlannedAction;
  /** Screen/page URL for inventory grouping — defaults to targetUrl when omitted. */
  screenUrl?: string;
  /** SCREEN-NNN when planning from buildScreenInventory. */
  screenId?: string;
  expect?: {
    requireH1?: boolean;
    requireHeading?: boolean;
    constraintInvalid?: boolean;
    locator?: string;
    visible?: boolean;
    enabled?: boolean;
    required?: boolean;
    boundary?: boolean;
    href?: string;
    accessibleName?: string | null;
    fillValue?: string;
    recoveryValue?: string;
    control?: ControlKind;
    /** Planned checkbox/radio checked state (fill-no-submit observation only). */
    checked?: boolean;
    readOnly?: boolean;
    min?: string;
    max?: string;
    maxLength?: string;
    inputType?: string;
    autocomplete?: string;
    /** Planner note (e.g. capped fixture length, assertion plan). Never a PASS claim. */
    note?: string;
  };
}

/**
 * Normalize planned-checks.json payloads. Accepts the legacy array shape.
 * Unknown fields are preserved via cast; missing optional inventory fields stay undefined.
 */
export function parsePlannedChecks(raw: unknown): PlannedCheck[] {
  if (!Array.isArray(raw)) return [];
  const out: PlannedCheck[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.kind !== 'string' || typeof record.title !== 'string') {
      continue;
    }
    if (typeof record.targetUrl !== 'string' || typeof record.status !== 'string') continue;
    out.push(row as PlannedCheck);
  }
  return out;
}
