import type { AuthAttempt } from './auth-session';
import type { ApiCallRecord } from './api-observe';
import type { UiElementRecord } from './ui-scan';

/**
 * Normalized discovery inventory — ten categories always present.
 * Populate only from evidence already in crawl/scan/API artifacts. Never invent.
 */

export const DISCOVERY_INVENTORY_CATEGORY_KEYS = [
  'pages',
  'uiElements',
  'forms',
  'workflows',
  'apis',
  'apiParameters',
  'authenticationPoints',
  'dataInputs',
  'externalIntegrations',
  'criticalPaths',
] as const;

export type DiscoveryInventoryCategoryKey = (typeof DISCOVERY_INVENTORY_CATEGORY_KEYS)[number];

export type InventoryCoverageStatus = 'POPULATED' | 'EMPTY' | 'NOT_IMPLEMENTED' | 'NOT_AVAILABLE';

export interface InventoryCategoryCoverage {
  status: InventoryCoverageStatus;
  reason?: string;
}

export interface DiscoveryPage {
  url: string;
  name?: string;
  source: string;
}

export interface DiscoveryUiElement {
  page: string;
  name?: string | null;
  selector?: string | null;
  elementType: string;
  source: string;
}

export interface DiscoveryForm {
  page: string;
  name?: string | null;
  selector?: string | null;
  method?: string | null;
  source: string;
}

export interface DiscoveryWorkflow {
  name: string;
  source: string;
  evidence?: string;
}

export interface DiscoveryApi {
  method: string;
  url: string;
  name?: string;
  source: string;
}

export interface DiscoveryApiParameter {
  method: string;
  url: string;
  name: string;
  location: 'query' | 'path' | 'body';
  source: string;
}

export interface DiscoveryAuthPoint {
  url?: string;
  name?: string;
  selector?: string | null;
  evidence: string;
  source: string;
}

export interface DiscoveryDataInput {
  page: string;
  name?: string | null;
  selector?: string | null;
  inputType?: string | null;
  elementType: string;
  source: string;
}

export interface DiscoveryIntegration {
  url: string;
  name?: string;
  source: string;
}

export interface DiscoveryCriticalPath {
  name: string;
  url?: string;
  source: string;
}

export interface DiscoveryInventory {
  generatedAt: string;
  pages: DiscoveryPage[];
  uiElements: DiscoveryUiElement[];
  forms: DiscoveryForm[];
  workflows: DiscoveryWorkflow[];
  apis: DiscoveryApi[];
  apiParameters: DiscoveryApiParameter[];
  authenticationPoints: DiscoveryAuthPoint[];
  dataInputs: DiscoveryDataInput[];
  externalIntegrations: DiscoveryIntegration[];
  criticalPaths: DiscoveryCriticalPath[];
  coverage: Record<DiscoveryInventoryCategoryKey, InventoryCategoryCoverage>;
}

/** Minimal page row — PageMap entries, DiscoveredPage, or plain URL fixtures. */
export interface DiscoveryInventoryPageInput {
  url: string;
  title?: string;
  name?: string;
  route?: string;
  /** Explicit critical flag from config/discovery — never inferred from homepage. */
  critical?: boolean;
  source?: string;
}

/** Configured or observed API request with optional parameter metadata. */
export interface DiscoveryInventoryApiInput {
  method: string;
  url?: string;
  path?: string;
  name?: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  /** Path template params already recorded (e.g. { id: '1' }). Never guessed. */
  pathParams?: Record<string, string>;
  source?: string;
}

export interface DiscoveryInventoryArtifacts {
  pages?: DiscoveryInventoryPageInput[];
  uiElements?: UiElementRecord[];
  /** Observed xhr/fetch calls and/or configured requests with param metadata. */
  apiRequests?: DiscoveryInventoryApiInput[];
  /** Observed auth-session result when present. */
  auth?: AuthAttempt | null;
  /**
   * Pre-recorded workflows only. When omitted, workflows stay NOT_IMPLEMENTED —
   * this builder does not infer journeys.
   */
  workflows?: DiscoveryWorkflow[];
  /** Pre-flagged critical paths only. When omitted, criticalPaths stay NOT_IMPLEMENTED. */
  criticalPaths?: DiscoveryCriticalPath[];
}

const UI_SOURCE = 'ui-scan';
const PAGE_SOURCE = 'crawl';
const API_SOURCE = 'api-discovery';
const AUTH_SOURCE = 'auth-session';

/** Generic HTML/URL auth evidence: password control or route path matching common auth segments. */
const AUTH_ROUTE = /(?:^|\/)(login|signin|sign-in|signup|sign-up|register|auth)(?:\/|$|\?)/i;
const DATA_INPUT_TYPES = new Set(['input', 'textarea', 'select', 'checkbox', 'radio', 'file-upload']);

