import type { PageMap } from '../discovery/page-map';
import type { DiscoveredPage, DiscoveryResult } from '../discovery/types';
import type { ParsedHtml } from '../lib/html-snapshot';

export function discoveryFromPageMap(
  pageMap: PageMap,
  htmlByUrl: Map<string, ParsedHtml> = new Map()
): DiscoveryResult {
  const pages: DiscoveredPage[] = pageMap.pages.map((page) => {
    const parsed = htmlByUrl.get(page.url) ?? htmlByUrl.get(page.finalUrl ?? '');
    const outbound =
      page.internalLinks?.map((href) => ({ href, text: '' })) ??
      [];
    return {
      url: page.url,
      finalUrl: page.finalUrl ?? page.url,
      status: page.status,
      ok: page.ok,
      title: page.title,
      h1s: page.h1s,
      headings: page.headings,
      formCount: 0,
      linkCount: outbound.length,
      consoleErrors: [],
      failedRequests: [],
      depth: page.depth,
      error: page.error,
      metaDescription: parsed?.metaDescription ?? null,
      canonicalUrl: page.canonicalUrl ?? parsed?.canonicalUrl ?? null,
      robotsMeta: parsed?.robotsMeta ?? null,
      ogTitle: parsed?.ogTitle ?? null,
      ogDescription: parsed?.ogDescription ?? null,
      ogImage: parsed?.ogImage ?? null,
      totalImages: parsed?.images.length ?? 0,
      imagesWithoutAlt: parsed?.images.filter((image) => !image.hasAltAttr || !image.alt.trim()).length ?? 0,
      outboundLinks: outbound,
      redirects: page.redirects ?? [],
      access: page.access,
      gatedReason: page.gatedReason,
      isAutoindex: page.isAutoindex,
    };
  });

  return {
    seedUrl: pageMap.seedUrl,
    scopeHost: pageMap.scopeHost,
    crawledAt: pageMap.generatedAt,
    pages,
    skippedByScope: pageMap.skippedByScope,
    skippedByExclude: pageMap.skippedByExclude,
    pagesDiscoveredRaw: pageMap.pagesDiscoveredRaw ?? pages.length,
    pagesDiscoveredUnique: pageMap.pagesDiscoveredUnique ?? pages.length,
    truncated: pageMap.truncated,
    auth: pageMap.auth,
  };
}
