import { chromium, type ConsoleMessage, type Page, type Request } from '@playwright/test';
import { isExcludedUrl, normalizeUrl, resolveScopeAnchor, isInScope, mapWithConcurrency } from '../core/scope';
import { fetchRobotsRules, isAllowedByRobots } from '../core/robots';
import { fetchSitemapUrls } from '../core/sitemap';
import { classify, authorize } from '../core/safety-policy';
import { isAutoindexPage } from '../security/autoindex';
import type { CrawlOptions, DiscoveredPage, DiscoveryResult } from './types';

interface VisitResult {
  page: DiscoveredPage;
  links: string[];
}

const NAV_TIMEOUT_MS = 30000;

export async function crawl(seedUrl: string, options: CrawlOptions): Promise<DiscoveryResult> {
  const browser = await chromium.launch();
  try {
    return await runCrawl(browser, seedUrl, options);
  } finally {
    await browser.close();
  }
}

async function runCrawl(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  seedUrl: string,
  options: CrawlOptions
): Promise<DiscoveryResult> {
  const seedPage = await browser.newPage();
  let resolvedSeed = seedUrl;
  try {
    await seedPage.goto(seedUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    resolvedSeed = seedPage.url() || seedUrl;
  } finally {
    await seedPage.close();
  }

  const anchor = resolveScopeAnchor(resolvedSeed, options.additionalHosts);
  const origin = new URL(resolvedSeed).origin;

  const robotsRules = options.respectRobotsTxt
    ? await fetchRobotsRules(origin)
    : { disallow: [], allow: [] };
  const sitemapUrls = options.useSitemap ? await fetchSitemapUrls(origin) : [];

  const visited = new Set<string>();
  const rawCandidates = new Set<string>();
  const skippedByScope: string[] = [];
  const skippedByExclude: string[] = [];
  const pages: DiscoveredPage[] = [];

  const admit = (rawUrl: string): string | null => {
    let normalized: string;
    try {
      normalized = normalizeUrl(rawUrl);
    } catch {
      return null;
    }
    rawCandidates.add(rawUrl);
    if (visited.has(normalized)) return null;
    if (!isInScope(normalized, anchor, options.sameOriginOnly)) {
      skippedByScope.push(normalized);
      return null;
    }
    if (isExcludedUrl(normalized, options.excludePatterns)) {
      skippedByExclude.push(normalized);
      return null;
    }
    if (options.respectRobotsTxt && !isAllowedByRobots(new URL(normalized).pathname, robotsRules)) {
      skippedByScope.push(normalized);
      return null;
    }
    visited.add(normalized);
    return normalized;
  };

  let frontier = [admit(resolvedSeed), ...sitemapUrls.map(admit)].filter(
    (url): url is string => Boolean(url)
  );
  let depth = 0;
  let truncated = false;

  while (frontier.length > 0 && depth <= options.maxDepth && pages.length < options.maxPages) {
    const remainingBudget = options.maxPages - pages.length;
    const batch = frontier.slice(0, remainingBudget);
    truncated = truncated || frontier.length > batch.length;

    const visitedRecords = await mapWithConcurrency(batch, options.concurrency, async (url) => {
      const page = await browser.newPage();
      try {
        return await visitPage(page, url, depth, options.safety);
      } finally {
        await page.close();
      }
    });

    pages.push(...visitedRecords.map((record) => record.page));

    if (depth < options.maxDepth) {
      const nextFrontier: string[] = [];
      for (const record of visitedRecords) {
        for (const link of record.links) {
          const admitted = admit(link);
          if (admitted) nextFrontier.push(admitted);
        }
      }
      frontier = nextFrontier;
    } else {
      frontier = [];
    }
    depth += 1;
  }

  if (frontier.length > 0 || pages.length >= options.maxPages) {
    truncated = true;
  }

  return {
    seedUrl: resolvedSeed,
    scopeHost: anchor.host,
    crawledAt: new Date().toISOString(),
    pages,
    skippedByScope,
    skippedByExclude,
    pagesDiscoveredRaw: rawCandidates.size,
    pagesDiscoveredUnique: pages.length,
    truncated,
  };
}

async function visitPage(
  page: Page,
  url: string,
  depth: number,
  safety: CrawlOptions['safety']
): Promise<VisitResult> {
  const consoleErrors: string[] = [];
  const failedRequests: Array<{ url: string; method: string; failure: string }> = [];

  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 500));
  };
  const onRequestFailed = (request: Request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? 'unknown',
    });
  };

  page.on('console', onConsole);
  page.on('requestfailed', onRequestFailed);

  let status: number | null = null;
  let ok = false;
  let errorMessage: string | undefined;

  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    status = response?.status() ?? null;
    ok = response?.ok() ?? false;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  let title = '';
  let h1s: string[] = [];
  let formCount = 0;
  let links: string[] = [];
  let metaDescription: string | null = null;
  let canonicalUrl: string | null = null;
  let robotsMeta: string | null = null;
  let ogTitle: string | null = null;
  let ogDescription: string | null = null;
  let ogImage: string | null = null;
  let totalImages = 0;
  let imagesWithoutAlt = 0;
  let outboundLinks: Array<{ href: string; text: string }> = [];
  let isAutoindex = false;

  if (!errorMessage) {
    // Client-rendered SPAs finish the 'load' event before React (or similar) hydrates and paints
    // real content — wait briefly for a heading or link to actually exist before reading the DOM,
    // rather than reading it immediately after 'load' and getting an empty page.
    await page
      .locator('h1, a[href]')
      .first()
      .waitFor({ state: 'attached', timeout: 5000 })
      .catch(() => undefined);

    title = await page.title().catch(() => '');
    const htmlSnapshot = await page
      .evaluate(`(document.documentElement && document.documentElement.outerHTML || '').slice(0, 15000)`)
      .catch(() => '');
    isAutoindex = isAutoindexPage({ title, html: typeof htmlSnapshot === 'string' ? htmlSnapshot : '' });
    h1s = await page
      .locator('h1')
      .allTextContents()
      .catch(() => [] as string[]);
    formCount = await page
      .locator('form')
      .count()
      .catch(() => 0);

    const rawLinks = await page
      .locator('a[href]')
      .evaluateAll((anchors) =>
        (anchors as HTMLAnchorElement[]).map((a) => ({ href: a.href, text: (a.textContent ?? '').trim() }))
      )
      .catch(() => [] as Array<{ href: string; text: string }>);

    outboundLinks = rawLinks
      .filter((link) => Boolean(link.href))
      .map((link) => ({ href: link.href, text: link.text.slice(0, 120) }));

    links = rawLinks
      .filter((link) => {
        const risk = classify({ text: link.text, href: link.href, pageUrl: url, selector: link.href }, safety);
        return authorize({ kind: 'click-link', correlatesWithStateChange: risk === 'destructive' });
      })
      .map((link) => link.href);

    // String evaluate: tsx/esbuild injects `__name` into nested functions passed to page.evaluate.
    const seoMeta = (await page
      .evaluate(`(() => {
        const description = document.querySelector('meta[name="description"]');
        const robots = document.querySelector('meta[name="robots"]');
        const canonical = document.querySelector('link[rel="canonical"]');
        const ogTitleEl = document.querySelector('meta[property="og:title"]');
        const ogDescriptionEl = document.querySelector('meta[property="og:description"]');
        const ogImageEl = document.querySelector('meta[property="og:image"]');
        const images = Array.from(document.querySelectorAll('img'));
        return {
          metaDescription: description && description.getAttribute('content') ? description.getAttribute('content').trim() : null,
          robotsMeta: robots && robots.getAttribute('content') ? robots.getAttribute('content').trim() : null,
          canonicalUrl: canonical && canonical.getAttribute('href') ? canonical.getAttribute('href').trim() : null,
          ogTitle: ogTitleEl && ogTitleEl.getAttribute('content') ? ogTitleEl.getAttribute('content').trim() : null,
          ogDescription: ogDescriptionEl && ogDescriptionEl.getAttribute('content') ? ogDescriptionEl.getAttribute('content').trim() : null,
          ogImage: ogImageEl && ogImageEl.getAttribute('content') ? ogImageEl.getAttribute('content').trim() : null,
          totalImages: images.length,
          imagesWithoutAlt: images.filter(function (img) { return !(img.getAttribute('alt') && img.getAttribute('alt').trim()); }).length,
        };
      })()`)
      .catch(() => null)) as {
      metaDescription: string | null;
      robotsMeta: string | null;
      canonicalUrl: string | null;
      ogTitle: string | null;
      ogDescription: string | null;
      ogImage: string | null;
      totalImages: number;
      imagesWithoutAlt: number;
    } | null;

    if (seoMeta) {
      metaDescription = seoMeta.metaDescription;
      robotsMeta = seoMeta.robotsMeta;
      canonicalUrl = seoMeta.canonicalUrl;
      ogTitle = seoMeta.ogTitle;
      ogDescription = seoMeta.ogDescription;
      ogImage = seoMeta.ogImage;
      totalImages = seoMeta.totalImages;
      imagesWithoutAlt = seoMeta.imagesWithoutAlt;
    }
  }

  page.off('console', onConsole);
  page.off('requestfailed', onRequestFailed);

  return {
    page: {
      url,
      status,
      ok,
      title,
      h1s,
      formCount,
      linkCount: links.length,
      consoleErrors: consoleErrors.slice(0, 20),
      failedRequests: failedRequests.slice(0, 20),
      depth,
      error: errorMessage,
      metaDescription,
      canonicalUrl,
      robotsMeta,
      ogTitle,
      ogDescription,
      ogImage,
      totalImages,
      imagesWithoutAlt,
      outboundLinks,
      isAutoindex,
    },
    links,
  };
}
