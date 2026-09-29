/**
 * Screen identity for discovery — url + state signature, not URL alone.
 * Pure classification over existing page-map / UI-scan evidence. No browser launch.
 *
 * Initial loaded document uses state "default" (synonym of "initial").
 * Never emit both "default" and "initial" for the same page.
 * Overlay family: dialog | modal | drawer are the modal-open tokens (one screen each;
 * do not also emit state "modal-open").
 */

import { resolveDiscoveryConfig } from '../core/scope';
import {
  assignStableElementIdentities,
  elementCategoryFromKind,
  plannerActionsForKind,
  type ElementCategory,
  type ElementKind,
  type LocatorStrategy,
} from './element-kind';
import type { AuthAttempt } from './auth-session';
import {
  buildAuthenticatedCoverage,
  type AuthenticatedCoverage,
  type AuthenticatedCoverageEnvironment,
  type AuthenticatedCoverageSession,
  type AuthenticationEvidence,
} from './authenticated-coverage';
import type { NavigationEntry, PageMap, PageMapEntry } from './page-map';
import type { UiElementRecord, UiInventory } from './ui-scan';

export type {
  AccessGate,
  AccessLayer,
  AccessLayerStatus,
  AuthenticatedCoverage,
  AuthenticatedCoverageEnvironment,
  AuthenticatedCoverageSession,
  AuthenticationEvidence,
} from './authenticated-coverage';

export { buildAuthenticatedCoverage } from './authenticated-coverage';

/** How a real screen was attributed from crawl/scan evidence. */
export type ScreenDiscoverySource =
  | 'direct-url'
  | 'navigation-link'
  | 'header-navigation'
  | 'sidebar'
  | 'footer'
  | 'breadcrumbs'
  | 'pagination'
  | 'tabs'
  | 'cards'
  | 'cta'
  | 'dropdown'
  | 'button-navigate'
  | 'forms'
  | 'modal'
  | 'dialog'
  | 'drawer'
  | 'redirect'
  | 'deep-link'
  | 'client-route'
  | 'authentication'
  | 'dynamic-navigation'
  | 'unobserved'
  | 'http-status'
  | 'page-error'
  | 'scan-evidence';

/**
 * Canonical screen-state tokens (kebab-case).
 * "default" is the initial document state (initial === default; do not emit "initial").
 * dialog | modal | drawer are the modal-open family (stable ids; never also "modal-open").
 */
export type ScreenStateToken =
  | 'default'
  | 'dialog'
  | 'modal'
  | 'drawer'
  | 'loading'
  | 'empty'
  | 'populated'
  | 'success'
  | 'error'
  | 'validation-error'
  | 'authenticated'
  | 'unauthenticated'
  | 'dropdown-open'
  | 'expanded'
  | 'collapsed'
  | 'permission-denied';

/** @deprecated Use ScreenStateToken — ScreenState is the normalized { state, source } object. */
export type ScreenStateName = ScreenStateToken;

export interface DiscoveredScreen {
  id: string;
  url: string;
  /** Short stable token; "default" for a normal page load (initial === default). */
  state: ScreenStateToken | string;
  source: ScreenDiscoverySource;
  title?: string;
  /** Requested URL when this screen is the final document after a redirect. */
  redirectFrom?: string;
}

export type UnresolvedChannelStatus = 'NOT_TESTED' | 'REQUIRES_CONFIGURATION' | 'NOT_APPLICABLE';

/** Channel not observed as a real screen — never PASS, never SCREEN-NNN. */
export interface UnresolvedDiscoveryChannel {
  channel: string;
  status: UnresolvedChannelStatus;
  reason: string;
  source: 'unobserved';
}

/**
 * Observed state for one ScreenInventory row.
 * Each inventory row is one url+state identity — `states` is a single-item array.
 */
export interface ScreenState {
  state: string;
  source: string;
}

/**
 * Constraint observed on a control — only kinds present in scan evidence.
 * No invented patterns or required flags.
 */
export interface ValidationRule {
  kind: 'required' | 'type' | 'min' | 'max' | 'minLength' | 'maxLength' | 'pattern';
  value?: string;
}

/**
 * Element published on a normalized ScreenInventory row (from attached scan records).
 * Single exported shape — `type` is the detailed ElementKind; `category` is derived
 * from kind via elementCategoryFromKind (not a second source of truth).
 * locatorStrategy / locatorStable / decorative / elementKind live in metadata.
 */
export interface TestableElement {
  elementId: string;
  screenId: string;
  /** Detailed ElementKind (email-input, submit-button, decorative, …). */
  type: ElementKind | string;
  /** Coarse category derived from `type` — see elementCategoryFromKind mapping. */
  category: ElementCategory;
  /** Accessible name when present; omit when absent (same source as accessibleName). */
  label?: string | null;
  locator?: string | null;
  /** Same accessible name as label when present; omit when absent. */
  accessibleName?: string | null;
  /** true only from required / aria-required evidence; false only when scan says not required; omit when unknown. */
  required?: boolean;
  /** true only from disabled / aria-disabled (or enabled===false) evidence; omit when unknown. */
  disabled?: boolean;
  /** Constraints present in evidence only; omit or [] when none. */
  validation?: ValidationRule[];
  /** Planner-allowed strings: observe / fill / blocked / none — never executable submit/click. */
  actions?: string[];
  /** JSON-serializable extras: locatorStrategy, locatorStable, elementKind, decorative. */
  metadata?: Record<string, unknown>;
}

/**
 * Navigation-edge workflow only — never invent multi-step business flows.
 * workflowId is WF-NNN per screen, stable-sorted by toUrl.
 */
export interface WorkflowReference {
  workflowId: string;
  fromScreenId: string;
  toUrl: string;
  source: 'navigation-edge';
}

