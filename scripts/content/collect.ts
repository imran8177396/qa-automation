import type { PageMap } from '../discovery/page-map';
import type { DiscoveryResult } from '../discovery/types';
import type { QaConfig } from '../types';
import { isAutoindexTitle } from '../security/autoindex';
import { defaultSeoProbe, fetchPageHtml, type PageHtmlSnapshot, type SeoProbe } from '../seo/http';
import { analyzeContentPage, analyzeDuplicateContent, analyzeExpectedValues, type ContentPageInput } from './analyze';
import { collectBrokenImageFindings, collectImageAltFindings } from './images';
import type { ContentFinding } from './types';

function isAnalyzable(page: { error?: string; status: number | null; title?: string; isAutoindex?: boolean }): boolean {
  if (page.error || page.status == null || page.status >= 400) return false;
  if (page.isAutoindex === true || isAutoindexTitle(page.title ?? '')) return false;
  return true;
}

export async function collectContentSuiteFindings(input: {
  pageMap: PageMap | null;
  discovery: DiscoveryResult | null;
  config: QaConfig;
  probe?: SeoProbe;
  htmlByUrl?: Map<string, PageHtmlSnapshot>;
}): Promise<{ findings: ContentFinding[]; pagesAnalyzed: number; target: string | null }> {
  const probe = input.probe ?? defaultSeoProbe;
  const target = input.pageMap?.seedUrl ?? input.discovery?.seedUrl ?? input.config.urls.website ?? null;
  const pages = input.pageMap?.pages.filter(isAnalyzable) ??
    input.discovery?.pages.filter(isAnalyzable) ??
    [];

  if (!target) {
    return {
      pagesAnalyzed: 0,
      target: null,
      findings: [
        {
          status: 'BLOCKED',
          rule: 'target',
          severity: 'medium',
          page: 'site-wide',
          detail: 'No website URL in page-map, discovery, or qa.config.json — content QA could not run.',
          expected: 'qa.config.json urls.website or discovery/page-map.json',
          actual: 'absent',
        },
      ],
    };
  }

  let origin: string;
  try {
    origin = new URL(target).origin;
  } catch {
    return {
      pagesAnalyzed: 0,
      target,
      findings: [
        {
          status: 'BLOCKED',
          rule: 'target',
          severity: 'medium',
          page: target,
          detail: 'Target URL could not be parsed.',
          expected: 'absolute URL',
          actual: target,
        },
      ],
    };
  }

  const urls = pages.map((page) => page.url);
  const htmlByUrl = input.htmlByUrl ?? (await fetchPageHtml(urls, probe));

  const pageInputs: ContentPageInput[] = pages.map((page) => {
    const snap = htmlByUrl.get(page.url);
    const headings =
      'headings' in page && page.headings
        ? page.headings
        : (page.h1s ?? []).map((text) => ({ level: 'h1' as const, text }));
    return {
      url: page.url,
      title: page.title ?? '',
      h1s: page.h1s ?? [],
      headings,
      parsed: snap && !snap.error ? snap.parsed : snap?.parsed ?? null,
      fetchError: snap?.error,
    };
  });

  const findings: ContentFinding[] = [];
  for (const page of pageInputs) {
    findings.push(...analyzeContentPage(page));
    const discoveryPage = input.discovery?.pages.find((row) => row.url === page.url);
    findings.push(
      ...collectImageAltFindings(page.url, page.parsed?.images ?? [], discoveryPage?.imagesWithoutAlt)
    );
    findings.push(
      ...(await collectBrokenImageFindings({
        pageUrl: page.url,
        origin,
        images: page.parsed?.images ?? [],
        probe,
      }))
    );
  }

  findings.push(...analyzeDuplicateContent(pageInputs));
  findings.push(...analyzeExpectedValues(pageInputs, input.config.content?.expectedValues ?? []));

  return { findings, pagesAnalyzed: pageInputs.length, target };
}
