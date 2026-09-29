/**
 * Context-aware security plan rows for the existing planner.
 * Consumed only by buildScenarioInventory → planSecurityContextForScreen.
 * Not a second security engine — scripts/run-security.ts remains the runtime.
 *
 * Planning only: never fetch, never forge CSRF, never write upload bytes, never
 * execute exploits. Default authorizeDestructive is false.
 * Inert fixtures only (script-like-fixture) — never a payload catalog.
 */

import { maskExecutionLogString } from '../core/platform/observability';
import {
  DEFAULT_ENVIRONMENT,
  type QaEnvironmentName,
} from '../core/platform/environment';
import type { PageMapEntry } from '../discovery/page-map';
import type { DiscoveredScreen } from '../discovery/screens';
import { canonicalScreenUrl } from '../discovery/screens';
import type { UiElementRecord } from '../discovery/ui-scan';
import { JAVASCRIPT_HREF_NOT_FOLLOWED_REASON } from './link-cases';
import { isLoginScreen } from './login-cases';
import type { RolePermissionRule } from './role-cases';
import type {
  CheckKind,
  CheckStatus,
  InventoryCategory,
  PlannedAction,
  PlannedCheck,
} from './types';

/** Page-map row plus optional crawl request fields when present (same shape as link-cases). */
type SecurityPageEvidence = PageMapEntry & {
  requested?: string;
  redirectFrom?: string;
};

/** Inert tokens only — never tags, event handlers, or executable script. */
export const SECURITY_FIXTURES = {
  scriptLike: 'script-like-fixture',
} as const;

export const PRODUCTION_SECURITY_BLOCKED_REASON =
  'destructive security checks are not authorized against production';

const INJECTION_REASON =
  'inert fixture; not an exploit; form is not submitted';
const XSS_EXCLUSION_REASON =
  'XSS-like input is represented by the inert fixture only; no script payload is generated';
const AUTH_BYPASS_REASON = 'authorization bypass is not executed';
const IDOR_NOT_REQUESTED_REASON = 'IDOR-style access is not requested';
const IDOR_IDS_MISSING_REASON =
  'resource ids were not supplied; IDOR check is not executed';
const SENSITIVE_REASON =
  'sensitive field is inventoried; values are not logged';
const REDIRECT_NOT_FOLLOWED_REASON = 'redirect target was not followed';
const SESSION_REASON = 'session was not read or modified';
const CSRF_REASON =
  'CSRF behavior is not executed; no forged request is sent';
const FILE_UPLOAD_REASON =
  'file bytes are not written; upload validation is not executed; see field-file-* plans when present';
const SEC_NONE_REASON =
  'no security-relevant control was discovered on this screen';

const JAVASCRIPT_HREF = /^javascript:/i;

export type SecuritySubcaseId =
  | 'sec-input-injection'
  | 'sec-xss-like'
  | 'sec-authorization-bypass'
  | 'sec-idor'
  | 'sec-sensitive-data'
  | 'sec-unsafe-redirect'
  | 'sec-session'
  | 'sec-csrf'
  | 'sec-file-upload'
  | 'sec-none';

export interface SecuritySubcasePlan {
  subcaseId: SecuritySubcaseId;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  category: InventoryCategory;
  reason?: string;
  expect?: PlannedCheck['expect'];
  targetElementId?: string;
  /** Always false — planning never executes attacks. */
  executable: false;
}

export interface SecurityCaseResult {
  plans: SecuritySubcasePlan[];
}

export interface SecurityPlanningOptions {
  environment?: QaEnvironmentName;
  /** Defaults to false. Never set true from this module. */
  authorizeDestructive?: boolean;
  hasAuthSession?: boolean;
  /**
   * Two resource ids for IDOR planning — never invented; caller must supply both.
   * Omit / null / incomplete → IDOR stays NOT_TESTED when requestUrl exists.
   */
  resourceIds?: readonly [string, string] | null;
  /** Role/permission rules already known to the caller — never invent. */
  permissionRules?: RolePermissionRule[] | null;
  /**
   * Subcase ids already planned for this screen (e.g. login-injection).
   * When login-injection is present, sec-input-injection is omitted.
   */
  existingSubcaseIds?: ReadonlySet<string> | readonly string[] | null;
}

