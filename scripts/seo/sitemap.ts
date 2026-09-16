import { looksLikeHtmlDocument } from '../lib/html-snapshot';
import { headerValue, joinUrl, type ProbeResult } from '../security/probe';
import type { SeoFinding } from './types';

export function looksLikeSitemapXml(body: string, contentType = ''): boolean {
  if (looksLikeHtmlDocument(body, contentType)) return false;
  return /<urlset[\s>]|<sitemapindex[\s>]/i.test(body);
}

export function classifySitemapXml(input: {
  url: string;
  origin: string;
  probe: ProbeResult;
  nextId: () => string;
  source: 'well-known' | 'robots';
}): SeoFinding {
  const rule = input.source === 'robots' ? 'sitemap-from-robots' : 'sitemap-xml';
  if (input.probe.error || input.probe.status == null) {
    return {
      id: input.nextId(),
      rule,
      severity: 'medium',
      status: 'BLOCKED',
      page: input.url,
      detail: `sitemap could not be fetched: ${input.probe.error ?? 'no HTTP status'}`,
      expected: 'reachable GET of sitemap XML',
      actual: input.probe.error ?? 'no status',
    };
  }

  const contentType = headerValue(input.probe.headers, 'content-type') ?? '';
  if (input.probe.status === 404) {
    return {
      id: input.nextId(),
      rule,
      severity: 'medium',
      status: 'FAIL',
      page: input.url,
      detail: `${input.source === 'robots' ? 'Sitemap listed in robots.txt' : 'sitemap.xml'} returned 404.`,
      expected: '200 with urlset or sitemapindex XML',
      actual: '404',
    };
  }

  if (input.probe.status >= 300 && input.probe.status < 400) {
    const location = headerValue(input.probe.headers, 'location') ?? input.probe.finalUrl;
    return {
      id: input.nextId(),
      rule,
      severity: 'low',
      status: 'WARNING',
      page: input.url,
      detail: `sitemap returned ${input.probe.status} to ${location}. A preferred redirect destination was not judged.`,
      expected: '200 sitemap XML or a documented redirect',
      actual: `${input.probe.status} → ${location}`,
    };
  }

  if (input.probe.status >= 400) {
    return {
      id: input.nextId(),
      rule,
      severity: 'medium',
      status: 'FAIL',
      page: input.url,
      detail: `sitemap returned HTTP ${input.probe.status}.`,
      expected: '200 with urlset or sitemapindex XML',
      actual: String(input.probe.status),
    };
  }

  if (!looksLikeSitemapXml(input.probe.body, contentType)) {
    return {
      id: input.nextId(),
      rule,
      severity: 'medium',
      status: 'FAIL',
      page: input.url,
      detail:
        input.source === 'well-known'
          ? 'GET /sitemap.xml did not return sitemap XML (HTML or empty body). Common on SPA fallbacks.'
          : 'Sitemap URL from robots.txt did not return sitemap XML.',
      expected: '<urlset> or <sitemapindex>',
      actual: looksLikeHtmlDocument(input.probe.body, contentType)
        ? `HTTP ${input.probe.status} HTML`
        : `HTTP ${input.probe.status} non-sitemap body`,
    };
  }

  return {
    id: input.nextId(),
    rule,
    severity: 'info',
    status: 'PASS',
    page: input.url,
    detail: 'sitemap XML is present and looks like a urlset or sitemapindex.',
    expected: 'urlset or sitemapindex',
    actual: `HTTP ${input.probe.status}`,
  };
}

export function defaultSitemapUrl(origin: string): string {
  return joinUrl(origin, '/sitemap.xml');
}