/**
 * Normalized view of one screen id (url + state).
 * Multiple states for one URL remain multiple rows with distinct screenIds;
 * metadata.siblingScreenIds lists the other ids for that URL.
 */
export interface ScreenInventory {
  screenId: string;
  url: string;
  /** pathname + search + hash (no origin). Omitted when the URL cannot be parsed. */
  route?: string;
  title?: string;
  /**
   * true only for unauthenticated / permission-denied state or page access=gated.
   * false when access is explicitly public/authenticated, OR when evidence is unknown
   * (then metadata.authenticationEvidence must be 'unknown' — never imply a public proof).
   */
  authenticationRequired: boolean;
  /** Only when an existing auth/session object already carries role strings — never invented. */
  roles?: string[];
  states?: ScreenState[];
  elements: TestableElement[];
  workflows?: WorkflowReference[];
  metadata?: Record<string, unknown>;
}

/** Result of buildScreenInventory — screens stay the planning identity; inventories are the normalized view. */
export interface ScreenInventoryResult {
  screens: DiscoveredScreen[];
  unresolvedChannels: UnresolvedDiscoveryChannel[];
  inventories: ScreenInventory[];
  /** Public / login / caller-session coverage — never invents admin URLs or roles. */
  authenticatedCoverage: AuthenticatedCoverage;
}

export interface BuildScreenInventoryInput {
  pageMap: PageMap;
  ui?: UiInventory | null;
  auth?: AuthAttempt | null;
  /** Crawl maxDepth used for the depth gap reason (defaults to resolved discovery config). */
  maxDepth?: number;
  /**
   * Optional authenticated discovery session. Omitted / established:false does not create
   * User/Admin/Super Admin layers — those gates stay REQUIRES_CONFIGURATION.
   */
  session?: AuthenticatedCoverageSession | null;
  environment?: AuthenticatedCoverageEnvironment;
  authorizeAuthenticatedDiscovery?: boolean;
}

interface ScreenCandidate {
  url: string;
  state: string;
  source: ScreenDiscoverySource;
  title?: string;
  redirectFrom?: string;
}

/** Run-level evidence flags — one unresolved row per channel when false. */
interface ObservedStateChannels {
  loading: boolean;
  empty: boolean;
  populated: boolean;
  success: boolean;
  error: boolean;
  validationError: boolean;
  authenticated: boolean;
  unauthenticated: boolean;
  dropdownOpen: boolean;
  expanded: boolean;
  collapsed: boolean;
  permissionDenied: boolean;
  confirmation: boolean;
  overlay: boolean;
}

const HASH_ROUTE = /#\/.+|#\!\/.+/;
const SKIP_HREF = /^(mailto:|tel:|javascript:)$/i;
const EMPTY_MARKER_TEXT = /\bempty\b|no (results|items|data|records)|nothing (here|to show|found)|zero results/i;
const CONFIRM_CUE = /confirm|delete/i;
const LANDMARK_TYPES = new Set([
  'header',
  'footer',
  'sidebar',
  'navigation',
  'breadcrumbs',
  'pagination',
]);

/** Stable identity key — URL alone is not enough. */
export function screenIdentityKey(url: string, state: string): string {
  return `${canonicalScreenUrl(url)}|${state || 'default'}`;
}

export function formatScreenId(index: number): string {
  return `SCREEN-${String(index).padStart(3, '0')}`;
}

export function canonicalScreenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || '/';
    const search = parsed.search || '';
    const hash = parsed.hash || '';
    return `${parsed.protocol}//${parsed.host}${path}${search}${hash}`;
  } catch {
    return url.trim();
  }
}

function normalizeScreenUrl(url: string): string {
  return canonicalScreenUrl(url);
}

function pathDepth(url: string): number {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/') return 0;
    return path.split('/').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function isHashClientRoute(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || SKIP_HREF.test(trimmed)) return false;
  if (HASH_ROUTE.test(trimmed)) return true;
  try {
    const parsed = new URL(trimmed, 'https://example.invalid/');
    return HASH_ROUTE.test(parsed.hash);
  } catch {
    return trimmed.startsWith('#/') || trimmed.startsWith('#!/');
  }
}

function resolveHref(href: string, baseUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || SKIP_HREF.test(trimmed)) return null;
  try {
    return normalizeScreenUrl(new URL(trimmed, baseUrl).href);
  } catch {
    return null;
  }
}

function buttonDestination(el: UiElementRecord): string | null {
  if (el.href && el.href.trim()) return el.href.trim();
  const dataHref = el.attributes?.['data-href'] ?? el.attributes?.['data-url'];
  if (dataHref && dataHref.trim()) return dataHref.trim();
  return null;
}

function attr(el: UiElementRecord, name: string): string {
  return (el.attributes?.[name] ?? '').trim();
}

function roleOf(el: UiElementRecord): string {
  return (attr(el, 'role') || '').toLowerCase();
}

function modalStateFromElement(el: UiElementRecord): 'dialog' | 'drawer' | 'modal' {
  const role = roleOf(el);
  const evidence = `${el.evidence ?? ''} ${el.elementType}`.toLowerCase();
  if (/\bdrawer\b/.test(evidence) || role === 'drawer') return 'drawer';
  if (role === 'dialog' || /\brole=dialog\b/.test(evidence) || evidence.includes('dialog')) return 'dialog';
  if (el.attributes?.['aria-modal'] === 'true' || evidence.includes('aria-modal')) return 'modal';
  return 'modal';
}