export interface BuildSecurityPlansInput {
  screen: DiscoveredScreen;
  elements: UiElementRecord[];
  pages?: SecurityPageEvidence[];
  options?: SecurityPlanningOptions;
}

function statusReason(status: CheckStatus, detail: string): string {
  const trimmed = detail.trim().replace(
    /^(NOT_TESTED|PLANNED|BLOCKED|NOT_APPLICABLE|REQUIRES_CONFIGURATION):\s*/i,
    ''
  );
  return `${status}: ${trimmed}`;
}

function basePlan(
  partial: Omit<SecuritySubcasePlan, 'executable' | 'category' | 'kind'> & {
    kind?: CheckKind;
    category?: InventoryCategory;
  }
): SecuritySubcasePlan {
  return {
    kind: partial.kind ?? 'security-observation',
    category: partial.category ?? 'security',
    executable: false,
    subcaseId: partial.subcaseId,
    title: partial.title,
    status: partial.status,
    action: partial.action,
    reason: partial.reason,
    expect: partial.expect,
    targetElementId: partial.targetElementId,
  };
}

function resolveKind(el: UiElementRecord): string {
  return String(el.elementKind ?? el.type ?? '').toLowerCase();
}

function inputTypeOf(el: UiElementRecord): string {
  return (el.inputType ?? '').toLowerCase();
}

/** Fillable text / search / textarea — not password or file. */
export function isInjectionTextField(el: UiElementRecord): boolean {
  const kind = resolveKind(el);
  const inputType = inputTypeOf(el);
  if (
    inputType === 'password' ||
    inputType === 'file' ||
    inputType === 'hidden' ||
    inputType === 'checkbox' ||
    inputType === 'radio' ||
    inputType === 'submit' ||
    inputType === 'button'
  ) {
    return false;
  }
  if (kind === 'password-input' || kind === 'file-upload' || kind === 'hidden-input') {
    return false;
  }
  if (kind === 'text-input' || kind === 'search-field' || kind === 'textarea') return true;
  if (el.elementType === 'textarea' || el.elementType === 'search') return true;
  if (el.elementType === 'input') {
    return (
      !inputType ||
      inputType === 'text' ||
      inputType === 'search' ||
      inputType === 'url' ||
      inputType === 'tel' ||
      inputType === 'email'
    );
  }
  return false;
}

export function isFileUploadField(el: UiElementRecord): boolean {
  return (
    inputTypeOf(el) === 'file' ||
    resolveKind(el) === 'file-upload' ||
    el.elementType === 'file-upload'
  );
}

export function isSensitiveInventoryField(el: UiElementRecord): boolean {
  const kind = resolveKind(el);
  const inputType = inputTypeOf(el);
  if (inputType === 'password' || kind === 'password-input') return true;
  if (inputType === 'email' || kind === 'email-input') return true;
  if (el.requestBody != null && String(el.requestBody).length > 0) return true;
  const blob = `${el.accessibleName ?? ''} ${el.label ?? ''} ${el.evidence ?? ''}`.toLowerCase();
  if (/\b(privacy|ssn|secret|token|password|email)\b/i.test(blob)) return true;
  return false;
}

function isFormElement(el: UiElementRecord): boolean {
  return el.elementType === 'form' || resolveKind(el) === 'form';
}

function isSubmitControl(el: UiElementRecord): boolean {
  if (el.isSubmit) return true;
  const kind = resolveKind(el);
  if (kind === 'submit-button') return true;
  if (inputTypeOf(el) === 'submit') return true;
  const name = (el.accessibleName ?? '').toLowerCase();
  if (el.elementType === 'button' && /\bsubmit\b/i.test(name)) return true;
  return false;
}

export function hasFormWithSubmit(elements: UiElementRecord[]): boolean {
  return elements.some(isFormElement) && elements.some(isSubmitControl);
}

