import { PATHS } from './paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { PageMap } from '../discovery/page-map';
import { originOf } from './suite-origin';
import type { ResolvedUiTarget } from './ui-target';

export interface UiPageTarget {
  path: string;
  name: string;
  url: string;
  source: 'discovery' | 'fixture' | 'homepage-fallback';
}

export interface ResolvedPageTargets {
  pages: UiPageTarget[];
  source: ResolvedPageTargets['pages'][number]['source'];
  reason?: string;
}

function routeName(route: string): string {
  const cleaned = route.replace(/[?#].*$/, '').replace(/\/+$/, '') || 'home';
  const leaf = cleaned === '/' ? 'home' : cleaned.replace(/^\//, '').replace(/[^\w.-]+/g, '-');
  return leaf || 'home';
}

function pathOf(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return fallback;
  }
}

/**
 * Pages visual / responsive / accessibility must execute against.
 * When the target is a live origin, discovery inventory wins; fixture HTML is
 * not used as a silent substitute.
 */
export function resolveDiscoveredPageTargets(input: {
  target: ResolvedUiTarget;
  fallback: UiPageTarget[];
  maxPages?: number;
  pageMap?: PageMap | null;
}): ResolvedPageTargets {
  const pageMap = input.pageMap !== undefined ? input.pageMap : readJsonIfExists<PageMap>(PATHS.pageMapFile);
  const seedOrigin = pageMap ? originOf(pageMap.seedUrl) : '';
  const sameOrigin = Boolean(pageMap && seedOrigin !== 'NOT_AVAILABLE' && seedOrigin === input.target.origin);

  if (pageMap && sameOrigin) {
    const okPages = pageMap.pages.filter((page) => page.ok && !page.error && page.access !== 'gated');
    const seen = new Set<string>();
    const pages: UiPageTarget[] = [];
    const limit = input.maxPages ?? okPages.length;
    for (const page of okPages) {
      const route = page.route || pathOf(page.url, '/');
      if (seen.has(route)) continue;
      seen.add(route);
      pages.push({
        path: route,
        name: routeName(route),
        url: page.url,
        source: 'discovery',
      });
      if (pages.length >= limit) break;
    }
    if (pages.length > 0) {
      return { pages, source: 'discovery' };
    }
  }

  if (!input.target.isLoopback) {
    return {
      pages: [
        {
          path: '/',
          name: 'home',
          url: `${input.target.url}/`,
          source: 'homepage-fallback',
        },
      ],
      source: 'homepage-fallback',
      reason: pageMap
        ? 'Discovery page-map origin does not match the live UI target — homepage is executed so live UI is not skipped.'
        : 'Discovery page-map is missing — homepage is executed so live UI is not skipped. Fixture pages are not substituted.',
    };
  }

  return {
    pages: input.fallback.map((page) => ({ ...page, source: 'fixture' })),
    source: 'fixture',
    reason: 'UI target is loopback — fixture pages are the intended scope.',
  };
}