function pageSource(page: PageMapEntry, seedUrl: string): {
  source: ScreenDiscoverySource;
  redirectFrom?: string;
  url: string;
} {
  const requested = normalizeScreenUrl(page.url);
  const finalUrl = normalizeScreenUrl(page.finalUrl ?? page.url);
  const redirected =
    requested !== finalUrl || (page.redirects != null && page.redirects.length > 0);

  if (redirected) {
    return { source: 'redirect', redirectFrom: requested, url: finalUrl };
  }

  const seedNorm = normalizeScreenUrl(seedUrl);
  if (finalUrl === seedNorm || page.depth === 0) {
    return { source: 'direct-url', url: finalUrl };
  }

  if (pathDepth(finalUrl) > pathDepth(seedUrl)) {
    return { source: 'deep-link', url: finalUrl };
  }

  if (page.depth > 0) {
    return { source: 'dynamic-navigation', url: finalUrl };
  }

  return { source: 'navigation-link', url: finalUrl };
}

/**
 * Primary document state for a crawled page.
 * HTTP / access / error evidence replaces "default" — never both.
 */
function primaryStateForPage(page: PageMapEntry): {
  state: ScreenStateToken;
  source: ScreenDiscoverySource;
} {
  const status = page.status;
  if (status === 401 || status === 403) {
    return { state: 'permission-denied', source: 'http-status' };
  }
  if (status != null && status >= 400) {
    return { state: 'error', source: 'http-status' };
  }
  if (page.error) {
    return { state: 'error', source: 'page-error' };
  }
  if (page.access === 'gated') {
    return { state: 'unauthenticated', source: 'authentication' };
  }
  if (page.access === 'authenticated') {
    return { state: 'authenticated', source: 'authentication' };
  }
  return { state: 'default', source: 'direct-url' };
}

function isExplicitEmptyMarker(el: UiElementRecord): boolean {
  if (attr(el, 'empty') === 'true' || attr(el, 'data-empty') === 'true') return true;
  const role = roleOf(el);
  if (role === 'status' || role === 'alert') {
    const text = `${el.accessibleName ?? ''} ${el.evidence ?? ''} ${attr(el, 'kind')}`.trim();
    if (EMPTY_MARKER_TEXT.test(text) || attr(el, 'kind').toLowerCase() === 'empty') return true;
  }
  if (/\bempty[- ]?state\b/i.test(el.evidence ?? '')) return true;
  return false;
}

function isSuccessMarker(el: UiElementRecord): boolean {
  const role = roleOf(el);
  if (role !== 'status' && role !== 'alert') return false;
  const kind = attr(el, 'kind').toLowerCase();
  if (kind === 'success') return true;
  // Scanner-provided kind in evidence only — not arbitrary body scrape.
  if (/\bkind\s*[:=]\s*success\b/i.test(el.evidence ?? '')) return true;
  return false;
}

function isLoadingEvidence(el: UiElementRecord): boolean {
  if (attr(el, 'aria-busy') === 'true') return true;
  if (roleOf(el) === 'progressbar') return true;
  if (attr(el, 'loading') === 'true' || attr(el, 'data-loading') === 'true') return true;
  return false;
}

function isValidationInvalid(el: UiElementRecord): boolean {
  if (attr(el, 'aria-invalid') !== 'true') return false;
  return (
    el.elementType === 'input' ||
    el.elementType === 'textarea' ||
    el.elementType === 'select' ||
    el.elementType === 'checkbox' ||
    el.elementType === 'radio' ||
    el.elementType === 'search' ||
    el.elementType === 'file-upload'
  );
}

function isDropdownOpenEvidence(el: UiElementRecord): boolean {
  const role = roleOf(el);
  const expanded = attr(el, 'aria-expanded');
  if (el.elementType === 'popup' || role === 'listbox' || role === 'menu' || role === 'combobox') {
    if (expanded === 'false') return false;
    if (expanded === 'true') return true;
    // Open listbox/menu present in scan without aria-expanded=false.
    if (role === 'listbox' || role === 'menu') return el.visible !== false;
  }
  if ((role === 'listbox' || role === 'menu' || role === 'combobox') && expanded === 'true') {
    return true;
  }
  return false;
}

/** Page-level landmark/region disclosure — not a control-level accordion. */
function isPageLevelExpandedRegion(el: UiElementRecord): 'expanded' | 'collapsed' | null {
  const expanded = attr(el, 'aria-expanded');
  if (expanded !== 'true' && expanded !== 'false') return null;
  const role = roleOf(el);
  const isLandmark =
    LANDMARK_TYPES.has(el.elementType) ||
    role === 'region' ||
    role === 'main' ||
    role === 'complementary' ||
    role === 'banner' ||
    role === 'navigation';
  if (!isLandmark) return null;
  return expanded === 'true' ? 'expanded' : 'collapsed';
}

function hasDataRowsOnPage(elements: UiElementRecord[], pageUrl: string): boolean {
  const page = normalizeScreenUrl(pageUrl);
  for (const el of elements) {
    if (normalizeScreenUrl(el.page) !== page) continue;
    if (el.elementType === 'table') return true;
    const role = roleOf(el);
    if (role === 'listitem' || role === 'row' || attr(el, 'data-row') === 'true') return true;
  }
  return false;
}

function regionKindsPresent(pageMap: PageMap, ui: UiInventory | null | undefined): Set<string> {
  const kinds = new Set<string>();
  for (const region of pageMap.navigationRegions ?? []) {
    kinds.add(region.kind);
  }
  for (const el of ui?.elements ?? []) {
    if (
      el.elementType === 'header' ||
      el.elementType === 'footer' ||
      el.elementType === 'sidebar' ||
      el.elementType === 'breadcrumbs' ||
      el.elementType === 'pagination' ||
      el.elementType === 'tab' ||
      el.elementType === 'navigation' ||
      el.elementType === 'popup'
    ) {
      kinds.add(el.elementType === 'tab' ? 'tabs' : el.elementType === 'popup' ? 'dropdown' : el.elementType);
    }
  }
  return kinds;
}