function hasExistingSubcase(
  existing: SecurityPlanningOptions['existingSubcaseIds'],
  subcaseId: string
): boolean {
  if (!existing) return false;
  const list = existing instanceof Set ? [...existing] : [...existing];
  return list.some(
    (id) =>
      id === subcaseId ||
      id.endsWith(`-${subcaseId}`) ||
      id.endsWith(subcaseId)
  );
}

function productionBlocksActive(
  environment: QaEnvironmentName,
  authorizeDestructive: boolean
): boolean {
  return environment === 'production' && authorizeDestructive !== true;
}

function pageForScreen(
  screen: DiscoveredScreen,
  pages: SecurityPageEvidence[]
): SecurityPageEvidence | undefined {
  const key = canonicalScreenUrl(screen.url);
  return pages.find(
    (p) =>
      canonicalScreenUrl(p.url) === key ||
      (p.finalUrl != null && canonicalScreenUrl(p.finalUrl) === key)
  );
}

function hasAuthBypassContext(
  screen: DiscoveredScreen,
  pages: SecurityPageEvidence[],
  options?: SecurityPlanningOptions
): boolean {
  if ((options?.permissionRules?.length ?? 0) > 0) return true;
  const page = pageForScreen(screen, pages);
  if (page?.access === 'gated') return true;
  if (screen.state === 'permission-denied' || screen.state === 'unauthenticated') return true;
  return false;
}

function hostsDiffer(pageUrl: string, href: string): boolean {
  try {
    const page = new URL(pageUrl);
    const target = new URL(href, pageUrl);
    return page.host !== target.host;
  } catch {
    return false;
  }
}

function hasRedirectEvidence(page: SecurityPageEvidence): boolean {
  const requested = page.requested ?? page.redirectFrom ?? page.url;
  const finalUrl = page.finalUrl ?? page.url;
  if (canonicalScreenUrl(requested) !== canonicalScreenUrl(finalUrl)) return true;
  return (page.redirects?.length ?? 0) > 0;
}

function findPageEvidence(
  destination: string,
  pages: SecurityPageEvidence[]
): SecurityPageEvidence | undefined {
  const key = canonicalScreenUrl(destination);
  for (const page of pages) {
    if (canonicalScreenUrl(page.url) === key) return page;
    if (page.finalUrl && canonicalScreenUrl(page.finalUrl) === key) return page;
    if (page.requested && canonicalScreenUrl(page.requested) === key) return page;
    if (page.redirectFrom && canonicalScreenUrl(page.redirectFrom) === key) return page;
  }
  return undefined;
}

