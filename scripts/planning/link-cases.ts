/**
 * Link behavior analysis and link test plans for the existing planner.
 * Consumed only by buildScenarioInventory → planLink — not a second planner.
 * Evidence-only: uses page-map status/finalUrl/error/access plus element href/target.
 * Never HTTP-gets. Never invents destinations. Never marks unseen status PASS.
 */

import { authorize, classify, type SafetyConfigResolved } from '../core/safety-policy';
import { elementCategoryFromKind, type ElementKind } from '../discovery/element-kind';
import type { PageMapEntry } from '../discovery/page-map';
import { canonicalScreenUrl } from '../discovery/screens';
import type { UiElementRecord } from '../discovery/ui-scan';
import type {
  CheckKind,
  CheckStatus,
  ControlKind,
  ElementPurpose,
  InventoryCategory,
  PlannedAction,
  PlannedCheck,
} from './types';

const SKIP_NON_NAV = /^(mailto:|tel:)/i;
const SKIP_HASH_OR_EMPTY = /^(#)?$/;
const JAVASCRIPT_HREF = /^javascript:/i;

/** Shared BLOCKED reason — never embed a javascript: payload in plan rows. */
export const JAVASCRIPT_HREF_NOT_FOLLOWED_REASON = 'BLOCKED: javascript href is not followed';
const DESTRUCTIVE_QUERY = /[?&](action|do|cmd)=(delete|remove|cancel|deactivate)/i;
const REDIRECT_LOOP = /redirect\s*loop|too\s*many\s*redirects/i;
const SECRET_QUERY_NAME = /^(token|password|key|session)$/i;

export type LinkSubcaseId =
  | 'link-missing-destination'
  | 'link-invalid-url'
  | 'link-destination'
  | 'link-http-status'
  | 'link-navigation'
  | 'link-redirect'
  | 'link-redirect-loop'
  | 'link-authentication'
  | 'link-broken'
  | 'link-external'
  | 'link-new-tab'
  | 'link-query'
  | 'link-deep';

export interface LinkSubcasePlan {
  subcaseId: LinkSubcaseId;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  category: InventoryCategory;
  reason?: string;
  expect?: PlannedCheck['expect'];
}

export interface LinkCaseResult {
  plans: LinkSubcasePlan[];
  exclusions: string[];
}

/** Page-map row plus optional crawl request fields when present. */
export type LinkPageEvidence = PageMapEntry & {
  requested?: string;
  redirectFrom?: string;
};

function pushUnique(seen: Set<string>, plans: LinkSubcasePlan[], plan: LinkSubcasePlan): void {
  if (seen.has(plan.subcaseId)) return;
  seen.add(plan.subcaseId);
  plans.push(plan);
}

function resolveKind(element: UiElementRecord, kind?: ElementKind): ElementKind {
  return kind ?? element.elementKind ?? 'unknown';
}

/**
 * True when this element should receive link-* inventory rows.
 * Uses elementCategoryFromKind (link | logo-link | breadcrumb | anchor-like nav-button).
 * Buttons stay in button-cases; decorative is excluded.
 */
export function isLinkKindForPlanning(
  element: UiElementRecord,
  kind?: ElementKind
): boolean {
  const resolved = resolveKind(element, kind);
  if (resolved === 'decorative') return false;
  return (
    elementCategoryFromKind(resolved, {
      tag: element.tag,
      href: element.href,
    }) === 'link'
  );
}

function rawHref(element: UiElementRecord): string {
  return (element.href ?? '').trim();
}

function isMissingDestination(href: string): boolean {
  return !href || SKIP_HASH_OR_EMPTY.test(href) || href === '#';
}

function tryResolveAbsolute(href: string, pageUrl: string): URL | undefined {
  try {
    return new URL(href, pageUrl);
  } catch {
    return undefined;
  }
}

function findPageEvidence(
  destination: string,
  pages: LinkPageEvidence[]
): LinkPageEvidence | undefined {
  const key = canonicalScreenUrl(destination);
  for (const page of pages) {
    if (canonicalScreenUrl(page.url) === key) return page;
    if (page.finalUrl && canonicalScreenUrl(page.finalUrl) === key) return page;
    if (page.requested && canonicalScreenUrl(page.requested) === key) return page;
    if (page.redirectFrom && canonicalScreenUrl(page.redirectFrom) === key) return page;
  }
  return undefined;
}

/**
 * Same safety gate as existing link plans: destructive query / classify / authorize click-link.
 * Does not fetch. Does not open a tab.
 */
export function isHrefNavigationAllowed(
  element: UiElementRecord,
  pageUrl: string,
  safety: SafetyConfigResolved
): boolean {
  const href = rawHref(element);
  if (!href || isMissingDestination(href) || SKIP_NON_NAV.test(href) || JAVASCRIPT_HREF.test(href)) {
    return false;
  }
  if (DESTRUCTIVE_QUERY.test(href)) return false;
  const risk = classify(
    {
      text: element.accessibleName ?? undefined,
      href,
      formMethod: element.formMethod ?? (element.isSubmit ? 'POST' : undefined),
      pageUrl,
      selector: element.locator ?? undefined,
    },
    safety
  );
  if (risk === 'destructive') return false;
  return authorize({ kind: 'click-link', correlatesWithStateChange: false });
}

function maskQueryDisplay(resolved: URL): { names: string[]; note: string; hrefDisplay: string } {
  const names: string[] = [];
  const pairs: string[] = [];
  for (const [name] of resolved.searchParams) {
    names.push(name);
    const value = SECRET_QUERY_NAME.test(name) ? '[MASKED]' : resolved.searchParams.get(name) ?? '';
    pairs.push(
      SECRET_QUERY_NAME.test(name)
        ? `${encodeURIComponent(name)}=[MASKED]`
        : `${encodeURIComponent(name)}=${encodeURIComponent(value)}`
    );
  }
  const base = `${resolved.protocol}//${resolved.host}${resolved.pathname}`;
  const hrefDisplay = pairs.length > 0 ? `${base}?${pairs.join('&')}` : base;
  const note = names
    .map((name) => (SECRET_QUERY_NAME.test(name) ? `${name}=[MASKED]` : name))
    .join(', ');
  return { names, note, hrefDisplay };
}

function pathSegmentCount(pathname: string): number {
  const trimmed = pathname.replace(/\/+$/, '') || '/';
  if (trimmed === '/') return 0;
  return trimmed.split('/').filter(Boolean).length;
}

function requestedUrlOf(page: LinkPageEvidence): string {
  return page.requested ?? page.redirectFrom ?? page.url;
}

function hasRedirectEvidence(page: LinkPageEvidence): boolean {
  const requested = requestedUrlOf(page);
  const finalUrl = page.finalUrl ?? page.url;
  if (canonicalScreenUrl(requested) !== canonicalScreenUrl(finalUrl)) return true;
  return (page.redirects?.length ?? 0) > 0;
}

function redirectLoopEvidence(page: LinkPageEvidence | undefined): string | undefined {
  if (!page) return undefined;
  const blob = `${page.error ?? ''} ${page.gatedReason ?? ''}`;
  if (REDIRECT_LOOP.test(blob)) return page.error?.trim() || page.gatedReason?.trim() || blob.trim();
  return undefined;
}

function planMissingOrNonNav(
  label: string,
  href: string,
  seen: Set<string>,
  plans: LinkSubcasePlan[]
): void {
  if (JAVASCRIPT_HREF.test(href)) {
    pushUnique(seen, plans, {
      subcaseId: 'link-missing-destination',
      kind: 'link-href',
      title: `${label} — link-missing-destination`,
      status: 'BLOCKED',
      action: 'none',
      category: 'positive',
      reason: JAVASCRIPT_HREF_NOT_FOLLOWED_REASON,
    });
    return;
  }
  if (SKIP_NON_NAV.test(href)) {
    pushUnique(seen, plans, {
      subcaseId: 'link-missing-destination',
      kind: 'link-href',
      title: `${label} — link-missing-destination`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'positive',
      reason: 'NOT_TESTED: non-navigation scheme',
    });
    return;
  }
  pushUnique(seen, plans, {
    subcaseId: 'link-missing-destination',
    kind: 'link-href',
    title: `${label} — link-missing-destination`,
    status: 'NOT_TESTED',
    action: 'none',
    category: 'positive',
    reason: 'NOT_TESTED: missing destination',
  });
}

function planNewTab(
  element: UiElementRecord,
  label: string,
  locator: string,
  control: ControlKind,
  seen: Set<string>,
  plans: LinkSubcasePlan[]
): void {
  const attrs = element.attributes ?? {};
  const target = (attrs.target ?? '').trim().toLowerCase();
  const rel = (attrs.rel ?? '').toLowerCase();
  const hasBlank = target === '_blank';
  const hasNoopener = /\bnoopener\b/i.test(rel);

  if (!hasBlank && !hasNoopener) {
    pushUnique(seen, plans, {
      subcaseId: 'link-new-tab',
      kind: 'link-href',
      title: `${label} — link-new-tab`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'positive',
      reason: 'NOT_APPLICABLE: no new-tab attribute discovered',
    });
    return;
  }

  const parts: string[] = [];
  if (hasBlank) parts.push('target=_blank');
  if (hasNoopener) parts.push('rel includes noopener');
  pushUnique(seen, plans, {
    subcaseId: 'link-new-tab',
    kind: 'link-href',
    title: `${label} — link-new-tab`,
    status: 'PLANNED',
    action: 'observe',
    category: 'positive',
    reason: `PLANNED: new-tab behavior observed (${parts.join(', ')})`,
    expect: { locator, control, note: parts.join(', ') },
  });
}

/**
 * Build link-* subcases from discovery evidence only.
 * Never fetches. Never opens tabs. Never marks unobserved HTTP status PASS.
 */
export function buildLinkSubcases(input: {
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  label: string;
  locator: string;
  kind?: ElementKind;
  pageUrl: string;
  safety: SafetyConfigResolved;
  pages: LinkPageEvidence[];
}): LinkCaseResult {
  const kind = resolveKind(input.element, input.kind);
  if (kind === 'decorative' || !isLinkKindForPlanning(input.element, kind)) {
    return { plans: [], exclusions: [] };
  }

  const plans: LinkSubcasePlan[] = [];
  const seen = new Set<string>();
  const { element, label, locator, control, pageUrl, safety, pages } = input;
  const href = rawHref(element);

  // New-tab is attribute-only — safe even without a navigable destination.
  planNewTab(element, label, locator, control, seen, plans);

  if (isMissingDestination(href) || SKIP_NON_NAV.test(href) || JAVASCRIPT_HREF.test(href)) {
    planMissingOrNonNav(label, href, seen, plans);
    return { plans, exclusions: [] };
  }

  const resolved = tryResolveAbsolute(href, pageUrl);
  if (!resolved) {
    pushUnique(seen, plans, {
      subcaseId: 'link-invalid-url',
      kind: 'link-href',
      title: `${label} — link-invalid-url`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'positive',
      reason: 'NOT_TESTED: invalid URL',
    });
    return { plans, exclusions: [] };
  }

  const absolute = resolved.href;
  const pageEvidence = findPageEvidence(absolute, pages);
  const navigationAllowed = isHrefNavigationAllowed(element, pageUrl, safety);

  pushUnique(seen, plans, {
    subcaseId: 'link-destination',
    kind: 'link-href',
    title: `${label} — link-destination`,
    status: 'PLANNED',
    action: 'observe',
    category: 'positive',
    reason: 'PLANNED: observe resolved destination URL only; no browser navigation',
    expect: { locator, href: absolute, control },
  });

  // --- HTTP response from crawl evidence only ---
  if (!pageEvidence || pageEvidence.status == null) {
    pushUnique(seen, plans, {
      subcaseId: 'link-http-status',
      kind: 'broken-link',
      title: `${label} — link-http-status`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'positive',
      reason: 'NOT_TESTED: HTTP response was not in the crawl',
      expect: { locator, href: absolute, control },
    });
  } else {
    const status = pageEvidence.status;
    if (status >= 200 && status <= 399) {
      pushUnique(seen, plans, {
        subcaseId: 'link-http-status',
        kind: 'broken-link',
        title: `${label} — link-http-status`,
        status: 'PLANNED',
        action: 'observe',
        category: 'positive',
        reason: `PLANNED: HTTP ${status} was recorded during discovery`,
        expect: { locator, href: absolute, control, note: `HTTP ${status}` },
      });
    } else if (status === 404) {
      pushUnique(seen, plans, {
        subcaseId: 'link-http-status',
        kind: 'broken-link',
        title: `${label} — link-http-status`,
        status: 'FAIL',
        action: 'observe',
        category: 'negative',
        reason: 'FAIL: broken link: HTTP 404 recorded during discovery',
        expect: { locator, href: absolute, control, note: 'HTTP 404' },
      });
    } else if (status === 410) {
      pushUnique(seen, plans, {
        subcaseId: 'link-http-status',
        kind: 'broken-link',
        title: `${label} — link-http-status`,
        status: 'FAIL',
        action: 'observe',
        category: 'negative',
        reason: 'FAIL: broken link: HTTP 410 recorded during discovery',
        expect: { locator, href: absolute, control, note: 'HTTP 410' },
      });
    } else if (status >= 500 && status <= 599) {
      pushUnique(seen, plans, {
        subcaseId: 'link-http-status',
        kind: 'broken-link',
        title: `${label} — link-http-status`,
        status: 'FAIL',
        action: 'observe',
        category: 'negative',
        reason: `FAIL: HTTP ${status} recorded during discovery`,
        expect: { locator, href: absolute, control, note: `HTTP ${status}` },
      });
    } else if (status === 401 || status === 403) {
      pushUnique(seen, plans, {
        subcaseId: 'link-http-status',
        kind: 'broken-link',
        title: `${label} — link-http-status`,
        status: 'NOT_TESTED',
        action: 'none',
        category: 'positive',
        reason: `NOT_TESTED: destination responded ${status}; authentication requirement observed, session was not used to pass it`,
        expect: { locator, href: absolute, control, note: `HTTP ${status}` },
      });
    } else {
      pushUnique(seen, plans, {
        subcaseId: 'link-http-status',
        kind: 'broken-link',
        title: `${label} — link-http-status`,
        status: 'NOT_TESTED',
        action: 'none',
        category: 'positive',
        reason: `NOT_TESTED: HTTP ${status} recorded during discovery (not classified as broken link)`,
        expect: { locator, href: absolute, control, note: `HTTP ${status}` },
      });
    }
  }

  // --- broken link: FAIL only for crawled 404/410; never when not crawled ---
  if (pageEvidence?.status === 404 || pageEvidence?.status === 410) {
    pushUnique(seen, plans, {
      subcaseId: 'link-broken',
      kind: 'broken-link',
      title: `${label} — link-broken`,
      status: 'FAIL',
      action: 'observe',
      category: 'negative',
      reason: `FAIL: broken link: HTTP ${pageEvidence.status} recorded during discovery`,
      expect: { locator, href: absolute, control },
    });
  }

  // --- navigation (observe-only when safety allows; never browser navigation) ---
  if (!navigationAllowed) {
    pushUnique(seen, plans, {
      subcaseId: 'link-navigation',
      kind: 'navigation',
      title: `${label} — link-navigation`,
      status: 'BLOCKED',
      action: 'none',
      category: 'positive',
      reason: 'BLOCKED: href is state-changing or not authorized for navigation',
      expect: { locator, href: absolute, control },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'link-navigation',
      kind: 'navigation',
      title: `${label} — link-navigation`,
      status: 'PLANNED',
      action: 'observe',
      category: 'positive',
      reason: 'PLANNED: destination was discovered',
      expect: { locator, href: absolute, control },
    });
  }

  // --- redirect (one hop from evidence) ---
  if (pageEvidence && hasRedirectEvidence(pageEvidence)) {
    const from = requestedUrlOf(pageEvidence);
    const to = pageEvidence.finalUrl ?? pageEvidence.url;
    pushUnique(seen, plans, {
      subcaseId: 'link-redirect',
      kind: 'navigation',
      title: `${label} — link-redirect`,
      status: 'PLANNED',
      action: 'observe',
      category: 'positive',
      reason: `PLANNED: redirect recorded from ${from} to ${to}`,
      expect: { locator, href: absolute, control, note: `redirectFrom=${from}; finalUrl=${to}` },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'link-redirect',
      kind: 'navigation',
      title: `${label} — link-redirect`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'positive',
      reason: 'NOT_TESTED: no redirect recorded',
    });
  }

  // --- redirect loop: only with existing evidence ---
  const loopText = redirectLoopEvidence(pageEvidence);
  if (loopText) {
    pushUnique(seen, plans, {
      subcaseId: 'link-redirect-loop',
      kind: 'broken-link',
      title: `${label} — link-redirect-loop`,
      status: 'FAIL',
      action: 'observe',
      category: 'negative',
      reason: `FAIL: ${loopText}`,
      expect: { locator, href: absolute, control },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'link-redirect-loop',
      kind: 'broken-link',
      title: `${label} — link-redirect-loop`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'positive',
      reason: 'NOT_TESTED: redirect loop was not observed',
    });
  }

  // --- authentication ---
  const authStatus = pageEvidence?.status;
  const gated = pageEvidence?.access === 'gated';
  if (gated || authStatus === 401 || authStatus === 403) {
    const code = authStatus === 401 || authStatus === 403 ? authStatus : undefined;
    const status: CheckStatus =
      code === 401 || code === 403 ? 'REQUIRES_CONFIGURATION' : 'NOT_TESTED';
    const reason =
      code != null
        ? `${status}: destination responded ${code}; authentication requirement observed, session was not used to pass it`
        : 'NOT_TESTED: destination access is gated; authentication requirement observed, session was not used to pass it';
    pushUnique(seen, plans, {
      subcaseId: 'link-authentication',
      kind: 'security-observation',
      title: `${label} — link-authentication`,
      status,
      action: 'none',
      category: 'security',
      reason,
      expect: { locator, href: absolute, control },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'link-authentication',
      kind: 'security-observation',
      title: `${label} — link-authentication`,
      status: 'NOT_TESTED',
      action: 'none',
      category: 'security',
      reason: 'NOT_TESTED: authentication requirement was not in discovery evidence',
    });
  }

  // --- external (host compare, no demo list) ---
  let pageHost: string | undefined;
  try {
    pageHost = new URL(pageUrl).host;
  } catch {
    pageHost = undefined;
  }
  if (pageHost && resolved.host !== pageHost) {
    pushUnique(seen, plans, {
      subcaseId: 'link-external',
      kind: 'link-href',
      title: `${label} — link-external`,
      status: 'PLANNED',
      action: 'observe',
      category: 'positive',
      reason: `PLANNED: destination host ${resolved.host} differs from page host ${pageHost}`,
      expect: { locator, href: absolute, control, note: `external host=${resolved.host}` },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'link-external',
      kind: 'link-href',
      title: `${label} — link-external`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'positive',
      reason: 'NOT_APPLICABLE: link is same-origin',
    });
  }

  // --- query parameters ---
  if (resolved.search && resolved.search.length > 1) {
    const masked = maskQueryDisplay(resolved);
    pushUnique(seen, plans, {
      subcaseId: 'link-query',
      kind: 'link-href',
      title: `${label} — link-query`,
      status: 'PLANNED',
      action: 'observe',
      category: 'positive',
      reason: `PLANNED: query parameter names: ${masked.names.join(', ')}`,
      expect: {
        locator,
        href: masked.hrefDisplay,
        control,
        note: masked.note,
      },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'link-query',
      kind: 'link-href',
      title: `${label} — link-query`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'positive',
      reason: 'NOT_APPLICABLE: no query string',
    });
  }

  // --- deep link ---
  if (pathSegmentCount(resolved.pathname) > 1) {
    pushUnique(seen, plans, {
      subcaseId: 'link-deep',
      kind: 'navigation',
      title: `${label} — link-deep`,
      status: 'PLANNED',
      action: 'observe',
      category: 'positive',
      reason: `PLANNED: pathname ${resolved.pathname} is a deep link`,
      expect: { locator, href: absolute, control, note: resolved.pathname },
    });
  } else {
    pushUnique(seen, plans, {
      subcaseId: 'link-deep',
      kind: 'navigation',
      title: `${label} — link-deep`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      category: 'positive',
      reason: 'NOT_APPLICABLE: path is not a deep link',
    });
  }

  return { plans, exclusions: [] };
}
