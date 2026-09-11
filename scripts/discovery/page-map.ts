import { isInScope, normalizeUrl, resolveScopeAnchor } from '../core/scope';
import { applicableTestTypes, potentialAction } from './test-types';
import { rollupCategory, type CategoryStatus } from './categories';
import type { DiscoveryResult } from './types';

export interface PageMapEntry {
  url: string;
  route: string;
  title: string;
  status: number | null;
  ok: boolean;
  depth: number;
  h1s: string[];
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
  skippedByScope: string[];
  skippedByExclude?: string[];
  pagesDiscoveredRaw?: number;
  pagesDiscoveredUnique?: number;
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

export function buildPageMap(discovery: DiscoveryResult): PageMap {
  const anchor = resolveScopeAnchor(discovery.seedUrl);

  const pages: PageMapEntry[] = discovery.pages.map((page) => ({
    url: page.url,
    route: routeOf(page.url),
    title: page.title,
    status: page.status,
    ok: page.ok,
    depth: page.depth,
    h1s: page.h1s,
    error: page.error,
    applicableTestTypes: applicableTestTypes('pages'),
    isAutoindex: page.isAutoindex,
  }));

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

  const inScopeNav = navigation.filter((item) => item.inScope).length;

  return {
    generatedAt: new Date().toISOString(),
    seedUrl: discovery.seedUrl,
    scopeHost: discovery.scopeHost,
    truncated: discovery.truncated,
    pages,
    routes,
    navigation,
    skippedByScope: discovery.skippedByScope,
    skippedByExclude: discovery.skippedByExclude,
    pagesDiscoveredRaw: discovery.pagesDiscoveredRaw,
    pagesDiscoveredUnique: discovery.pagesDiscoveredUnique,
    categoryStatus: [
      rollupCategory('pages', pages.length, 0, 'No pages were crawled'),
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
