import type { DiscoveredPage, DiscoveryResult } from '../discovery/types';

export function makeDiscoveredPage(overrides: Partial<DiscoveredPage> = {}): DiscoveredPage {
  return {
    url: 'https://example.com/',
    status: 200,
    ok: true,
    title: 'Example — Home',
    h1s: ['Welcome'],
    formCount: 0,
    linkCount: 3,
    consoleErrors: [],
    failedRequests: [],
    depth: 0,
    metaDescription: 'A description of the example page.',
    canonicalUrl: 'https://example.com/',
    robotsMeta: null,
    ogTitle: 'Example — Home',
    ogDescription: 'A description of the example page.',
    ogImage: 'https://example.com/og.png',
    totalImages: 2,
    imagesWithoutAlt: 0,
    ...overrides,
  };
}

export function makeDiscoveryResult(
  pages: DiscoveredPage[] = [],
  overrides: Partial<DiscoveryResult> = {}
): DiscoveryResult {
  return {
    seedUrl: 'https://example.com/',
    scopeHost: 'example.com',
    crawledAt: new Date().toISOString(),
    pages,
    skippedByScope: [],
    skippedByExclude: [],
    pagesDiscoveredRaw: pages.length,
    pagesDiscoveredUnique: pages.length,
    truncated: false,
    ...overrides,
  };
}
