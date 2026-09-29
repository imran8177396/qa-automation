/**
 * API–UI relationship chains for the existing planner.
 * Consumed only by buildScenarioInventory → planApiUi — not a second engine.
 * Association only: never sends HTTP, never clicks submit/delete, never claims a database effect.
 * Evidence-only: never invent method, body, status codes, or destinations.
 */

import { maskExecutionLogString } from '../core/platform/observability';
import { evaluateHttpStatus } from '../lib/api/http-status-matrix';
import { canonicalScreenUrl, type DiscoveredScreen } from '../discovery/screens';
import type { UiElementRecord } from '../discovery/ui-scan';
import type {
  CheckKind,
  CheckStatus,
  InventoryCategory,
  PlannedAction,
  PlannedCheck,
} from './types';

/** Evidence fields that may appear on a scan record when discovery recorded them. */
export type ApiUiEvidenceFields = {
  requestMethod?: string | null;
  requestBody?: string | null;
  expectedStatus?: number | null;
  actualStatus?: number | null;
};

export type ApiUiElement = UiElementRecord & ApiUiEvidenceFields;

export interface ApiUiChain {
  chainId: string; // CHAIN-001 per screen, stable
  screenId: string;
  elementId: string;
  method: string | null;
  url: string | null;
  database: 'NOT_OBSERVED';
}

export type ApiUiSubcaseId =
  | 'api-ui-behavior'
  | 'api-ui-request'
  | 'api-ui-payload'
  | 'api-ui-response'
  | 'api-ui-ui-state'
  | 'api-ui-error-handling'
  | 'api-ui-database';

export interface ApiUiChainPlan {
  subcaseId: ApiUiSubcaseId;
  chainId: string;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  category: InventoryCategory;
  reason?: string;
  expect?: PlannedCheck['expect'];
  targetElementId: string;
  screenId: string;
  /**
   * Status-match evaluation never claims end-to-end success.
   * Always false or null — never true.
   */
  completeSuccess: false | null;
  /** Masked request body when a fixture string existed — never raw secrets. */
  maskedPayload?: string;
}

export interface ApiUiChainResult {
  chain: ApiUiChain;
  plans: ApiUiChainPlan[];
}

export interface BuildApiUiChainsInput {
  elements: ApiUiElement[];
  screens: DiscoveredScreen[];
  /** Fallback screen id when element.screenId is absent (e.g. SCREEN-001). */
  defaultScreenId?: string;
  /** Page URL used to resolve sibling success/error screen states. */
  pageUrl?: string;
  label?: string;
  /**
   * Optional shared CHAIN-NNN counters keyed by screenId.
   * When omitted, a fresh counter map is used for this call.
   */
  seqByScreen?: Map<string, { n: number }>;
}

function observedRequestUrl(element: ApiUiElement): string | undefined {
  const url = (element.requestUrl ?? '').trim();
  return url.length > 0 ? url : undefined;
}

/**
 * Method from requestMethod or attributes only — never defaults to POST.
 */