function coverageEntry(
  status: InventoryCoverageStatus,
  reason?: string
): InventoryCategoryCoverage {
  return reason ? { status, reason } : { status };
}

function resolveApiUrl(request: DiscoveryInventoryApiInput): string {
  if (request.url && request.url.trim()) return request.url.trim();
  if (request.path && request.path.trim()) return request.path.trim();
  return '';
}

function queryKeysFromUrl(url: string): string[] {
  try {
    const parsed = new URL(url);
    return [...parsed.searchParams.keys()];
  } catch {
    const q = url.indexOf('?');
    if (q < 0) return [];
    const params = new URLSearchParams(url.slice(q + 1));
    return [...params.keys()];
  }
}

function mapApiRequests(requests: DiscoveryInventoryApiInput[]): {
  apis: DiscoveryApi[];
  apiParameters: DiscoveryApiParameter[];
} {
  const apis: DiscoveryApi[] = [];
  const apiParameters: DiscoveryApiParameter[] = [];

  for (const request of requests) {
    const url = resolveApiUrl(request);
    if (!url) continue;
    const method = (request.method || 'GET').toUpperCase();
    const source = request.source ?? API_SOURCE;
    apis.push({
      method,
      url,
      name: request.name,
      source,
    });

    const seen = new Set<string>();
    const addParam = (name: string, location: DiscoveryApiParameter['location']) => {
      const key = `${location}:${name}`;
      if (!name || seen.has(key)) return;
      seen.add(key);
      apiParameters.push({ method, url, name, location, source });
    };

    if (request.query) {
      for (const name of Object.keys(request.query)) addParam(name, 'query');
    } else {
      for (const name of queryKeysFromUrl(url)) addParam(name, 'query');
    }

    if (request.pathParams) {
      for (const name of Object.keys(request.pathParams)) addParam(name, 'path');
    }

    if (request.body && typeof request.body === 'object' && !Array.isArray(request.body)) {
      for (const name of Object.keys(request.body)) addParam(name, 'body');
    }
  }

  return { apis, apiParameters };
}

