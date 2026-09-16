import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Request,
} from '@playwright/test';
import { isExcludedUrl, normalizeUrl, resolveScopeAnchor, isInScope, mapWithConcurrency } from '../core/scope';
import { fetchRobotsRules, isAllowedByRobots } from '../core/robots';
import { fetchSitemapUrls } from '../core/sitemap';
import { classify, authorize } from '../core/safety-policy';
import { isAutoindexPage } from '../security/autoindex';
import type { CrawlOptions, DiscoveredPage, DiscoveryResult, NavigationRegion, PageHeading } from './types';
import {
  authWithoutCredentials,
  classifyPageAccess,
  observeLoginWall,
  tryDiscoveryLogin,
  type AuthAttempt,
} from './auth-session';
import { redirectChain } from './redirects';

interface VisitResult {
  page: DiscoveredPage;
  links: string[];
}

const NAV_TIMEOUT_MS = 30000;
const SESSION_EXIT = /logout|log[\s-]?out|sign[\s-]?out|reset app state/i;

const PAGE_DOM = `(() => {
  const isVisible = function (el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const landmarkLocator = function (el) {
    if (el.id && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(el.id)) return '#' + el.id;
    const label = el.getAttribute('aria-label');
    if (label && !(label.includes('"') && label.includes("'"))) {
      const quote = label.includes('"') ? "'" : '"';
      return '[aria-label=' + quote + label + quote + ']';
    }
    const role = el.getAttribute('role');
    if (role) return '[role="' + role + '"]';
    return el.tagName.toLowerCase();
  };
  const regions = [];
  const add = function (selector, kind) {
    document.querySelectorAll(selector).forEach(function (el) {
      regions.push({
        kind: kind,
        locator: landmarkLocator(el),
        accessibleName: el.getAttribute('aria-label') || null,
        visible: isVisible(el),
      });
    });
  };
  add('header, [role="banner"]', 'header');
  add('footer, [role="contentinfo"]', 'footer');
  add('aside, [role="complementary"]', 'sidebar');
  add('nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i], ol.breadcrumb, .breadcrumb', 'breadcrumbs');
  add('nav, [role="navigation"], [role="menubar"]', 'menu');
  add('nav[aria-label*="pagination" i], [aria-label*="pagination" i], a[rel="next"], a[rel="prev"]', 'pagination');
  add('[role="tablist"], [role="tab"]', 'tabs');

  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(function (el) {
    return { level: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 200) };
  }).filter(function (item) { return item.text; });

  const description = document.querySelector('meta[name="description"]');
  const robots = document.querySelector('meta[name="robots"]');
  const canonical = document.querySelector('link[rel="canonical"]');
  const ogTitleEl = document.querySelector('meta[property="og:title"]');
  const ogDescriptionEl = document.querySelector('meta[property="og:description"]');
  const ogImageEl = document.querySelector('meta[property="og:image"]');
  const images = Array.from(document.querySelectorAll('img'));

  return {
    headings: headings,
    regions: regions,
    metaDescription: description && description.getAttribute('content') ? description.getAttribute('content').trim() : null,
    robotsMeta: robots && robots.getAttribute('content') ? robots.getAttribute('content').trim() : null,
    canonicalUrl: canonical && canonical.getAttribute('href') ? canonical.getAttribute('href').trim() : null,
    ogTitle: ogTitleEl && ogTitleEl.getAttribute('content') ? ogTitleEl.getAttribute('content').trim() : null,
    ogDescription: ogDescriptionEl && ogDescriptionEl.getAttribute('content') ? ogDescriptionEl.getAttribute('content').trim() : null,
    ogImage: ogImageEl && ogImageEl.getAttribute('content') ? ogImageEl.getAttribute('content').trim() : null,
    totalImages: images.length,
    imagesWithoutAlt: images.filter(function (img) { return !(img.getAttribute('alt') && img.getAttribute('alt').trim()); }).length,
  };
})()`;

function mayFollowLink(text: string, href: string, pageUrl: string, safety: CrawlOptions['safety']): boolean {
  if (SESSION_EXIT.test(text) || SESSION_EXIT.test(href)) return false;
  const risk = classify({ text, href, pageUrl, selector: href }, safety);
  return authorize({ kind: 'click-link', correlatesWithStateChange: risk === 'destructive' });
}

type MemoryStorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export async function crawl(seedUrl: string, options: CrawlOptions): Promise<DiscoveryResult> {
  const browser = await chromium.launch();
  try {
    return await runCrawl(browser, seedUrl, options);
  } finally {
    await browser.close();
  }
}

