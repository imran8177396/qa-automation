/**
 * Role / permission plans for the existing planner.
 * Consumed only by buildScenarioInventory → planRolePermissions — not a second planner.
 * Never invents Admin/User/Manager/Viewer unless those strings are in the caller role list.
 * Never fetches URLs, never calls APIs, never clicks. Never assumes 403/200.
 */

import {
  evaluateHttpStatus,
  lookupStatus,
  type HttpStatusEvalResult,
} from '../lib/api/http-status-matrix';
import type { QaEnvironmentName } from '../core/platform/environment';
import type {
  CheckKind,
  CheckStatus,
  InventoryCategory,
  PlannedAction,
  PlannedCheck,
} from './types';

/** Matrix evaluation result token — not a PlannedCheck status; use as reason prefix. */
export const SPECIFICATION_REQUIRED: HttpStatusEvalResult = 'SPECIFICATION_REQUIRED';

const ROLES_NOT_CONFIGURED_REASON = 'roles were not configured';
const RULE_NOT_CONFIGURED_REASON = 'permission rule for this role was not configured';
const RULE_ROLE_NOT_IN_LIST_REASON = 'rule role is not in the configured role list';
const PRODUCTION_API_BLOCKED_REASON =
  'permission checks that would call an API are not authorized against production';

export interface RolePermissionRule {
  role: string;
  effect: 'allowed' | 'forbidden';
  /** UI control kind or accessible-name token, e.g. 'edit-button'. */
  controlKind?: string;
  /** Direct URL already in the page map. */
  url?: string;
  /** When true, this rule is about an API call. No URL is fetched. */
  api?: boolean;
  /** Only when the API spec says so. Do not default to 403. */
  expectedStatus?: number | null;
}

export type RoleSubcaseId =
  | 'role-unconfigured'
  | 'role-allowed-action'
  | 'role-forbidden-action'
  | 'role-direct-url'
  | 'role-hidden-ui'
  | 'role-api-authorization'
  | 'role-rule-unknown-role';

export interface RoleElementInput {
  elementId: string;
  screenId: string;
  type: string;
  accessibleName?: string | null;
  disabled?: boolean;
}

export interface RoleScreenInput {
  id: string;
  url: string;
}

export interface RolePermissionPlan {
  subcaseId: RoleSubcaseId;
  role?: string;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  category: InventoryCategory;
  reason?: string;
  expect?: PlannedCheck['expect'];
  targetElementId?: string;
  targetUrl?: string;
  screenId?: string;
  /** Never true — role plans are observe-only; never click/submit/fetch. */
  executable: false;
  metadata?: {
    authorizationRelated?: boolean;
    /** Present only when a real response status was supplied by the caller. Never invented. */
    actualStatus?: number | null;
    expectedStatus?: number | null;
  };
}

export interface RolePlanningOptions {
  environment?: QaEnvironmentName;
  authorizeDestructive?: boolean;
  authorizeAuthenticatedDiscovery?: boolean;
  /**
   * Actual HTTP status from a prior executed call only.
   * The planner never invents this; omit when no response exists.
   */
  actualStatusByRule?: ReadonlyMap<string, number> | null;
}

const UNCONFIGURED_SUBCASES: RoleSubcaseId[] = [
  'role-allowed-action',
  'role-forbidden-action',
  'role-direct-url',
  'role-hidden-ui',
  'role-api-authorization',
];

function specificationRequiredStatus(detail: string): { status: CheckStatus; reason: string } {
  return {
    status: 'NOT_TESTED',
    reason: `${SPECIFICATION_REQUIRED}: ${detail}`,
  };
}

function kindWord(controlKind: string): string {
  const trimmed = controlKind.trim().toLowerCase();
  const withoutButton = trimmed.replace(/-button$/i, '').replace(/-/g, ' ').trim();
  return withoutButton || trimmed;
}

function elementMatchesControlKind(
  element: RoleElementInput,
  controlKind: string
): boolean {
  const kind = controlKind.trim().toLowerCase();
  if (!kind) return false;
  const type = (element.type ?? '').toLowerCase();
  if (type === kind || type.includes(kind)) return true;
  const word = kindWord(kind);
  const name = (element.accessibleName ?? '').trim().toLowerCase();
  if (name && word && name.startsWith(word)) return true;
  return false;
}