function upsertCandidate(
  map: Map<string, ScreenCandidate>,
  candidate: ScreenCandidate
): void {
  const key = screenIdentityKey(candidate.url, candidate.state);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, candidate);
    return;
  }
  // Prefer a more specific source / keep first redirectFrom.
  if (!existing.redirectFrom && candidate.redirectFrom) {
    existing.redirectFrom = candidate.redirectFrom;
  }
  if (!existing.title && candidate.title) existing.title = candidate.title;
}

function emptyObserved(): ObservedStateChannels {
  return {
    loading: false,
    empty: false,
    populated: false,
    success: false,
    error: false,
    validationError: false,
    authenticated: false,
    unauthenticated: false,
    dropdownOpen: false,
    expanded: false,
    collapsed: false,
    permissionDenied: false,
    confirmation: false,
    overlay: false,
  };
}

function markObserved(observed: ObservedStateChannels, state: string): void {
  switch (state) {
    case 'loading':
      observed.loading = true;
      break;
    case 'empty':
      observed.empty = true;
      break;
    case 'populated':
      observed.populated = true;
      break;
    case 'success':
      observed.success = true;
      break;
    case 'error':
      observed.error = true;
      break;
    case 'validation-error':
      observed.validationError = true;
      break;
    case 'authenticated':
      observed.authenticated = true;
      break;
    case 'unauthenticated':
      observed.unauthenticated = true;
      break;
    case 'dropdown-open':
      observed.dropdownOpen = true;
      break;
    case 'expanded':
      observed.expanded = true;
      break;
    case 'collapsed':
      observed.collapsed = true;
      break;
    case 'permission-denied':
      observed.permissionDenied = true;
      break;
    case 'dialog':
    case 'modal':
    case 'drawer':
      observed.overlay = true;
      break;
    default:
      break;
  }
}

/**
 * Build SCREEN-NNN rows from the full page map + in-DOM UI states.
 * Does not crawl, launch Playwright, or invent URLs/states.
 * Also publishes inventories[] — normalized ScreenInventory rows (one per screen id).
 */
