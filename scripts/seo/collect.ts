import type { PageMap } from '../discovery/page-map';
import type { DiscoveryResult } from '../discovery/types';
import type { QaConfig } from '../types';
import { resolveHref, sameOrigin } from '../lib/html-snapshot';
import { joinUrl } from '../security/probe';
import { analyzeSeo, isSeoSkippedPage } from './analyze-seo';
import { nextIdAfter } from './ids';
import { collectPagePresenceFindings } from './page-presence';
import { classifyRobotsTxt, sitemapUrlsFromRobots } from './robots';
import { classifySitemapXml, defaultSitemapUrl } from './sitemap';
import { collectUrlConsistencyFindings } from './url-consistency';
import { collectLinkFindings } from './links';
import {
  defaultSeoProbe,
  fetchPageHtml,
  SEO_MAX_SITEMAPS,
  type PageHtmlSnapshot,
  type SeoProbe,
} from './http';
import type { SeoFinding } from './types';

export type { PageHtmlSnapshot };
export { fetchPageHtml };

export async function collectSeoSuiteFindings(input: {
  discovery: DiscoveryResult;
  pageMap: PageMap | null;
  config: QaConfig;
  probe?: SeoProbe;
  htmlByUrl?: Map<string, PageHtmlSnapshot>;
}): Promise<SeoFinding[]> {
  const probe = input.probe ?? defaultSeoProbe;
  const loadedUrls = input.discovery.pages
    .filter((page) => !page.error && page.status !== null && page.status < 400 && !isSeoSkippedPage(page))
    .map((page) => page.url);
  const htmlByUrl = input.htmlByUrl ?? (await fetchPageHtml(loadedUrls, probe));

  const findings: SeoFinding[] = [...analyzeSeo(input.discovery)];
  const nextId = nextIdAfter(findings);
  findings.push(...collectPagePresenceFindings(input.discovery.pages, nextId));
  findings.push(...collectUrlConsistencyFindings(input.discovery.pages, nextId));

  let origin: string;
  try {
    origin = new URL(input.discovery.seedUrl).origin;
  } catch {
    findings.push({
      id: nextId(),
      rule: 'origin',
      severity: 'medium',
      status: 'BLOCKED',
      page: input.discovery.seedUrl,
      detail: 'Seed URL could not be parsed — origin probes were not sent.',
      expected: 'absolute seed URL',
      actual: input.discovery.seedUrl,
    });
    return findings;
  }

  const robotsUrl = joinUrl(origin, '/robots.txt');
  const robotsProbe = await probe.get(robotsUrl, { redirect: 'manual', maxBodyBytes: 64 * 1024 });
  const robotsFinding = classifyRobotsTxt({ origin, probe: robotsProbe, nextId });
  findings.push(robotsFinding);

  const sitemapTargets: Array<{ url: string; source: 'well-known' | 'robots' }> = [
    { url: defaultSitemapUrl(origin), source: 'well-known' },
  ];
  if (robotsFinding.status === 'PASS') {
    for (const listed of sitemapUrlsFromRobots(robotsProbe.body)) {
      const resolved = resolveHref(origin, listed);
      if (!resolved || !sameOrigin(resolved, origin)) continue;
      if (sitemapTargets.some((row) => row.url === resolved)) continue;
      sitemapTargets.push({ url: resolved, source: 'robots' });
    }
  }
  for (const target of sitemapTargets.slice(0, SEO_MAX_SITEMAPS)) {
    const sitemapProbe = await probe.get(target.url, { redirect: 'manual', maxBodyBytes: 128 * 1024 });
    findings.push(classifySitemapXml({ url: target.url, origin, probe: sitemapProbe, nextId, source: target.source }));
  }

  const htmlHrefs = [...htmlByUrl.values()].flatMap((row) =>
    row.parsed.links.map((link) => resolveHref(row.url, link.href)).filter((href): href is string => Boolean(href))
  );

  findings.push(
    ...(await collectLinkFindings({
      origin,
      pages: input.discovery.pages,
      pageMap: input.pageMap,
      htmlHrefs,
      missingPath: input.config.seo?.missingPath,
      expectedRedirects: input.config.seo?.expectedRedirects,
      probe,
      nextId,
    }))
  );

  return findings;
}