function mapAuthPoints(
  pages: DiscoveryInventoryPageInput[],
  uiElements: UiElementRecord[] | undefined,
  auth: AuthAttempt | null | undefined
): DiscoveryAuthPoint[] {
  const points: DiscoveryAuthPoint[] = [];
  const seen = new Set<string>();

  const push = (point: DiscoveryAuthPoint) => {
    const key = `${point.url ?? ''}|${point.selector ?? ''}|${point.evidence}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push(point);
  };

  if (auth?.loginPageUrl) {
    push({
      url: auth.loginPageUrl,
      name: 'observed-login-page',
      evidence: auth.reason || 'auth-session recorded a login page URL',
      source: AUTH_SOURCE,
    });
  } else if (auth?.attempted) {
    push({
      url: auth.afterUrl,
      name: 'auth-attempt',
      evidence: auth.reason || 'auth-session attempted login',
      source: AUTH_SOURCE,
    });
  }

  if (uiElements) {
    for (const el of uiElements) {
      const isPassword =
        el.inputType === 'password' ||
        /\btype=password\b/i.test(el.evidence) ||
        (el.locatorCandidates ?? []).some((locator) => /password/i.test(locator));
      if (!isPassword) continue;
      push({
        url: el.page,
        name: el.accessibleName ?? 'password-input',
        selector: el.locator,
        evidence: 'password input observed in UI scan (generic HTML evidence)',
        source: UI_SOURCE,
      });
    }
  }

  for (const page of pages) {
    const route = page.route ?? (() => {
      try {
        const parsed = new URL(page.url);
        return `${parsed.pathname}${parsed.search}` || '/';
      } catch {
        return page.url;
      }
    })();
    if (!AUTH_ROUTE.test(route)) continue;
    push({
      url: page.url,
      name: page.name ?? page.title ?? route,
      evidence: `discovered URL path matched generic auth segment (${route})`,
      source: page.source ?? PAGE_SOURCE,
    });
  }

  return points;
}

/**
 * Pure builder: maps existing discovery artifacts into a normalized ten-category inventory.
 * Does not crawl, launch a browser, or invent endpoints/workflows/credentials.
 */
export function buildDiscoveryInventory(artifacts: DiscoveryInventoryArtifacts = {}): DiscoveryInventory {
  const pagesInput = artifacts.pages ?? [];
  const uiElements = artifacts.uiElements;
  const apiRequests = artifacts.apiRequests ?? [];

  const pages: DiscoveryPage[] = pagesInput.map((page) => ({
    url: page.url,
    name: page.name ?? page.title,
    source: page.source ?? PAGE_SOURCE,
  }));

  const uiMapped: DiscoveryUiElement[] = (uiElements ?? []).map((el) => ({
    page: el.page,
    name: el.accessibleName,
    selector: el.locator,
    elementType: el.elementType,
    source: UI_SOURCE,
  }));

  const forms: DiscoveryForm[] = (uiElements ?? [])
    .filter((el) => el.elementType === 'form')
    .map((el) => ({
      page: el.page,
      name: el.accessibleName,
      selector: el.locator,
      method: el.formMethod ?? null,
      source: UI_SOURCE,
    }));

  const workflows: DiscoveryWorkflow[] = artifacts.workflows ? [...artifacts.workflows] : [];

  const { apis, apiParameters } = mapApiRequests(apiRequests);

  const authenticationPoints = mapAuthPoints(pagesInput, uiElements, artifacts.auth);

  const dataInputs: DiscoveryDataInput[] = (uiElements ?? [])
    .filter((el) => DATA_INPUT_TYPES.has(el.elementType))
    .map((el) => ({
      page: el.page,
      name: el.accessibleName,
      selector: el.locator,
      inputType: el.inputType ?? null,
      elementType: el.elementType,
      source: UI_SOURCE,
    }));

  const externalIntegrations: DiscoveryIntegration[] = [];

  const fromFlaggedPages: DiscoveryCriticalPath[] = pagesInput
    .filter((page) => page.critical === true)
    .map((page) => ({
      name: page.name ?? page.title ?? page.url,
      url: page.url,
      source: page.source ?? PAGE_SOURCE,
    }));
  const criticalPaths: DiscoveryCriticalPath[] = artifacts.criticalPaths
    ? [...artifacts.criticalPaths]
    : fromFlaggedPages.length > 0
      ? fromFlaggedPages
      : [];

  const coverage: DiscoveryInventory['coverage'] = {
    pages: pages.length
      ? coverageEntry('POPULATED')
      : coverageEntry('EMPTY', 'no pages were provided from discovery'),
    uiElements: uiElements === undefined
      ? coverageEntry('EMPTY', 'no UI scan elements were provided')
      : uiMapped.length
        ? coverageEntry('POPULATED')
        : coverageEntry('EMPTY', 'UI scan recorded 0 elements'),
    forms: uiElements === undefined
      ? coverageEntry('EMPTY', 'no UI scan elements were provided')
      : forms.length
        ? coverageEntry('POPULATED')
        : coverageEntry('EMPTY', 'no form elements were recorded in the UI scan'),
    workflows:
      artifacts.workflows === undefined
        ? coverageEntry('NOT_IMPLEMENTED', 'workflow inference is not implemented')
        : workflows.length
          ? coverageEntry('POPULATED')
          : coverageEntry('EMPTY', 'no workflows were listed in the provided artifact'),
    apis: artifacts.apiRequests === undefined
      ? coverageEntry('EMPTY', 'no API requests were provided')
      : apis.length
        ? coverageEntry('POPULATED')
        : coverageEntry('EMPTY', 'API catalog was empty — endpoints were not invented'),
    apiParameters: artifacts.apiRequests === undefined
      ? coverageEntry('EMPTY', 'no API requests were provided')
      : apiParameters.length
        ? coverageEntry('POPULATED')
        : coverageEntry(
            'EMPTY',
            'API requests had no query/path/body parameter metadata — schemas were not guessed'
          ),
    authenticationPoints: authenticationPoints.length
      ? coverageEntry('POPULATED')
      : coverageEntry('EMPTY', 'no authentication point was discovered'),
    dataInputs: uiElements === undefined
      ? coverageEntry('EMPTY', 'no UI scan elements were provided')
      : dataInputs.length
        ? coverageEntry('POPULATED')
        : coverageEntry('EMPTY', 'no input/textarea/select controls were recorded in the UI scan'),
    externalIntegrations: coverageEntry(
      'NOT_IMPLEMENTED',
      'external integration extraction is not implemented'
    ),
    criticalPaths:
      artifacts.criticalPaths === undefined && fromFlaggedPages.length === 0
        ? coverageEntry('NOT_IMPLEMENTED', 'critical-path ranking is not implemented')
        : criticalPaths.length
          ? coverageEntry('POPULATED')
          : coverageEntry('EMPTY', 'no path was explicitly flagged critical'),
  };

  return {
    generatedAt: new Date().toISOString(),
    pages,
    uiElements: uiMapped,
    forms,
    workflows,
    apis,
    apiParameters,
    authenticationPoints,
    dataInputs,
    externalIntegrations,
    criticalPaths,
    coverage,
  };
}

/** Map observed ApiCallRecord rows into inventory API inputs (query keys from URL only). */
export function apiCallsToInventoryInputs(calls: ApiCallRecord[]): DiscoveryInventoryApiInput[] {
  return calls.map((call) => ({
    method: call.method,
    url: call.url,
    source: API_SOURCE,
  }));
}