export function buildScreenInventory(input: BuildScreenInventoryInput): ScreenInventoryResult {
  const { pageMap, ui, auth } = input;
  const maxDepth = input.maxDepth ?? resolveDiscoveryConfig().maxDepth;
  const hasCallerSessions = Boolean(
    input.session?.established &&
      ((input.session.roles?.length ?? 0) > 0 ||
        (input.session.permissions?.length ?? 0) > 0 ||
        input.session.organizationId ||
        input.session.tenantId ||
        input.session.subscription ||
        (input.session.featureFlags?.length ?? 0) > 0)
  );
  const candidates = new Map<string, ScreenCandidate>();
  const observed = emptyObserved();
  const seedUrl = pageMap.seedUrl;
  const elements = ui?.elements ?? [];
  const emptyUrls = new Set<string>();

  for (const page of pageMap.pages) {
    const classified = pageSource(page, seedUrl);
    const primary = primaryStateForPage(page);
    const source: ScreenDiscoverySource =
      primary.state === 'default' ? classified.source : primary.source;
    upsertCandidate(candidates, {
      url: classified.url,
      state: primary.state,
      source,
      title: page.title || undefined,
      redirectFrom: classified.redirectFrom,
    });
    markObserved(observed, primary.state);
  }

  let sawHashClientRoute = false;

  for (const el of elements) {
    const pageUrl = normalizeScreenUrl(el.page);

    if (el.elementType === 'modal') {
      const state = modalStateFromElement(el);
      upsertCandidate(candidates, {
        url: pageUrl,
        state,
        source: state,
        title: el.accessibleName ?? undefined,
      });
      markObserved(observed, state);
      if (CONFIRM_CUE.test(el.accessibleName ?? '') || CONFIRM_CUE.test(el.evidence ?? '')) {
        observed.confirmation = true;
      }
      continue;
    }

    if (isLoadingEvidence(el)) {
      upsertCandidate(candidates, {
        url: pageUrl,
        state: 'loading',
        source: 'scan-evidence',
        title: el.accessibleName ?? undefined,
      });
      markObserved(observed, 'loading');
    }

    if (isExplicitEmptyMarker(el)) {
      upsertCandidate(candidates, {
        url: pageUrl,
        state: 'empty',
        source: 'scan-evidence',
        title: el.accessibleName ?? undefined,
      });
      markObserved(observed, 'empty');
      emptyUrls.add(pageUrl);
    }

    if (isSuccessMarker(el)) {
      upsertCandidate(candidates, {
        url: pageUrl,
        state: 'success',
        source: 'scan-evidence',
        title: el.accessibleName ?? undefined,
      });
      markObserved(observed, 'success');
    }

    if (isValidationInvalid(el)) {
      upsertCandidate(candidates, {
        url: pageUrl,
        state: 'validation-error',
        source: 'scan-evidence',
        title: el.accessibleName ?? undefined,
      });
      markObserved(observed, 'validation-error');
    }

    if (isDropdownOpenEvidence(el)) {
      upsertCandidate(candidates, {
        url: pageUrl,
        state: 'dropdown-open',
        source: 'dropdown',
        title: el.accessibleName ?? undefined,
      });
      markObserved(observed, 'dropdown-open');
    }

    const regionState = isPageLevelExpandedRegion(el);
    if (regionState) {
      upsertCandidate(candidates, {
        url: pageUrl,
        state: regionState,
        source: 'scan-evidence',
        title: el.accessibleName ?? undefined,
      });
      markObserved(observed, regionState);
    }

    if (el.elementType === 'button' || el.attributes?.role === 'button') {
      const dest = buttonDestination(el);
      if (!dest) {
        // No destination — stay on current screen only; do not invent a target.
        continue;
      }
      const resolved = resolveHref(dest, el.page);
      if (!resolved) continue;
      if (isHashClientRoute(dest) || isHashClientRoute(resolved)) {
        sawHashClientRoute = true;
        upsertCandidate(candidates, {
          url: resolved,
          state: 'default',
          source: 'client-route',
        });
      }
      // Uncrawled path destinations are not invented as screens.
      continue;
    }

    if (
      (el.elementType === 'link' || el.elementType === 'navigation') &&
      el.href &&
      (isHashClientRoute(el.href) || HASH_ROUTE.test(el.href))
    ) {
      const resolved = resolveHref(el.href, el.page);
      if (!resolved) continue;
      sawHashClientRoute = true;
      upsertCandidate(candidates, {
        url: resolved,
        state: 'default',
        source: 'client-route',
      });
    }
  }

  // populated: only when empty-state screen exists for the URL AND default has data rows.
  for (const emptyUrl of emptyUrls) {
    if (!hasDataRowsOnPage(elements, emptyUrl)) continue;
    const defaultKey = screenIdentityKey(emptyUrl, 'default');
    if (!candidates.has(defaultKey)) continue;
    upsertCandidate(candidates, {
      url: emptyUrl,
      state: 'populated',
      source: 'scan-evidence',
    });
    markObserved(observed, 'populated');
  }

  for (const nav of pageMap.navigation) {
    if (!nav.to) continue;
    if (isHashClientRoute(nav.to) || HASH_ROUTE.test(nav.linkText ?? '')) {
      const resolved = resolveHref(nav.to, nav.from);
      if (!resolved) continue;
      if (!isHashClientRoute(nav.to) && !HASH_ROUTE.test(resolved)) continue;
      sawHashClientRoute = true;
      upsertCandidate(candidates, {
        url: resolved,
        state: 'default',
        source: 'client-route',
      });
    }
  }

  const sorted = [...candidates.values()].sort((a, b) => {
    const urlCmp = normalizeScreenUrl(a.url).localeCompare(normalizeScreenUrl(b.url));
    if (urlCmp !== 0) return urlCmp;
    return a.state.localeCompare(b.state);
  });

  const screens: DiscoveredScreen[] = sorted.map((row, index) => ({
    id: formatScreenId(index + 1),
    url: row.url,
    state: row.state,
    source: row.source,
    ...(row.title ? { title: row.title } : {}),
    ...(row.redirectFrom ? { redirectFrom: row.redirectFrom } : {}),
  }));

  const unresolvedChannels = buildUnresolvedChannels({
    pageMap,
    auth: auth ?? pageMap.auth,
    maxDepth,
    regions: regionKindsPresent(pageMap, ui),
    sawHashClientRoute,
    observed,
    hasCallerSessions,
  });

  // Attach ELEMENT-NNN / locators for normalized inventories (callers may attach again — stable).
  const uiAttached = ui ? attachElementsToScreens(ui, screens) : null;
  const inventories = toScreenInventories({
    screens,
    pageMap,
    ui: uiAttached,
    auth: auth ?? pageMap.auth,
  });

  const authenticatedCoverage = buildAuthenticatedCoverage({
    screens: inventories.map((row) => ({
      id: row.screenId,
      url: row.url,
      state: String(row.states?.[0]?.state ?? row.metadata?.state ?? 'default'),
      authenticationRequired: row.authenticationRequired,
      authenticationEvidence:
        (row.metadata?.authenticationEvidence as AuthenticationEvidence | undefined) ?? 'unknown',
    })),
    pages: pageMap.pages.map((page) => ({
      url: page.finalUrl ?? page.url,
      access: page.access,
      status: page.status ?? undefined,
      metadata: page.metadata,
    })),
    session: input.session ?? { established: false },
    environment: input.environment,
    authorizeAuthenticatedDiscovery: input.authorizeAuthenticatedDiscovery,
  });

  return { screens, unresolvedChannels, inventories, authenticatedCoverage };
}

