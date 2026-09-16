import { looksLikeHtmlDocument } from '../lib/html-snapshot';
import { headerValue, joinUrl, type ProbeResult } from '../security/probe';
import type { SeoFinding } from './types';

export function looksLikeRobotsTxt(body: string, contentType = ''): boolean {
  if (looksLikeHtmlDocument(body, contentType)) return false;
  return /^\s*(user-agent|disallow|allow|sitemap|crawl-delay|#)/im.test(body);
}

export function sitemapUrlsFromRobots(body: string): string[] {
  const urls: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
    if (match) urls.push(match[1].trim());
  }
  return urls;
}

export function classifyRobotsTxt(input: {
  origin: string;
  probe: ProbeResult;
  nextId: () => string;
}): SeoFinding {
  const url = joinUrl(input.origin, '/robots.txt');
  if (input.probe.error || input.probe.status == null) {
    return {
      id: input.nextId(),
      rule: 'robots-txt',
      severity: 'medium',
      status: 'BLOCKED',
      page: url,
      detail: `robots.txt could not be fetched: ${input.probe.error ?? 'no HTTP status'}`,
      expected: 'reachable GET /robots.txt',
      actual: input.probe.error ?? 'no status',
    };
  }

  const contentType = headerValue(input.probe.headers, 'content-type') ?? '';
  if (input.probe.status === 404) {
    return {
      id: input.nextId(),
      rule: 'robots-txt',
      severity: 'medium',
      status: 'FAIL',
      page: url,
      detail: 'robots.txt returned 404.',
      expected: '200 with a robots.txt body',
      actual: '404',
    };
  }

  if (input.probe.status >= 300 && input.probe.status < 400) {
    const location = headerValue(input.probe.headers, 'location') ?? input.probe.finalUrl;
    return {
      id: input.nextId(),
      rule: 'robots-txt',
      severity: 'low',
      status: 'WARNING',
      page: url,
      detail: `robots.txt returned ${input.probe.status} to ${location}. A preferred redirect destination was not judged.`,
      expected: '200 robots.txt or a documented redirect',
      actual: `${input.probe.status} → ${location}`,
    };
  }

  if (input.probe.status >= 400) {
    return {
      id: input.nextId(),
      rule: 'robots-txt',
      severity: 'medium',
      status: 'FAIL',
      page: url,
      detail: `robots.txt returned HTTP ${input.probe.status}.`,
      expected: '200 with a robots.txt body',
      actual: String(input.probe.status),
    };
  }

  if (!looksLikeRobotsTxt(input.probe.body, contentType)) {
    return {
      id: input.nextId(),
      rule: 'robots-txt',
      severity: 'medium',
      status: 'FAIL',
      page: url,
      detail: 'GET /robots.txt did not return a robots.txt document (HTML or empty body). Common on SPA fallbacks.',
      expected: 'User-agent / Disallow / Allow / Sitemap directives',
      actual: looksLikeHtmlDocument(input.probe.body, contentType)
        ? `HTTP ${input.probe.status} HTML`
        : `HTTP ${input.probe.status} non-robots body`,
    };
  }

  return {
    id: input.nextId(),
    rule: 'robots-txt',
    severity: 'info',
    status: 'PASS',
    page: url,
    detail: 'robots.txt is present and looks like a robots file.',
    expected: 'robots.txt directives',
    actual: `HTTP ${input.probe.status}`,
  };
}