function findUnsafeRedirect(
  screen: DiscoveredScreen,
  elements: UiElementRecord[],
  pages: SecurityPageEvidence[]
):
  | { kind: 'javascript'; element: UiElementRecord }
  | { kind: 'external-redirect'; element: UiElementRecord }
  | null {
  for (const el of elements) {
    if (el.elementType !== 'link' && resolveKind(el) !== 'link' && !(el.href ?? '').trim()) {
      continue;
    }
    const href = (el.href ?? '').trim();
    if (!href) continue;
    if (JAVASCRIPT_HREF.test(href)) {
      return { kind: 'javascript', element: el };
    }
    if (hostsDiffer(screen.url, href)) {
      const absolute = (() => {
        try {
          return new URL(href, screen.url).href;
        } catch {
          return href;
        }
      })();
      const evidence = findPageEvidence(absolute, pages);
      if (evidence && hasRedirectEvidence(evidence)) {
        return { kind: 'external-redirect', element: el };
      }
      // Also: screen itself recorded a redirect from a different host request
      if (screen.redirectFrom) {
        try {
          const fromHost = new URL(screen.redirectFrom).host;
          const pageHost = new URL(screen.url).host;
          if (fromHost !== pageHost) {
            return { kind: 'external-redirect', element: el };
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  return null;
}

function findElementWithRequestUrl(elements: UiElementRecord[]): UiElementRecord | undefined {
  return elements.find((el) => el.requestUrl != null && String(el.requestUrl).trim() !== '');
}

function twoResourceIds(
  ids: SecurityPlanningOptions['resourceIds']
): ids is readonly [string, string] {
  return (
    Array.isArray(ids) &&
    ids.length >= 2 &&
    typeof ids[0] === 'string' &&
    ids[0].trim() !== '' &&
    typeof ids[1] === 'string' &&
    ids[1].trim() !== ''
  );
}

function maskRecordedValue(el: UiElementRecord): string | undefined {
  const raw =
    (el.requestBody != null && String(el.requestBody)) ||
    el.attributes?.value ||
    el.attributes?.['data-value'] ||
    undefined;
  if (raw == null || raw === '') return undefined;
  return maskExecutionLogString(String(raw));
}

/**
 * Build context-aware security plan rows for one discovered screen.
 * Emits a category only when context matches. Never PASS. Never executable.
 */
export function buildSecurityPlansForScreen(input: BuildSecurityPlansInput): SecurityCaseResult {
  const { screen, elements, pages = [], options } = input;
  const environment = options?.environment ?? DEFAULT_ENVIRONMENT;
  const authorizeDestructive = options?.authorizeDestructive === true;
  const blockActive = productionBlocksActive(environment, authorizeDestructive);
  const hasAuthSession = options?.hasAuthSession === true;
  const loginScreen = isLoginScreen({
    screen,
    elements,
    page: pageForScreen(screen, pages),
  });
  const label = `${screen.id} security`;
  const plans: SecuritySubcasePlan[] = [];

  const textField = elements.find(isInjectionTextField);
  const skipInjection = hasExistingSubcase(options?.existingSubcaseIds, 'login-injection');

  // --- input injection ---
  if (textField && !skipInjection) {
    if (blockActive) {
      plans.push(
        basePlan({
          subcaseId: 'sec-input-injection',
          title: `${label} — sec-input-injection`,
          status: 'BLOCKED',
          action: 'none',
          reason: statusReason('BLOCKED', PRODUCTION_SECURITY_BLOCKED_REASON),
          targetElementId: textField.elementId,
        })
      );
    } else {
      plans.push(
        basePlan({
          subcaseId: 'sec-input-injection',
          title: `${label} — sec-input-injection`,
          status: 'PLANNED',
          action: 'fill-no-submit',
          reason: statusReason('PLANNED', INJECTION_REASON),
          targetElementId: textField.elementId,
          expect: {
            fillValue: SECURITY_FIXTURES.scriptLike,
            locator: textField.locator ?? undefined,
            control: 'text',
            note: INJECTION_REASON,
          },
        })
      );
    }
  }

  // --- XSS-like (exclusion only; never a second fixture) ---
  if (textField) {
    plans.push(
      basePlan({
        subcaseId: 'sec-xss-like',
        title: `${label} — sec-xss-like`,
        status: 'NOT_APPLICABLE',
        action: 'none',
        reason: statusReason('NOT_APPLICABLE', XSS_EXCLUSION_REASON),
        targetElementId: textField.elementId,
        expect: {
          note: XSS_EXCLUSION_REASON,
        },
      })
    );
  }

  // --- authorization bypass ---
  if (hasAuthBypassContext(screen, pages, options)) {
    plans.push(
      basePlan({
        subcaseId: 'sec-authorization-bypass',
        title: `${label} — sec-authorization-bypass`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: statusReason('NOT_TESTED', AUTH_BYPASS_REASON),
      })
    );
  }

  // --- IDOR-style ---
  const requestEl = findElementWithRequestUrl(elements);
  if (requestEl) {
    const hasIds = twoResourceIds(options?.resourceIds);
    plans.push(
      basePlan({
        subcaseId: 'sec-idor',
        title: `${label} — sec-idor`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: statusReason(
          'NOT_TESTED',
          hasIds ? IDOR_NOT_REQUESTED_REASON : IDOR_IDS_MISSING_REASON
        ),
        targetElementId: requestEl.elementId,
        expect: {
          href: requestEl.requestUrl ?? undefined,
          note: hasIds
            ? 'two resource ids were supplied; IDOR is not executed'
            : 'requestUrl present; resource ids were not supplied',
        },
      })
    );
  }

  // --- sensitive data exposure ---
  const sensitive = elements.find(isSensitiveInventoryField);
  if (sensitive) {
    const masked = maskRecordedValue(sensitive);
    plans.push(
      basePlan({
        subcaseId: 'sec-sensitive-data',
        title: `${label} — sec-sensitive-data`,
        status: 'PLANNED',
        action: 'observe',
        reason: statusReason('PLANNED', SENSITIVE_REASON),
        targetElementId: sensitive.elementId,
        expect: {
          locator: sensitive.locator ?? undefined,
          inputType: sensitive.inputType ?? undefined,
          note: masked ? `masked inventory: ${masked}` : SENSITIVE_REASON,
        },
      })
    );
  }

  // --- unsafe redirects ---
  const unsafe = findUnsafeRedirect(screen, elements, pages);
  if (unsafe?.kind === 'javascript') {
    plans.push(
      basePlan({
        subcaseId: 'sec-unsafe-redirect',
        title: `${label} — sec-unsafe-redirect`,
        status: 'BLOCKED',
        action: 'none',
        reason: JAVASCRIPT_HREF_NOT_FOLLOWED_REASON,
        targetElementId: unsafe.element.elementId,
        expect: {
          note: 'javascript href scheme; payload is not stored',
        },
      })
    );
  } else if (unsafe?.kind === 'external-redirect') {
    plans.push(
      basePlan({
        subcaseId: 'sec-unsafe-redirect',
        title: `${label} — sec-unsafe-redirect`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: statusReason('NOT_TESTED', REDIRECT_NOT_FOLLOWED_REASON),
        targetElementId: unsafe.element.elementId,
      })
    );
  }

  // --- session issues ---
  if (loginScreen || hasAuthSession) {
    plans.push(
      basePlan({
        subcaseId: 'sec-session',
        title: `${label} — sec-session`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: statusReason('NOT_TESTED', SESSION_REASON),
      })
    );
  }

  // --- CSRF-related ---
  if (hasFormWithSubmit(elements)) {
    plans.push(
      basePlan({
        subcaseId: 'sec-csrf',
        title: `${label} — sec-csrf`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: statusReason('NOT_TESTED', CSRF_REASON),
        expect: {
          note: 'no forged body; CSRF is not executed',
        },
      })
    );
  }

  // --- file upload validation ---
  const fileField = elements.find(isFileUploadField);
  if (fileField) {
    plans.push(
      basePlan({
        subcaseId: 'sec-file-upload',
        title: `${label} — sec-file-upload`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: statusReason('NOT_TESTED', FILE_UPLOAD_REASON),
        targetElementId: fileField.elementId,
        expect: {
          inputType: 'file',
          note: FILE_UPLOAD_REASON,
        },
      })
    );
  }

  if (plans.length === 0) {
    plans.push(
      basePlan({
        subcaseId: 'sec-none',
        title: `${label} — sec-none`,
        status: 'NOT_APPLICABLE',
        action: 'none',
        reason: statusReason('NOT_APPLICABLE', SEC_NONE_REASON),
      })
    );
  }

  return { plans };
}

/**
 * Collect existing inventory row suffixes for a screen (e.g. login-injection).
 */
export function collectExistingSubcaseIds(
  checks: ReadonlyArray<{ id?: string; screenId?: string }>,
  screenId: string
): Set<string> {
  const out = new Set<string>();
  for (const row of checks) {
    if (row.screenId !== screenId || typeof row.id !== 'string') continue;
    const parts = row.id.split('-');
    // INV-0001-login-injection → login-injection (last two segments when compound)
    if (parts.length >= 2) {
      const last = parts[parts.length - 1]!;
      const prev = parts[parts.length - 2]!;
      if (/^\d+$/.test(prev) || /^INV$/i.test(prev) || /^SCREEN/i.test(prev)) {
        out.add(last);
      } else {
        out.add(`${prev}-${last}`);
      }
    }
    // Also store the raw trailing token after the INV-NNNN prefix
    const m = row.id.match(/^INV-\d+-(.+)$/i);
    if (m?.[1]) out.add(m[1]);
  }
  return out;
}