function buildUnresolvedChannels(input: {
  pageMap: PageMap;
  auth?: AuthAttempt | null;
  maxDepth: number;
  regions: Set<string>;
  sawHashClientRoute: boolean;
  observed: ObservedStateChannels;
  hasCallerSessions?: boolean;
}): UnresolvedDiscoveryChannel[] {
  const rows: UnresolvedDiscoveryChannel[] = [];
  const push = (channel: string, status: UnresolvedChannelStatus, reason: string) => {
    rows.push({ channel, status, reason, source: 'unobserved' });
  };

  // One combined gap when landmark regions are missing — not once per link.
  if (!input.regions.has('header') || !input.regions.has('sidebar') || !input.regions.has('footer')) {
    push(
      'header-navigation',
      'NOT_TESTED',
      'header/sidebar/footer region not present in scan evidence'
    );
  }

  if (!input.regions.has('breadcrumbs')) {
    push('breadcrumbs', 'NOT_TESTED', 'breadcrumb landmark not present in scan evidence');
  }
  if (!input.regions.has('pagination')) {
    push(
      'pagination',
      'NOT_TESTED',
      'pagination landmark or rel=next|prev not present in scan evidence'
    );
  }
  if (!input.regions.has('tabs')) {
    push('tabs', 'NOT_TESTED', 'role=tab or tablist not present in scan evidence');
  }
  if (!input.regions.has('dropdown')) {
    push(
      'dropdown',
      'NOT_TESTED',
      'role=menu|listbox or popover not present in scan evidence'
    );
  }

  // cards / cta have no reliable role in the scan — always gap (never invent from class names).
  push('cards', 'NOT_TESTED', 'card surfaces are not distinguished without role/landmark evidence');
  push('cta', 'NOT_TESTED', 'CTA controls are not distinguished without role/landmark evidence');

  // Closed overlays are invisible to the crawl even when an open dialog was recorded.
  push('modal', 'NOT_TESTED', 'closed modals/drawers are not in the crawled DOM');

  if (!input.sawHashClientRoute) {
    push(
      'client-route',
      'NOT_TESTED',
      'client-side routes were not present in crawled HTML'
    );
  }

  if (!input.auth?.succeeded) {
    push(
      'authenticated-routes',
      'REQUIRES_CONFIGURATION',
      'authenticated routes were not crawled; no session was established'
    );
  }

  // Keep a single role-based-routes row (NOT_TESTED). Extend the reason when no caller session
  // was provided — do not add a second contradictory channel or invent role URLs.
  push(
    'role-based-routes',
    'NOT_TESTED',
    input.hasCallerSessions
      ? 'role-based routes are not enumerated without crawled per-role screens'
      : 'role-based routes are not enumerated without an authorized role session; no session was provided for this access gate'
  );

  const onlySeed =
    input.pageMap.pages.length <= 1 && (input.pageMap.pages[0]?.depth ?? 0) === 0;

  if (onlySeed || input.pageMap.truncated) {
    push(
      'dynamic-navigation',
      'NOT_TESTED',
      `further link following depends on the existing crawler maxDepth=${input.maxDepth}` +
        (input.pageMap.truncated ? ' (crawl truncated)' : '')
    );
  }

  // --- Screen-state channels (run-level, once each; never PASS) ---
  if (!input.observed.loading) {
    push(
      'loading',
      'NOT_TESTED',
      'loading state was not present in scan evidence (aria-busy or role=progressbar)'
    );
  }
  if (!input.observed.empty) {
    push(
      'empty',
      'NOT_TESTED',
      'empty state was not present in scan evidence'
    );
  }
  if (!input.observed.success) {
    push(
      'success',
      'NOT_TESTED',
      'success state was not present in scan evidence (role=status|alert with kind=success)'
    );
  }
  if (!input.observed.validationError) {
    push(
      'validation-error',
      'NOT_TESTED',
      'validation-error state was not present in scan evidence (aria-invalid=true)'
    );
  }
  if (!input.observed.authenticated) {
    if (!input.auth?.succeeded) {
      push(
        'authenticated',
        'REQUIRES_CONFIGURATION',
        'authenticated state requires a session'
      );
    } else {
      push(
        'authenticated',
        'NOT_TESTED',
        'session was established but no page access=authenticated was recorded'
      );
    }
  }
  if (!input.observed.unauthenticated) {
    push(
      'unauthenticated',
      'NOT_TESTED',
      'unauthenticated / login-wall state was not present on crawled URLs'
    );
  }
  if (!input.observed.permissionDenied) {
    push(
      'permission-denied',
      'NOT_TESTED',
      'permission-denied state was not present (HTTP 401/403)'
    );
  }
  if (!input.observed.error) {
    push(
      'error',
      'NOT_TESTED',
      'error state was not present (HTTP >= 400 or page error string)'
    );
  }
  if (!input.observed.dropdownOpen) {
    push(
      'dropdown-open',
      'NOT_TESTED',
      'dropdown-open state was not present in scan evidence'
    );
  }
  if (!input.observed.expanded) {
    push(
      'expanded',
      'NOT_TESTED',
      'expanded is a screen state only for page-level landmark regions with aria-expanded; not observed'
    );
  }
  if (!input.observed.collapsed) {
    push(
      'collapsed',
      'NOT_TESTED',
      'collapsed is a screen state only for page-level landmark regions with aria-expanded; not observed'
    );
  }
  if (!input.observed.populated) {
    push(
      'populated',
      'NOT_TESTED',
      'populated requires an empty-state screen plus data rows on the default document; not observed'
    );
  }
  if (!input.observed.confirmation) {
    push(
      'confirmation',
      'NOT_TESTED',
      'confirmation dialog was not open in the crawled DOM'
    );
  }

  // Disabled controls are element properties — never SCREEN-NNN.
  push(
    'disabled',
    'NOT_APPLICABLE',
    'disabled is an element property, not a screen state'
  );

  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.channel)) return false;
    seen.add(row.channel);
    return true;
  });
}

/** Look up a screen by url + state (default when omitted). */
export function findScreen(
  screens: DiscoveredScreen[],
  url: string,
  state = 'default'
): DiscoveredScreen | undefined {
  const key = screenIdentityKey(url, state);
  return screens.find((screen) => screenIdentityKey(screen.url, screen.state) === key);
}

function overlayStateForPage(
  screens: DiscoveredScreen[],
  pageUrl: string
): DiscoveredScreen | undefined {
  const page = canonicalScreenUrl(pageUrl);
  const order = ['dialog', 'drawer', 'modal'] as const;
  for (const state of order) {
    const match = screens.find(
      (screen) => screenIdentityKey(screen.url, screen.state) === screenIdentityKey(page, state)
    );
    if (match) return match;
  }
  return undefined;
}

function defaultScreenForPage(
  screens: DiscoveredScreen[],
  pageUrl: string
): DiscoveredScreen | undefined {
  const page = canonicalScreenUrl(pageUrl);
  return (
    screens.find(
      (screen) => screenIdentityKey(screen.url, screen.state) === screenIdentityKey(page, 'default')
    ) ?? screens.find((screen) => canonicalScreenUrl(screen.url) === page)
  );
}

