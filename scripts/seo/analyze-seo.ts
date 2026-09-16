import type { DiscoveredPage, DiscoveryResult } from '../discovery/types';
import type { SeoFinding, SeoFindingStatus, SeoSeverity } from './types';
import { isLoopbackHost } from '../orchestrator/resolve-url';
import { isAutoindexTitle } from '../security/autoindex';
import { emptyHeadings, skippedHeadingLevels } from './heading-structure';

export function isSeoSkippedPage(page: Pick<DiscoveredPage, 'title' | 'isAutoindex'>): boolean {
  return page.isAutoindex === true || isAutoindexTitle(page.title ?? '');
}

function problem(
  nextId: () => string,
  rule: string,
  severity: SeoSeverity,
  status: SeoFindingStatus,
  page: string,
  detail: string,
  expected?: string,
  actual?: string
): SeoFinding {
  return { id: nextId(), rule, severity, status, page, detail, expected, actual };
}

function headingsOf(page: DiscoveredPage): Array<{ level: string; text: string }> {
  if (page.headings && page.headings.length > 0) {
    return page.headings.map((heading) => ({ level: heading.level, text: heading.text }));
  }
  return page.h1s.map((text) => ({ level: 'h1', text }));
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
      findings.push(
        problem(
          nextId,
          'non-https',
          'high',
          'FAIL',
          page.url,
          'Page is served over a non-HTTPS URL.',
          'https URL',
          page.url
        )
      );
    }
  }

  for (const page of loadedPages) {
    if (!page.title.trim()) {
      findings.push(
        problem(nextId, 'missing-title', 'high', 'FAIL', page.url, 'Page has no <title>.', 'non-empty title', '(empty)')
      );
    }

    if (page.h1s.length === 0) {
      findings.push(
        problem(nextId, 'missing-h1', 'high', 'FAIL', page.url, 'Page has no <h1>.', 'at least one h1', '0')
      );
    } else if (page.h1s.length > 1) {
      findings.push(
        problem(
          nextId,
          'multiple-h1',
          'low',
          'WARNING',
          page.url,
          `Page has ${page.h1s.length} <h1> elements — search engines expect at most one.`,
          'at most one h1',
          String(page.h1s.length)
        )
      );
    }

    const empty = emptyHeadings(headingsOf(page));
    if (empty.length > 0) {
      findings.push(
        problem(
          nextId,
          'empty-heading',
          'medium',
          'FAIL',
          page.url,
          `${empty.length} empty heading(s) (${empty.map((row) => row.level).join(', ')}).`,
          'headings with visible text',
          `${empty.length} empty`
        )
      );
    }

    const skipped = skippedHeadingLevels(headingsOf(page));
    if (skipped.length > 0) {
      findings.push(
        problem(
          nextId,
          'skipped-heading-level',
          'low',
          'WARNING',
          page.url,
          `Heading structure skips level(s) h${skipped.join(', h')} (observed ${headingsOf(page)
            .map((row) => row.level)
            .join(', ') || 'none'}).`,
          'h1–h6 without skipped levels',
          `skipped h${skipped.join(', h')}`
        )
      );
    }

    if (!page.metaDescription?.trim()) {
      findings.push(
        problem(
          nextId,
          'missing-meta-description',
          'medium',
          'FAIL',
          page.url,
          'Page has no meta description.',
          'non-empty meta description',
          '(absent)'
        )
      );
    }

    if (!page.canonicalUrl?.trim()) {
      findings.push(
        problem(
          nextId,
          'missing-canonical',
          'low',
          'FAIL',
          page.url,
          'Page has no canonical <link>.',
          'canonical link',
          '(absent)'
        )
      );
    }

    if (page.robotsMeta?.toLowerCase().includes('noindex')) {
      findings.push(
        problem(
          nextId,
          'robots-noindex',
          'medium',
          'WARNING',
          page.url,
          `Page's robots meta tag includes "noindex" (${page.robotsMeta}) — confirm this is intentional.`,
          'indexable unless intentional',
          page.robotsMeta
        )
      );
    }

    if (page.imagesWithoutAlt > 0) {
      findings.push(
        problem(
          nextId,
          'images-missing-alt',
          'medium',
          'FAIL',
          page.url,
          `${page.imagesWithoutAlt} of ${page.totalImages} image(s) have no alt attribute.`,
          'alt on every img',
          `${page.imagesWithoutAlt} missing`
        )
      );
    }

    if (!page.ogTitle && !page.ogDescription) {
      findings.push(
        problem(
          nextId,
          'missing-open-graph',
          'low',
          'FAIL',
          page.url,
          'Page has no Open Graph title or description (affects link-preview quality on social/chat).',
          'og:title or og:description',
          '(absent)'
        )
      );
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
      status: 'FAIL',
      page: 'site-wide',
      detail: `${urls.length} pages share the same ${label} ("${value}"): ${urls.join(', ')}`,
      expected: `unique ${label} per page`,
      actual: `${urls.length} pages`,
    });
  }
  return findings;
}