function findMatchingElements(
  elements: RoleElementInput[],
  controlKind: string
): RoleElementInput[] {
  return elements.filter((el) => elementMatchesControlKind(el, controlKind));
}

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || '/';
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search || ''}${parsed.hash || ''}`;
  } catch {
    return url.trim();
  }
}

function screenHasUrl(screens: RoleScreenInput[], url: string): RoleScreenInput | undefined {
  const key = canonicalUrl(url);
  return screens.find((s) => canonicalUrl(s.url) === key);
}

function productionBlocksApiCalls(options?: RolePlanningOptions): boolean {
  if (options?.environment !== 'production') return false;
  return !(
    options.authorizeDestructive === true || options.authorizeAuthenticatedDiscovery === true
  );
}

function ruleKey(rule: RolePermissionRule, index: number): string {
  return `${rule.role}:${rule.effect}:${rule.controlKind ?? ''}:${rule.url ?? ''}:api=${Boolean(rule.api)}:${index}`;
}

function basePlan(partial: Omit<RolePermissionPlan, 'executable' | 'category' | 'kind'> & {
  kind?: CheckKind;
  category?: InventoryCategory;
}): RolePermissionPlan {
  return {
    kind: partial.kind ?? 'security-observation',
    category: partial.category ?? 'security',
    executable: false,
    subcaseId: partial.subcaseId,
    role: partial.role,
    title: partial.title,
    status: partial.status,
    action: partial.action,
    reason: partial.reason,
    expect: partial.expect,
    targetElementId: partial.targetElementId,
    targetUrl: partial.targetUrl,
    screenId: partial.screenId,
    metadata: partial.metadata,
  };
}

function planUnconfiguredRoles(): RolePermissionPlan[] {
  return [
    basePlan({
      subcaseId: 'role-unconfigured',
      title: 'role permissions — roles were not configured',
      status: 'REQUIRES_CONFIGURATION',
      action: 'none',
      reason: `REQUIRES_CONFIGURATION: ${ROLES_NOT_CONFIGURED_REASON}`,
    }),
  ];
}

function planMissingRulesForRole(role: string): RolePermissionPlan[] {
  return UNCONFIGURED_SUBCASES.map((subcaseId) => {
    const { status, reason } = specificationRequiredStatus(RULE_NOT_CONFIGURED_REASON);
    return basePlan({
      subcaseId,
      role,
      title: `${role} — ${subcaseId}`,
      status,
      action: 'none',
      reason,
    });
  });
}

function planAllowedControl(
  role: string,
  controlKind: string,
  elements: RoleElementInput[]
): RolePermissionPlan {
  const matches = findMatchingElements(elements, controlKind);
  if (matches.length === 0) {
    return basePlan({
      subcaseId: 'role-allowed-action',
      role,
      title: `${role} — role-allowed-action (${controlKind})`,
      status: 'NOT_TESTED',
      action: 'none',
      reason: 'NOT_TESTED: control was not discovered',
      expect: { note: 'control is present', control: 'button' },
    });
  }

  const disabled = matches.find((el) => el.disabled === true);
  if (disabled) {
    return basePlan({
      subcaseId: 'role-allowed-action',
      role,
      title: `${role} — role-allowed-action (${controlKind})`,
      status: 'FAIL',
      action: 'observe',
      reason: 'FAIL: allowed control is disabled',
      targetElementId: disabled.elementId,
      screenId: disabled.screenId,
      expect: { note: 'control is present', enabled: false, control: 'button' },
    });
  }

  const first = matches[0]!;
  return basePlan({
    subcaseId: 'role-allowed-action',
    role,
    title: `${role} — role-allowed-action (${controlKind})`,
    status: 'PLANNED',
    action: 'observe',
    reason: 'PLANNED: observe allowed control is present — do not click',
    targetElementId: first.elementId,
    screenId: first.screenId,
    expect: { note: 'control is present', enabled: true, control: 'button' },
  });
}

function planForbiddenControl(
  role: string,
  controlKind: string,
  elements: RoleElementInput[]
): RolePermissionPlan[] {
  const matches = findMatchingElements(elements, controlKind);
  const plans: RolePermissionPlan[] = [];

  if (matches.length === 0) {
    const absentReason =
      kindWord(controlKind) === 'edit' || controlKind.toLowerCase().includes('edit')
        ? 'edit control was not discovered'
        : 'control was not discovered';
    plans.push(
      basePlan({
        subcaseId: 'role-forbidden-action',
        role,
        title: `${role} — role-forbidden-action (${controlKind})`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: `NOT_TESTED: ${absentReason}`,
      })
    );
    plans.push(
      basePlan({
        subcaseId: 'role-hidden-ui',
        role,
        title: `${role} — role-hidden-ui (${controlKind})`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: 'NOT_TESTED: hidden state was not distinguished from not loaded',
      })
    );
    return plans;
  }

  const usable = matches.find((el) => el.disabled !== true);
  if (usable) {
    plans.push(
      basePlan({
        subcaseId: 'role-forbidden-action',
        role,
        title: `${role} — role-forbidden-action (${controlKind})`,
        status: 'FAIL',
        action: 'observe',
        reason: 'FAIL: forbidden control is usable in the scan',
        targetElementId: usable.elementId,
        screenId: usable.screenId,
        expect: { enabled: true, control: 'button', note: 'observe only — do not click' },
      })
    );
  } else {
    const disabled = matches[0]!;
    plans.push(
      basePlan({
        subcaseId: 'role-forbidden-action',
        role,
        title: `${role} — role-forbidden-action (${controlKind})`,
        status: 'PASS',
        action: 'observe',
        reason: 'PASS: forbidden control is disabled',
        targetElementId: disabled.elementId,
        screenId: disabled.screenId,
        expect: { enabled: false, control: 'button', note: 'observe only — do not click' },
      })
    );
  }

  // Presence means we cannot claim "hidden"; absence is handled above.
  plans.push(
    basePlan({
      subcaseId: 'role-hidden-ui',
      role,
      title: `${role} — role-hidden-ui (${controlKind})`,
      status: 'NOT_TESTED',
      action: 'observe',
      reason: 'NOT_TESTED: control is present in the scan; hidden was not confirmed',
      targetElementId: matches[0]!.elementId,
      screenId: matches[0]!.screenId,
      expect: { note: 'observe only — do not click', control: 'button' },
    })
  );

  return plans;
}

function planDirectUrl(
  role: string,
  rule: RolePermissionRule,
  screens: RoleScreenInput[],
  options?: RolePlanningOptions
): RolePermissionPlan {
  const url = rule.url!;
  if (productionBlocksApiCalls(options) && rule.effect === 'forbidden') {
    return basePlan({
      subcaseId: 'role-direct-url',
      role,
      title: `${role} — role-direct-url`,
      status: 'BLOCKED',
      action: 'none',
      reason: `BLOCKED: ${PRODUCTION_API_BLOCKED_REASON}`,
      targetUrl: url,
      metadata: { authorizationRelated: true, expectedStatus: rule.expectedStatus ?? null },
    });
  }

  const screen = screenHasUrl(screens, url);
  if (!screen) {
    return basePlan({
      subcaseId: 'role-direct-url',
      role,
      title: `${role} — role-direct-url`,
      status: 'NOT_TESTED',
      action: 'none',
      reason: 'NOT_TESTED: URL was not in the page map',
      targetUrl: url,
      metadata: { authorizationRelated: true, expectedStatus: rule.expectedStatus ?? null },
    });
  }

  const expected = rule.expectedStatus;
  if (expected == null) {
    const { status, reason } = specificationRequiredStatus(
      'authorization result was not specified for direct URL access'
    );
    return basePlan({
      subcaseId: 'role-direct-url',
      role,
      title: `${role} — role-direct-url`,
      status: 'PLANNED',
      action: 'observe',
      reason: `PLANNED: URL was recorded in the page map; ${reason}`,
      targetUrl: url,
      screenId: screen.id,
      expect: { href: url, note: 'observe recorded URL only — do not fetch' },
      metadata: { authorizationRelated: true, expectedStatus: null },
    });
  }

  // expectedStatus set but planner has no actual response — never invent 403/actual.
  const expectedEntry = lookupStatus(expected);
  const expectedLabel = expectedEntry?.name ? `${expected} (${expectedEntry.name})` : String(expected);
  return basePlan({
    subcaseId: 'role-direct-url',
    role,
    title: `${role} — role-direct-url`,
    status: 'NOT_TESTED',
    action: 'none',
    reason: `NOT_TESTED: direct URL was not requested; expected ${expectedLabel} was not executed`,
    targetUrl: url,
    screenId: screen.id,
    expect: { href: url, note: 'do not fetch' },
    metadata: { authorizationRelated: true, expectedStatus: expected },
  });
}

function planApiAuthorization(
  role: string,
  rule: RolePermissionRule,
  ruleIndex: number,
  options?: RolePlanningOptions
): RolePermissionPlan {
  if (productionBlocksApiCalls(options) && rule.effect === 'forbidden') {
    return basePlan({
      subcaseId: 'role-api-authorization',
      role,
      title: `${role} — role-api-authorization`,
      status: 'BLOCKED',
      action: 'none',
      reason: `BLOCKED: ${PRODUCTION_API_BLOCKED_REASON}`,
      metadata: {
        authorizationRelated: true,
        expectedStatus: rule.expectedStatus ?? null,
      },
    });
  }

  const expected = rule.expectedStatus;
  const actualFromMap = options?.actualStatusByRule?.get(ruleKey(rule, ruleIndex));
  const hasActual = actualFromMap != null && Number.isFinite(actualFromMap);

  // Only evaluate when both expected and an actual response exist — never invent actual.
  if (expected != null && hasActual) {
    const evaluation = evaluateHttpStatus({ expected, actual: actualFromMap });
    let status: CheckStatus = 'NOT_TESTED';
    let reasonPrefix: string = SPECIFICATION_REQUIRED;
    if (evaluation.result === 'PASS') {
      status = 'PASS';
      reasonPrefix = 'PASS';
    } else if (evaluation.result === 'FAIL') {
      status = 'FAIL';
      reasonPrefix = 'FAIL';
    }
    return basePlan({
      subcaseId: 'role-api-authorization',
      role,
      title: `${role} — role-api-authorization`,
      status,
      action: 'none',
      reason: `${reasonPrefix}: ${evaluation.reason}`,
      metadata: {
        authorizationRelated: true,
        expectedStatus: expected,
        actualStatus: actualFromMap,
      },
    });
  }

  if (expected == null) {
    const { status, reason } = specificationRequiredStatus('expected status was not specified');
    return basePlan({
      subcaseId: 'role-api-authorization',
      role,
      title: `${role} — role-api-authorization`,
      status,
      action: 'none',
      reason: `NOT_TESTED: API authorization was not executed; ${reason}`,
      metadata: { authorizationRelated: true, expectedStatus: null },
    });
  }

  const expectedEntry = lookupStatus(expected);
  const expectedLabel = expectedEntry?.name ? `${expected} (${expectedEntry.name})` : String(expected);
  const notSent =
    expected === 403
      ? 'expected 403 was not sent'
      : `expected ${expectedLabel} was not sent`;
  return basePlan({
    subcaseId: 'role-api-authorization',
    role,
    title: `${role} — role-api-authorization`,
    status: 'NOT_TESTED',
    action: 'none',
    reason: `NOT_TESTED: API authorization was not executed; ${notSent}`,
    metadata: { authorizationRelated: true, expectedStatus: expected },
  });
}

function plansFromRule(
  rule: RolePermissionRule,
  ruleIndex: number,
  elements: RoleElementInput[],
  screens: RoleScreenInput[],
  options?: RolePlanningOptions
): RolePermissionPlan[] {
  if (rule.api === true) {
    return [planApiAuthorization(rule.role, rule, ruleIndex, options)];
  }
  if (rule.url) {
    return [planDirectUrl(rule.role, rule, screens, options)];
  }
  if (rule.controlKind) {
    if (rule.effect === 'allowed') {
      return [planAllowedControl(rule.role, rule.controlKind, elements)];
    }
    return planForbiddenControl(rule.role, rule.controlKind, elements);
  }

  const { status, reason } = specificationRequiredStatus(
    'permission rule had no controlKind, url, or api target'
  );
  return [
    basePlan({
      subcaseId: 'role-forbidden-action',
      role: rule.role,
      title: `${rule.role} — role rule incomplete`,
      status,
      action: 'none',
      reason,
    }),
  ];
}

/**
 * Build role/permission inventory rows from configured roles and rules only.
 * Never invents role names. Never fetches, clicks, or assumes HTTP 403/200.
 */
export function buildRolePermissionPlans(input: {
  roles?: string[] | null;
  rules?: RolePermissionRule[] | null;
  elements?: RoleElementInput[];
  screens?: RoleScreenInput[];
  options?: RolePlanningOptions;
}): RolePermissionPlan[] {
  const roles = input.roles;
  const rules = input.rules ?? [];
  const elements = input.elements ?? [];
  const screens = input.screens ?? [];
  const options = input.options;

  if (roles == null || roles.length === 0) {
    return planUnconfiguredRoles();
  }

  const roleSet = new Set(roles);
  const plans: RolePermissionPlan[] = [];
  const rulesByRole = new Map<string, Array<{ rule: RolePermissionRule; index: number }>>();

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]!;
    if (!roleSet.has(rule.role)) {
      plans.push(
        basePlan({
          subcaseId: 'role-rule-unknown-role',
          role: rule.role,
          title: `role rule ignored — ${rule.role} not in configured role list`,
          status: 'NOT_TESTED',
          action: 'none',
          reason: `NOT_TESTED: ${RULE_ROLE_NOT_IN_LIST_REASON}`,
        })
      );
      continue;
    }
    const list = rulesByRole.get(rule.role) ?? [];
    list.push({ rule, index });
    rulesByRole.set(rule.role, list);
  }

  for (const role of roles) {
    const roleRules = rulesByRole.get(role);
    if (!roleRules || roleRules.length === 0) {
      plans.push(...planMissingRulesForRole(role));
      continue;
    }
    for (const { rule, index } of roleRules) {
      plans.push(...plansFromRule(rule, index, elements, screens, options));
    }
  }

  // Safety: never mark click/submit executable.
  for (const plan of plans) {
    plan.executable = false;
    if (plan.action === 'click-button' || plan.action === 'click-link') {
      plan.action = 'none';
      plan.status = 'BLOCKED';
      plan.reason = 'BLOCKED: role permission plans never click';
    }
  }

  return plans;
}