/**
 * Attach scanned elements to screen identities from buildScreenInventory.
 * Overlay-tied nodes go to dialog/drawer/modal screens when those exist; otherwise default.
 * Every screen id gets a row (empty list when no elements). Does not invent elements.
 *
 * Per screen (url + state): assigns ELEMENT-NNN via stable sort
 * (elementKind → preferred locator source rank → locator → accessible name),
 * and publishes stable locator / locatorStrategy / locatorStable.
 * ELEMENT ids restart per screen — two screens may both have ELEMENT-001.
 */
export function attachElementsToScreens(
  ui: UiInventory,
  screens: DiscoveredScreen[]
): UiInventory {
  const byScreen = new Map<string, UiElementRecord[]>();
  for (const screen of screens) {
    byScreen.set(screen.id, []);
  }

  const unattached: UiElementRecord[] = [];

  for (const el of ui.elements) {
    const wantsOverlay =
      el.insideOverlay || el.elementType === 'modal' || el.elementType === 'drawer';
    const overlay = wantsOverlay ? overlayStateForPage(screens, el.page) : undefined;
    const target =
      overlay ??
      defaultScreenForPage(screens, el.page) ??
      screens.find((s) => canonicalScreenUrl(s.url) === canonicalScreenUrl(el.page));
    const screenId = target?.id;
    const next = screenId ? { ...el, screenId } : { ...el };
    if (screenId && byScreen.has(screenId)) {
      byScreen.get(screenId)!.push(next);
    } else {
      unattached.push(next);
    }
  }

  const screenElements = screens.map((screen) => {
    const assigned = assignStableElementIdentities(byScreen.get(screen.id) ?? [], screen.id);
    byScreen.set(screen.id, assigned);
    return {
      screenId: screen.id,
      url: screen.url,
      state: screen.state,
      elements: assigned,
    };
  });

  const elements: UiElementRecord[] = [
    ...screens.flatMap((screen) => byScreen.get(screen.id) ?? []),
    ...unattached,
  ];

  return {
    ...ui,
    elements,
    screenElements,
  };
}

