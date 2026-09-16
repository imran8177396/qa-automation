import type { DiscoveredPage } from '../discovery/types';
import type { SeoFinding } from './types';
import { isSeoSkippedPage } from './analyze-seo';

function isLoaded(page: DiscoveredPage): boolean {
  return !page.error && page.status !== null && page.status < 400 && !isSeoSkippedPage(page);
}

/** PASS / NOT_TESTED rows for required fields that analyzeSeo does not emit when present. */
export function collectPagePresenceFindings(pages: DiscoveredPage[], nextId: () => string): SeoFinding[] {
  const findings: SeoFinding[] = [];

  const loaded = pages.filter(isLoaded);
  if (loaded.length < 2) {
    findings.push({
      id: nextId(),
      rule: 'duplicate-title',
      severity: 'info',
      status: 'NOT_TESTED',
      page: 'site-wide',
      detail:
        loaded.length === 0
          ? 'No loaded crawled pages were available to compare titles.'
          : 'Only one crawled page was available — duplicate titles are not detectable.',
      expected: 'two or more crawled pages',
      actual: `${loaded.length} loaded page(s)`,
    });
    findings.push({
      id: nextId(),
      rule: 'duplicate-meta-description',
      severity: 'info',
      status: 'NOT_TESTED',
      page: 'site-wide',
      detail: 'Duplicate meta descriptions are not detectable from a single crawled page.',
      expected: 'two or more crawled pages',
      actual: `${loaded.length} loaded page(s)`,
    });
  }

  for (const page of loaded) {
    if (page.title.trim()) {
      findings.push({
        id: nextId(),
        rule: 'title',
        severity: 'info',
        status: 'PASS',
        page: page.url,
        detail: 'Page has a non-empty title.',
        expected: 'non-empty title',
        actual: page.title.trim(),
      });
    }
    if (page.metaDescription?.trim()) {
      findings.push({
        id: nextId(),
        rule: 'meta-description',
        severity: 'info',
        status: 'PASS',
        page: page.url,
        detail: 'Page has a meta description.',
        expected: 'non-empty meta description',
        actual: page.metaDescription.trim(),
      });
    }
    if (page.canonicalUrl?.trim()) {
      findings.push({
        id: nextId(),
        rule: 'canonical',
        severity: 'info',
        status: 'PASS',
        page: page.url,
        detail: 'Page has a canonical link.',
        expected: 'canonical href',
        actual: page.canonicalUrl.trim(),
      });
    }
    if (page.ogTitle || page.ogDescription) {
      findings.push({
        id: nextId(),
        rule: 'open-graph',
        severity: 'info',
        status: 'PASS',
        page: page.url,
        detail: 'Page has Open Graph title and/or description.',
        expected: 'og:title or og:description',
        actual: [page.ogTitle, page.ogDescription].filter(Boolean).join(' / '),
      });
    }
    if (page.h1s.length === 1) {
      findings.push({
        id: nextId(),
        rule: 'heading-h1',
        severity: 'info',
        status: 'PASS',
        page: page.url,
        detail: 'Page has a single h1.',
        expected: 'one h1',
        actual: page.h1s[0],
      });
    }
    if (page.totalImages === 0) {
      findings.push({
        id: nextId(),
        rule: 'image-alt',
        severity: 'info',
        status: 'NOT_TESTED',
        page: page.url,
        detail: 'No images were recorded on this crawled page.',
        expected: 'img elements to inspect',
        actual: '0 images',
      });
    } else if (page.imagesWithoutAlt === 0) {
      findings.push({
        id: nextId(),
        rule: 'image-alt',
        severity: 'info',
        status: 'PASS',
        page: page.url,
        detail: `All ${page.totalImages} image(s) have alt text.`,
        expected: 'alt on every img',
        actual: `${page.totalImages} with alt`,
      });
    }
  }

  return findings;
}
