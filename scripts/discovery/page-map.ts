import { isInScope, normalizeUrl, resolveScopeAnchor } from '../core/scope';
import { applicableTestTypes, potentialAction } from './test-types';
import { rollupCategory, type CategoryStatus } from './categories';
import type {
  DiscoveryResult,
  NavigationRegion,
  PageAccess,
  PageHeading,
} from './types';
import type { AuthAttempt } from './auth-session';
import type { RedirectHop } from './redirects';

export interface PageMapEntry {
  url: string;
  finalUrl?: string;
  route: string;
  title: string;
  status: number | null;
  ok: boolean;
  depth: number;
  headings?: PageHeading[];
  h1s: string[];
  redirects?: RedirectHop[];
  canonicalUrl?: string | null;
  internalLinks?: string[];
  access?: PageAccess;
  gatedReason?: string;
  error?: string;
  applicableTestTypes: ReturnType<typeof applicableTestTypes>;
  isAutoindex?: boolean;
}

export interface RouteEntry {
  path: string;
  url: string;
  title: string;
  source: 'crawl';
}

export interface NavigationEntry {
  from: string;
  to: string;
  linkText: string;
  inScope: boolean;
  applicableTestTypes: ReturnType<typeof applicableTestTypes>;
  potentialAction: string;
}

export interface PageMap {
  generatedAt: string;
  seedUrl: string;
  scopeHost: string;
  truncated: boolean;
  pages: PageMapEntry[];
  routes: RouteEntry[];
  navigation: NavigationEntry[];
  navigationRegions?: NavigationRegion[];
  skippedByScope: string[];
  skippedByExclude?: string[];
  pagesDiscoveredRaw?: number;
  pagesDiscoveredUnique?: number;
  auth?: AuthAttempt;
  categoryStatus: CategoryStatus[];
}

function routeOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

function headingsOf(page: DiscoveryResult['pages'][number]): PageHeading[] {
  if (page.headings && page.headings.length > 0) return page.headings;
  return page.h1s.filter(Boolean).map((text) => ({ level: 'h1' as const, text }));
}

export function buildPageMap(discovery: DiscoveryResult): PageMap {
  const anchor = resolveScopeAnchor(discovery.seedUrl);

  const pages: PageMapEntry[] = discovery.pages.map((page) => {
    const internalLinks: string[] = [];
    const seenLinks = new Set<string>();
    for (const link of page.outboundLinks ?? []) {
      let normalized = link.href;
      try {
        normalized = normalizeUrl(link.href);
      } catch {
        continue;
      }
      if (!isInScope(normalized, anchor, true)) continue;
      if (seenLinks.has(normalized)) continue;
      seenLinks.add(normalized);
      internalLinks.push(normalized);
    }

    return {
      url: page.url,
      finalUrl: page.finalUrl ?? page.url,
      route: routeOf(page.finalUrl ?? page.url),
      title: page.title,
      status: page.status,
      ok: page.ok,
      depth: page.depth,
      headings: headingsOf(page),
      h1s: page.h1s,
      redirects: page.redirects ?? [],
      canonicalUrl: page.canonicalUrl,
      internalLinks,
      access: page.access ?? (page.error ? 'error' : 'public'),
      gatedReason: page.gatedReason,
      error: page.error,
      applicableTestTypes: applicableTestTypes('pages'),
      isAutoindex: page.isAutoindex,
    };
  });

  const routes: RouteEntry[] = [];
  const seenRoutes = new Set<string>();
  for (const page of pages) {
    if (seenRoutes.has(page.route)) continue;
    seenRoutes.add(page.route);
    routes.push({ path: page.route, url: page.url, title: page.title, source: 'crawl' });
  }

  const navigation: NavigationEntry[] = [];
  for (const page of discovery.pages) {
    for (const link of page.outboundLinks ?? []) {
      let normalized = link.href;
      try {
        normalized = normalizeUrl(link.href);
      } catch {
        continue;
      }
      const inScope = isInScope(normalized, anchor, true);
      navigation.push({
        from: page.url,
        to: normalized,
        linkText: link.text,
        inScope,
        applicableTestTypes: applicableTestTypes('navigation'),
        potentialAction: potentialAction('navigation', { href: normalized }),
      });
    }
  }

  const navigationRegions = discovery.pages.flatMap((page) => page.navigationRegions ?? []);
  const inScopeNav = navigation.filter((item) => item.inScope).length;
  const gatedCount = pages.filter((page) => page.access === 'gated').length;

  return {
    generatedAt: new Date().toISOString(),
    seedUrl: discovery.seedUrl,
    scopeHost: discovery.scopeHost,
    truncated: discovery.truncated,
    pages,
    routes,
    navigation,
    navigationRegions,
    skippedByScope: discovery.skippedByScope,
    skippedByExclude: discovery.skippedByExclude,
    pagesDiscoveredRaw: discovery.pagesDiscoveredRaw,
    pagesDiscoveredUnique: discovery.pagesDiscoveredUnique,
    auth: discovery.auth,
    categoryStatus: [
      rollupCategory('pages', pages.filter((page) => page.access !== 'gated').length, gatedCount, 'No pages were crawled'),
      rollupCategory('routes', routes.length, 0, 'No routes were derived from crawled URLs'),
      rollupCategory(
        'navigation',
        inScopeNav,
        navigation.length - inScopeNav,
        'No <a href> links were observed on crawled pages'
      ),
    ],
  };
}