async function runCrawl(browser: Browser, seedUrl: string, options: CrawlOptions): Promise<DiscoveryResult> {
  const bootstrap = await browser.newContext();
  let resolvedSeed = seedUrl;
  let auth: AuthAttempt = authWithoutCredentials(false);
  let storageState: MemoryStorageState | undefined;
  try {
    const seedPage = await bootstrap.newPage();
    try {
      await seedPage.goto(seedUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
      resolvedSeed = seedPage.url() || seedUrl;
      await seedPage
        .locator('h1, a[href], input, button')
        .first()
        .waitFor({ state: 'attached', timeout: 5000 })
        .catch(() => undefined);

      const wall = await observeLoginWall(seedPage);
      if (options.credentials) {
        auth = await tryDiscoveryLogin(seedPage, options.credentials);
      } else {
        auth = authWithoutCredentials(wall.loginForm);
      }
      if (auth.succeeded) {
        storageState = await bootstrap.storageState();
      }
    } finally {
      await seedPage.close();
    }
  } finally {
    await bootstrap.close();
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

  let frontier = [admit(resolvedSeed), ...sitemapUrls.map(admit)].filter((url): url is string => Boolean(url));
  if (auth.succeeded && auth.afterUrl) {
    const landed = admit(auth.afterUrl);
    if (landed && !frontier.includes(landed)) frontier.push(landed);
  }

  let depth = 0;
  let truncated = false;

  while (frontier.length > 0 && depth <= options.maxDepth && pages.length < options.maxPages) {
    const remainingBudget = options.maxPages - pages.length;
    const batch = frontier.slice(0, remainingBudget);
    truncated = truncated || frontier.length > batch.length;

    const visitedRecords = await mapWithConcurrency(batch, options.concurrency, async (url) => {
      const context = await browser.newContext(storageState ? { storageState } : undefined);
      const page = await context.newPage();
      try {
        return await visitPage(page, url, depth, options.safety, auth.succeeded);
      } finally {
        await page.close();
        await context.close();
      }
    });

    pages.push(...visitedRecords.map((record) => record.page));

    if (depth < options.maxDepth) {
      const nextFrontier: string[] = [];
      for (const record of visitedRecords) {
        if (record.page.access === 'gated') continue;
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
    auth,
  };
}

async function visitPage(
  page: Page,
  url: string,
  depth: number,
  safety: CrawlOptions['safety'],
  authenticatedSession: boolean
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
  let redirects: DiscoveredPage['redirects'] = [];
  let finalUrl = url;

  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    status = response?.status() ?? null;
    ok = response?.ok() ?? false;
    finalUrl = page.url() || url;
    redirects = await redirectChain(response, finalUrl);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  let title = '';
  let h1s: string[] = [];
  let headings: PageHeading[] = [];
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
  let navigationRegions: NavigationRegion[] = [];
  let isAutoindex = false;
  let access: DiscoveredPage['access'] = errorMessage ? 'error' : 'public';
  let gatedReason: string | undefined;

  if (!errorMessage) {
    await page
      .locator('h1, a[href], input, button')
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
      .filter((link) => mayFollowLink(link.text, link.href, url, safety))
      .map((link) => link.href);

    const dom = (await page.evaluate(PAGE_DOM).catch(() => null)) as {
      headings: PageHeading[];
      regions: Array<Omit<NavigationRegion, 'page'>>;
      metaDescription: string | null;
      robotsMeta: string | null;
      canonicalUrl: string | null;
      ogTitle: string | null;
      ogDescription: string | null;
      ogImage: string | null;
      totalImages: number;
      imagesWithoutAlt: number;
    } | null;

    if (dom) {
      headings = dom.headings ?? [];
      navigationRegions = (dom.regions ?? []).map((region) => ({ ...region, page: url }));
      metaDescription = dom.metaDescription;
      robotsMeta = dom.robotsMeta;
      canonicalUrl = dom.canonicalUrl;
      ogTitle = dom.ogTitle;
      ogDescription = dom.ogDescription;
      ogImage = dom.ogImage;
      totalImages = dom.totalImages;
      imagesWithoutAlt = dom.imagesWithoutAlt;
    }

    const wall = await observeLoginWall(page);
    access = classifyPageAccess({
      error: errorMessage,
      loginForm: wall.loginForm,
      gatedMessage: wall.gatedMessage,
      pageUrl: finalUrl,
      authenticatedSession,
    });
    if (access === 'gated') {
      gatedReason = wall.gatedMessage
        ? `Behind authentication (${wall.gatedMessage}) — content was not inventoried`
        : 'Login form observed on this URL; authenticated content is not accessible without QA_USERNAME/QA_PASSWORD';
      ok = false;
    }
  }

  page.off('console', onConsole);
  page.off('requestfailed', onRequestFailed);

  return {
    page: {
      url,
      finalUrl,
      status,
      ok,
      title,
      h1s,
      headings,
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
      redirects,
      access,
      gatedReason,
      navigationRegions,
      isAutoindex,
    },
    links,
  };
}