export function resolveApiUiMethod(element: ApiUiElement): string | null {
  const fromField = element.requestMethod;
  if (typeof fromField === 'string' && fromField.trim()) {
    return fromField.trim();
  }
  const attrs = element.attributes ?? {};
  for (const key of ['method', 'data-method', 'requestMethod', 'request-method'] as const) {
    const value = attrs[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function observedRequestBody(element: ApiUiElement): string | undefined {
  const body = element.requestBody;
  if (typeof body !== 'string') return undefined;
  const trimmed = body.trim();
  return trimmed.length > 0 ? body : undefined;
}

function finiteStatus(value: number | null | undefined): number | undefined {
  if (value == null || typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function hasSiblingSuccessOrErrorState(screens: DiscoveredScreen[], pageUrl: string): boolean {
  const key = canonicalScreenUrl(pageUrl);
  return screens.some((screen) => {
    if (canonicalScreenUrl(screen.url) !== key) return false;
    const state = String(screen.state).toLowerCase();
    return state === 'success' || state === 'error';
  });
}

function nextChainId(seq: { n: number }): string {
  seq.n += 1;
  return `CHAIN-${String(seq.n).padStart(3, '0')}`;
}

function basePlan(input: {
  subcaseId: ApiUiSubcaseId;
  chainId: string;
  label: string;
  status: CheckStatus;
  action: PlannedAction;
  reason?: string;
  expect?: PlannedCheck['expect'];
  targetElementId: string;
  screenId: string;
  completeSuccess?: false | null;
  maskedPayload?: string;
  kind?: CheckKind;
  category?: InventoryCategory;
}): ApiUiChainPlan {
  const plan: ApiUiChainPlan = {
    subcaseId: input.subcaseId,
    chainId: input.chainId,
    kind: input.kind ?? 'click-behavior',
    title: `${input.label} — ${input.subcaseId} (${input.chainId})`,
    status: input.status,
    action: input.action,
    category: input.category ?? 'positive',
    targetElementId: input.targetElementId,
    screenId: input.screenId,
    completeSuccess: input.completeSuccess === undefined ? null : input.completeSuccess,
  };
  if (input.reason) plan.reason = input.reason;
  if (input.expect) plan.expect = input.expect;
  if (input.maskedPayload !== undefined) plan.maskedPayload = input.maskedPayload;
  return plan;
}

/**
 * Build one association chain and its validation rows for a single element.
 * Returns null when requestUrl is empty — zero chains, no invented API.
 */
export function buildApiUiChainForElement(input: {
  element: ApiUiElement;
  screenId: string;
  chainId: string;
  screens: DiscoveredScreen[];
  pageUrl: string;
  label: string;
}): ApiUiChainResult | null {
  const url = observedRequestUrl(input.element);
  if (!url) return null;

  const method = resolveApiUiMethod(input.element);
  const chain: ApiUiChain = {
    chainId: input.chainId,
    screenId: input.screenId,
    elementId: input.element.elementId,
    method,
    url,
    database: 'NOT_OBSERVED',
  };

  const plans: ApiUiChainPlan[] = [];
  const { element, chainId, screenId, label, pageUrl, screens } = input;

  plans.push(
    basePlan({
      subcaseId: 'api-ui-behavior',
      chainId,
      label,
      status: 'PLANNED',
      action: 'observe',
      reason: 'UI control is associated with recorded request URL',
      expect: { href: url, note: 'association only; no click' },
      targetElementId: element.elementId,
      screenId,
      completeSuccess: null,
    })
  );

  if (method) {
    plans.push(
      basePlan({
        subcaseId: 'api-ui-request',
        chainId,
        label,
        status: 'PLANNED',
        action: 'observe',
        reason: `recorded HTTP method ${method}; URL ${url}; request is not sent`,
        expect: { href: url, note: `method=${method}; not sent` },
        targetElementId: element.elementId,
        screenId,
        completeSuccess: null,
      })
    );
  } else {
    plans.push(
      basePlan({
        subcaseId: 'api-ui-request',
        chainId,
        label,
        status: 'NOT_TESTED',
        action: 'none',
        reason: 'NOT_TESTED: HTTP method was not recorded',
        expect: { href: url, note: 'URL recorded; method unknown; request is not sent' },
        targetElementId: element.elementId,
        screenId,
        completeSuccess: null,
      })
    );
  }

  const rawBody = observedRequestBody(element);
  if (rawBody !== undefined) {
    const masked = maskExecutionLogString(rawBody);
    plans.push(
      basePlan({
        subcaseId: 'api-ui-payload',
        chainId,
        label,
        status: 'PLANNED',
        action: 'observe',
        reason: 'request payload fixture observed (masked); request is not sent',
        expect: { note: masked },
        targetElementId: element.elementId,
        screenId,
        completeSuccess: null,
        maskedPayload: masked,
      })
    );
  } else {
    plans.push(
      basePlan({
        subcaseId: 'api-ui-payload',
        chainId,
        label,
        status: 'NOT_TESTED',
        action: 'none',
        reason: 'NOT_TESTED: request payload was not recorded',
        targetElementId: element.elementId,
        screenId,
        completeSuccess: null,
      })
    );
  }

  const expected = finiteStatus(element.expectedStatus);
  const actual = finiteStatus(element.actualStatus);

  if (actual === undefined) {
    const parts = ['NOT_TESTED: response was not recorded'];
    if (expected === undefined) {
      parts.push('SPECIFICATION_REQUIRED');
    }
    plans.push(
      basePlan({
        subcaseId: 'api-ui-response',
        chainId,
        label,
        status: 'NOT_TESTED',
        action: 'none',
        reason: parts.join('; '),
        targetElementId: element.elementId,
        screenId,
        completeSuccess: null,
      })
    );
  } else if (expected === undefined) {
    const evaluation = evaluateHttpStatus({ expected: undefined, actual });
    plans.push(
      basePlan({
        subcaseId: 'api-ui-response',
        chainId,
        label,
        status: 'NOT_TESTED',
        action: 'none',
        reason: `NOT_TESTED: ${evaluation.reason}; SPECIFICATION_REQUIRED`,
        targetElementId: element.elementId,
        screenId,
        completeSuccess: evaluation.completeSuccess === false ? false : null,
      })
    );
  } else {
    const evaluation = evaluateHttpStatus({ expected, actual });
    let status: CheckStatus = 'NOT_TESTED';
    if (evaluation.result === 'PASS') status = 'PASS';
    else if (evaluation.result === 'FAIL') status = 'FAIL';
    plans.push(
      basePlan({
        subcaseId: 'api-ui-response',
        chainId,
        label,
        status,
        action: 'none',
        reason: `${evaluation.result}: ${evaluation.reason}`,
        targetElementId: element.elementId,
        screenId,
        // Never claim complete success — status match ≠ end-to-end success.
        completeSuccess: false,
      })
    );
  }

  if (hasSiblingSuccessOrErrorState(screens, pageUrl)) {
    plans.push(
      basePlan({
        subcaseId: 'api-ui-ui-state',
        chainId,
        label,
        status: 'PLANNED',
        action: 'observe',
        reason:
          'sibling success/error screen state was already in the scan; the request was not replayed',
        targetElementId: element.elementId,
        screenId,
        completeSuccess: null,
      })
    );
  } else {
    plans.push(
      basePlan({
        subcaseId: 'api-ui-ui-state',
        chainId,
        label,
        status: 'NOT_TESTED',
        action: 'none',
        reason: 'NOT_TESTED: UI state after the request was not observed',
        targetElementId: element.elementId,
        screenId,
        completeSuccess: null,
      })
    );
  }

  plans.push(
    basePlan({
      subcaseId: 'api-ui-error-handling',
      chainId,
      label,
      status: 'NOT_TESTED',
      action: 'none',
      reason: 'NOT_TESTED: error handling was not observed',
      targetElementId: element.elementId,
      screenId,
      completeSuccess: null,
    })
  );

  plans.push(
    basePlan({
      subcaseId: 'api-ui-database',
      chainId,
      label,
      status: 'NOT_TESTED',
      action: 'none',
      reason: 'NOT_TESTED: database effect was not observed',
      targetElementId: element.elementId,
      screenId,
      completeSuccess: null,
    })
  );

  // Safety: never click / submit / send for any chain row.
  for (const plan of plans) {
    if (plan.action === 'click-button' || plan.action === ('submit' as PlannedAction)) {
      plan.action = 'none';
    }
    if (plan.status === 'PLANNED' && plan.action !== 'observe' && plan.action !== 'none') {
      plan.action = 'observe';
    }
  }

  return { chain, plans };
}

/**
 * Build API–UI chains for elements that already have a non-empty requestUrl.
 * Chain ids are CHAIN-001… per screen (stable within that screen's element order).
 */
export function buildApiUiChains(input: BuildApiUiChainsInput): ApiUiChainResult[] {
  const results: ApiUiChainResult[] = [];
  const seqByScreen = input.seqByScreen ?? new Map<string, { n: number }>();

  for (const element of input.elements) {
    const url = observedRequestUrl(element);
    if (!url) continue;

    const screenId =
      (element.screenId && element.screenId.trim()) ||
      input.defaultScreenId ||
      'SCREEN-UNKNOWN';
    const seq = seqByScreen.get(screenId) ?? { n: 0 };
    seqByScreen.set(screenId, seq);
    const chainId = nextChainId(seq);
    const pageUrl = input.pageUrl ?? element.page;
    const label = input.label ?? `${pageUrl} ${element.locator ?? element.elementId}`;

    const built = buildApiUiChainForElement({
      element,
      screenId,
      chainId,
      screens: input.screens,
      pageUrl,
      label,
    });
    if (built) results.push(built);
  }

  return results;
}
