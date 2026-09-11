import type { DiscoveredPage, DiscoveryResult } from '../discovery/types';
import type { SeoFinding } from './types';
import { isLoopbackHost } from '../orchestrator/resolve-url';
import { isAutoindexTitle } from '../security/autoindex';

export function isSeoSkippedPage(page: Pick<DiscoveredPage, 'title' | 'isAutoindex'>): boolean {
  return page.isAutoindex === true || isAutoindexTitle(page.title ?? '');
}

/**
 * Pure function: discovery -> SEO findings. No network/browser calls, so this is fully
 * unit-testable against canned fixtures. Only pages that actually loaded (no navigation error,
 * status < 400) are analyzed for content-based rules (title/meta/h1/canonical/images) — a broken
 * page's SEO metadata isn't meaningful, and it's already flagged by broken-link detection.
 */
export function analyzeSeo(discovery: DiscoveryResult): SeoFinding[] {
  const findings: SeoFinding[] = [];
  let seq = 1;
  const nextId = () => `SEO-${String(seq++).padStart(4, '0')}`;

  const loadedPages = discovery.pages.filter(
    (page) => !page.error && page.status !== null && page.status < 400 && !isSeoSkippedPage(page)
  );

  for (const page of discovery.pages) {
    if (isSeoSkippedPage(page)) continue;
    try {
      if (isLoopbackHost(new URL(page.url).hostname)) continue;
    } catch {
      /* keep HTTPS check when URL is not parseable */
    }
    if (!page.url.startsWith('https://')) {
      findings.push({
        id: nextId(),
        rule: 'non-https',
        severity: 'high',
        page: page.url,
        detail: 'Page is served over a non-HTTPS URL.',
      });
    }
  }

  for (const page of loadedPages) {
    if (!page.title.trim()) {
      findings.push({
        id: nextId(),
        rule: 'missing-title',
        severity: 'high',
        page: page.url,
        detail: 'Page has no <title>.',
      });
    }

    if (page.h1s.length === 0) {
      findings.push({
        id: nextId(),
        rule: 'missing-h1',
        severity: 'high',
        page: page.url,
        detail: 'Page has no <h1>.',
      });
    } else if (page.h1s.length > 1) {
      findings.push({
        id: nextId(),
        rule: 'multiple-h1',
        severity: 'low',
        page: page.url,
        detail: `Page has ${page.h1s.length} <h1> elements — search engines expect at most one.`,
      });
    }

    if (!page.metaDescription?.trim()) {
      findings.push({
        id: nextId(),
        rule: 'missing-meta-description',
        severity: 'medium',
        page: page.url,
        detail: 'Page has no meta description.',
      });
    }

    if (!page.canonicalUrl?.trim()) {
      findings.push({
        id: nextId(),
        rule: 'missing-canonical',
        severity: 'low',
        page: page.url,
        detail: 'Page has no canonical <link>.',
      });
    }

    if (page.robotsMeta?.toLowerCase().includes('noindex')) {
      findings.push({
        id: nextId(),
        rule: 'robots-noindex',
        severity: 'medium',
        page: page.url,
        detail: `Page's robots meta tag includes "noindex" (${page.robotsMeta}) — confirm this is intentional.`,
      });
    }

    if (page.imagesWithoutAlt > 0) {
      findings.push({
        id: nextId(),
        rule: 'images-missing-alt',
        severity: 'medium',
        page: page.url,
        detail: `${page.imagesWithoutAlt} of ${page.totalImages} image(s) have no alt attribute.`,
      });
    }

    if (!page.ogTitle && !page.ogDescription) {
      findings.push({
        id: nextId(),
        rule: 'missing-open-graph',
        severity: 'low',
        page: page.url,
        detail: 'Page has no Open Graph title or description (affects link-preview quality on social/chat).',
      });
    }
  }

  findings.push(...findDuplicates(loadedPages, (page) => page.title.trim(), 'duplicate-title', 'title', nextId));
  findings.push(
    ...findDuplicates(
      loadedPages,
      (page) => page.metaDescription?.trim() ?? '',
      'duplicate-meta-description',
      'meta description',
      nextId
    )
  );

  return findings;
}

function findDuplicates(
  pages: DiscoveredPage[],
  keyFn: (page: DiscoveredPage) => string,
  rule: string,
  label: string,
  nextId: () => string
): SeoFinding[] {
  const byValue = new Map<string, string[]>();
  for (const page of pages) {
    const value = keyFn(page);
    if (!value) continue;
    const bucket = byValue.get(value);
    if (bucket) bucket.push(page.url);
    else byValue.set(value, [page.url]);
  }

  const findings: SeoFinding[] = [];
  for (const [value, urls] of byValue) {
    if (urls.length < 2) continue;
    findings.push({
      id: nextId(),
      rule,
      severity: 'medium',
      page: 'site-wide',
      detail: `${urls.length} pages share the same ${label} ("${value}"): ${urls.join(', ')}`,
    });
  }
  return findings;
}