/** pathname + search + hash (no origin). Undefined when the URL cannot be parsed. */
export function routeFromScreenUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`;
  } catch {
    return undefined;
  }
}

function formatWorkflowId(index: number): string {
  return `WF-${String(index).padStart(3, '0')}`;
}

function indexPagesByCanonicalUrl(pages: PageMapEntry[]): Map<string, PageMapEntry> {
  const map = new Map<string, PageMapEntry>();
  for (const page of pages) {
    const key = canonicalScreenUrl(page.finalUrl ?? page.url);
    if (!map.has(key)) map.set(key, page);
  }
  return map;
}

/**
 * Roles only when an existing auth/session object already carries string roles.
 * Never defaults to admin or invents role names.
 */
function rolesFromAuth(auth?: AuthAttempt | null): string[] | undefined {
  if (!auth || typeof auth !== 'object') return undefined;
  const raw = (auth as AuthAttempt & { roles?: unknown }).roles;
  if (!Array.isArray(raw)) return undefined;
  const roles = raw.filter((role): role is string => typeof role === 'string' && role.trim().length > 0);
  return roles.length > 0 ? roles : undefined;
}

function resolveAuthentication(
  screen: DiscoveredScreen,
  page: PageMapEntry | undefined
): { authenticationRequired: boolean; authenticationEvidence: AuthenticationEvidence } {
  if (screen.state === 'unauthenticated' || screen.state === 'permission-denied') {
    return { authenticationRequired: true, authenticationEvidence: 'gated' };
  }
  const access = page?.access;
  if (access === 'gated') {
    return { authenticationRequired: true, authenticationEvidence: 'gated' };
  }
  if (access === 'authenticated' || screen.state === 'authenticated') {
    return { authenticationRequired: false, authenticationEvidence: 'authenticated' };
  }
  if (access === 'public') {
    return { authenticationRequired: false, authenticationEvidence: 'public' };
  }
  // Missing / error / unknown — never claim the page is proven public.
  return { authenticationRequired: false, authenticationEvidence: 'unknown' };
}

function elementsForScreen(
  screen: DiscoveredScreen,
  ui: UiInventory | null | undefined
): UiElementRecord[] {
  if (!ui) return [];
  const grouped = ui.screenElements?.find((row) => row.screenId === screen.id);
  if (grouped) return grouped.elements;
  return ui.elements.filter((el) => el.screenId === screen.id);
}

function accessibleNameFromRecord(el: UiElementRecord): string | null {
  const name = (el.accessibleName ?? el.label ?? '').trim();
  return name || null;
}

/**
 * required: true only from required=true / aria-required=true evidence;
 * false only when the scan/attributes explicitly say not required;
 * omit when the attribute/field is unknown (do not default to false).
 */
function requiredFromEvidence(el: UiElementRecord): boolean | undefined {
  const attrs = el.attributes ?? {};
  if (attrs['aria-required'] === 'true') return true;
  if (attrs['aria-required'] === 'false') return false;
  if (Object.prototype.hasOwnProperty.call(attrs, 'required')) {
    return attrs['required'] !== 'false';
  }
  if (typeof el.required === 'boolean') return el.required;
  return undefined;
}

/**
 * disabled: true only when disabled attribute, aria-disabled=true, or enabled===false.
 * Omit when unknown (never invent false).
 */
function disabledFromEvidence(el: UiElementRecord): true | undefined {
  const attrs = el.attributes ?? {};
  if (attrs['aria-disabled'] === 'true') return true;
  if (Object.prototype.hasOwnProperty.call(attrs, 'disabled')) return true;
  if (el.enabled === false) return true;
  return undefined;
}

/** Validation rules only for constraints present on the scan record / attributes. */
function validationFromEvidence(el: UiElementRecord): ValidationRule[] {
  const rules: ValidationRule[] = [];
  const required = requiredFromEvidence(el);
  if (required === true) {
    rules.push({ kind: 'required' });
  }
  const inputType = (el.inputType ?? el.attributes?.type ?? '').trim();
  if (inputType) {
    rules.push({ kind: 'type', value: inputType });
  }
  if (el.min != null && String(el.min).length > 0) {
    rules.push({ kind: 'min', value: String(el.min) });
  }
  if (el.max != null && String(el.max).length > 0) {
    rules.push({ kind: 'max', value: String(el.max) });
  }
  if (el.minLength != null && String(el.minLength).length > 0) {
    rules.push({ kind: 'minLength', value: String(el.minLength) });
  }
  if (el.maxLength != null && String(el.maxLength).length > 0) {
    rules.push({ kind: 'maxLength', value: String(el.maxLength) });
  }
  const pattern = el.attributes?.pattern;
  if (pattern != null && String(pattern).length > 0) {
    rules.push({ kind: 'pattern', value: String(pattern) });
  }
  return rules;
}

function toTestableElement(el: UiElementRecord, screenId: string): TestableElement {
  const type = (el.type ?? el.elementKind ?? 'unknown') as ElementKind | string;
  const kind = (el.elementKind ?? el.type ?? 'unknown') as ElementKind;
  const decorative = kind === 'decorative' || type === 'decorative';
  const name = accessibleNameFromRecord(el);
  const required = requiredFromEvidence(el);
  const disabled = disabledFromEvidence(el);
  const validation = validationFromEvidence(el);
  const actions = plannerActionsForKind(kind);
  const locatorStrategy: LocatorStrategy | string = el.locatorStrategy ?? 'fallback';
  const locatorStable = el.locatorStable === true;

  const published: TestableElement = {
    elementId: el.elementId,
    screenId: el.screenId ?? screenId,
    type,
    category: elementCategoryFromKind(kind, { tag: el.tag, href: el.href }),
    locator: el.locator ?? null,
    actions,
    metadata: {
      locatorStrategy,
      locatorStable,
      elementKind: kind,
      decorative,
    },
  };
  if (name) {
    published.label = name;
    published.accessibleName = name;
  }
  if (required !== undefined) published.required = required;
  if (disabled !== undefined) published.disabled = disabled;
  if (validation.length > 0) published.validation = validation;
  return published;
}

function workflowsFromNavigation(
  screen: DiscoveredScreen,
  navigation: NavigationEntry[]
): WorkflowReference[] {
  const fromKey = canonicalScreenUrl(screen.url);
  const destinations = new Set<string>();
  for (const edge of navigation) {
    if (!edge.to) continue;
    if (canonicalScreenUrl(edge.from) !== fromKey) continue;
    destinations.add(canonicalScreenUrl(edge.to));
  }
  const sorted = [...destinations].sort((a, b) => a.localeCompare(b));
  return sorted.map((toUrl, index) => ({
    workflowId: formatWorkflowId(index + 1),
    fromScreenId: screen.id,
    toUrl,
    source: 'navigation-edge' as const,
  }));
}

/**
 * Normalize DiscoveredScreen rows into ScreenInventory[] — one row per screen id (url+state).
 * Does not invent screens, roles, or multi-step workflows. Unresolved channels stay outside.
 */
export function toScreenInventories(input: {
  screens: DiscoveredScreen[];
  pageMap: PageMap;
  ui?: UiInventory | null;
  auth?: AuthAttempt | null;
}): ScreenInventory[] {
  const { screens, pageMap, ui, auth } = input;
  const pagesByUrl = indexPagesByCanonicalUrl(pageMap.pages);
  const roles = rolesFromAuth(auth ?? pageMap.auth);
  const siblingsByUrl = new Map<string, string[]>();

  for (const screen of screens) {
    const key = canonicalScreenUrl(screen.url);
    const bucket = siblingsByUrl.get(key) ?? [];
    bucket.push(screen.id);
    siblingsByUrl.set(key, bucket);
  }

  return screens.map((screen) => {
    const page = pagesByUrl.get(canonicalScreenUrl(screen.url));
    const authResolved = resolveAuthentication(screen, page);
    const elements = elementsForScreen(screen, ui).map((el) => toTestableElement(el, screen.id));
    const workflows = workflowsFromNavigation(screen, pageMap.navigation ?? []);
    const siblingScreenIds = (siblingsByUrl.get(canonicalScreenUrl(screen.url)) ?? []).filter(
      (id) => id !== screen.id
    );
    const locatorStableCount = elements.filter((el) => el.metadata?.locatorStable === true).length;
    const locatorUnstableCount = elements.length - locatorStableCount;
    const route = routeFromScreenUrl(screen.url);
    const title = screen.title?.trim() ? screen.title.trim() : undefined;

    const metadata: Record<string, unknown> = {
      state: screen.state,
      siblingScreenIds,
      locatorStableCount,
      locatorUnstableCount,
      authenticationEvidence: authResolved.authenticationEvidence,
    };
    const sessionLabel = page?.metadata?.sessionLabel;
    if (typeof sessionLabel === 'string' && sessionLabel.trim()) {
      metadata.sessionLabel = sessionLabel.trim();
    }

    const row: ScreenInventory = {
      screenId: screen.id,
      url: screen.url,
      authenticationRequired: authResolved.authenticationRequired,
      states: [{ state: screen.state, source: screen.source }],
      elements,
      workflows,
      metadata,
    };
    if (route !== undefined) row.route = route;
    if (title) row.title = title;
    if (roles) row.roles = [...roles];
    return row;
  });
}
