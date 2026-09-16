import type { PageMap } from '../discovery/page-map';
import type { DiscoveredPage } from '../discovery/types';
import { resolveHref, sameOrigin } from '../lib/html-snapshot';
import { mapLimit } from '../lib/map-limit';
import { pagePathOf, type ProbeResult } from '../security/probe';
import type { SeoFinding } from './types';
import { headOrGet, isRedirectStatus, locationOf, SEO_MAX_LINK_PROBES, SEO_PROBE_CONCURRENCY, type SeoProbe } from './http';

export interface ExpectedRedirect {
  from: string;
  to?: string;
  status?: number;
}

export function collectDiscoveredLinkUrls(input: {
  origin: string;
  pages: DiscoveredPage[];
  pageMap: PageMap | null;
  htmlHrefs?: string[];
}): string[] {
  const seen = new Set<string>();
  const add = (raw: string, base: string): void => {
    const resolved = resolveHref(base, raw);
    if (!resolved || !sameOrigin(resolved, input.origin)) return;
    try {
      const url = new URL(resolved);
      url.hash = '';
      seen.add(url.href);
    } catch {
      /* skip */
    }
  };

  for (const page of input.pages) {
    for (const link of page.outboundLinks ?? []) {
      add(link.href, page.url);
    }
  }
  if (input.pageMap) {
    for (const href of input.pageMap.pages.flatMap((page) => page.internalLinks ?? [])) {
      add(href, input.pageMap.seedUrl);
    }
    for (const nav of input.pageMap.navigation) {
      if (!nav.inScope) continue;
      add(nav.to, input.pageMap.seedUrl);
    }
  }
  for (const href of input.htmlHrefs ?? []) {
    add(href, input.origin);
  }

  return [...seen].slice(0, SEO_MAX_LINK_PROBES);
}

export function classifyProbedUrl(status: number | null, error?: string): 'ok' | 'redirect' | 'not-found' | 'error' {
  if (error || status == null) return 'error';
  if (isRedirectStatus(status)) return 'redirect';
  if (status === 404) return 'not-found';
  if (status >= 400) return 'error';
  return 'ok';
}

function pathKey(url: string): string {
  try {
    return pagePathOf(url);
  } catch {
    return url;
  }
}

export async function collectLinkFindings(input: {
  origin: string;
  pages: DiscoveredPage[];
  pageMap: PageMap | null;
  htmlHrefs: string[];
  missingPath?: string;
  expectedRedirects?: ExpectedRedirect[];
  probe: SeoProbe;
  nextId: () => string;
}): Promise<SeoFinding[]> {
  const findings: SeoFinding[] = [];
  const urls = collectDiscoveredLinkUrls({
    origin: input.origin,
    pages: input.pages,
    pageMap: input.pageMap,
    htmlHrefs: input.htmlHrefs,
  });

  const crawled = new Set(input.pages.map((page) => page.url));
  const toProbe = urls.filter((url) => !crawled.has(url));

  if (toProbe.length === 0) {
    findings.push({
      id: input.nextId(),
      rule: 'broken-link',
      severity: 'info',
      status: 'NOT_TESTED',
      page: input.origin,
      detail: 'No additional same-origin hrefs were discovered beyond crawled pages. Extra routes were not invented.',
      expected: 'discovered same-origin hrefs to GET/HEAD',
      actual: `${urls.length} discovered URL(s), ${crawled.size} crawled`,
    });
  } else {
    const probes = await mapLimit(toProbe, SEO_PROBE_CONCURRENCY, async (url) => ({
      url,
      result: await headOrGet(input.probe, url, { redirect: 'manual' }),
    }));

    const broken: Array<{ url: string; result: ProbeResult; kind: string }> = [];
    const redirects: Array<{ url: string; result: ProbeResult }> = [];
    let okCount = 0;
    for (const row of probes) {
      const kind = classifyProbedUrl(row.result.status, row.result.error);
      if (kind === 'ok') okCount += 1;
      else if (kind === 'redirect') redirects.push(row);
      else broken.push({ ...row, kind });
    }

    if (broken.length === 0) {
      findings.push({
        id: input.nextId(),
        rule: 'broken-link',
        severity: 'info',
        status: 'PASS',
        page: input.origin,
        detail: `${okCount} discovered same-origin link(s) returned 2xx; ${redirects.length} redirect(s) recorded separately.`,
        expected: '2xx or recorded redirect',
        actual: `${okCount} 2xx, ${redirects.length} 3xx`,
      });
    } else {
      for (const row of broken) {
        findings.push({
          id: input.nextId(),
          rule: row.result.status === 404 ? 'broken-link-404' : 'broken-link',
          severity: 'high',
          status: 'FAIL',
          page: row.url,
          detail: `${row.url} returned ${row.result.status ?? row.result.error ?? 'error'}`,
          expected: '2xx or documented redirect',
          actual: row.result.status != null ? String(row.result.status) : (row.result.error ?? 'error'),
        });
      }
    }

    for (const row of redirects) {
      findings.push({
        id: input.nextId(),
        rule: 'redirect',
        severity: 'info',
        status: 'NOTE',
        page: row.url,
        detail: `Discovered URL redirected ${row.result.status} → ${locationOf(row.result)}. Destination correctness was not judged.`,
        expected: 'record redirect status',
        actual: `${row.result.status} → ${locationOf(row.result)}`,
      });
    }
  }

  const observedRedirects = input.pages.flatMap((page) =>
    (page.redirects ?? []).map((hop) => ({ page: page.url, hop }))
  );
  const expected = input.expectedRedirects ?? [];
  if (expected.length === 0 && observedRedirects.length === 0 && toProbe.length === 0) {
    findings.push({
      id: input.nextId(),
      rule: 'redirect',
      severity: 'info',
      status: 'NOT_TESTED',
      page: input.origin,
      detail:
        'No redirects were observed on crawled pages and seo.expectedRedirects is not configured. A preferred redirect policy was not invented.',
      expected: 'observed hops or configured expectedRedirects',
      actual: 'none',
    });
  } else if (expected.length > 0) {
    for (const rule of expected) {
      const fromUrl = resolveHref(input.origin, rule.from) ?? rule.from;
      const result = await headOrGet(input.probe, fromUrl, { redirect: 'manual' });
      const actualTo = locationOf(result);
      const statusOk = rule.status == null || result.status === rule.status;
      const destOk = !rule.to || pathKey(actualTo) === pathKey(resolveHref(input.origin, rule.to) ?? rule.to);
      const pass = isRedirectStatus(result.status) && statusOk && destOk;
      findings.push({
        id: input.nextId(),
        rule: 'expected-redirect',
        severity: pass ? 'info' : 'medium',
        status: pass ? 'PASS' : 'FAIL',
        page: fromUrl,
        detail: pass
          ? `Configured redirect ${rule.from} → ${rule.to ?? actualTo} observed.`
          : `Configured redirect ${rule.from} did not match (status ${result.status}, location ${actualTo}).`,
        expected: `${rule.status ?? '3xx'}${rule.to ? ` → ${rule.to}` : ''}`,
        actual: `${result.status ?? result.error} → ${actualTo}`,
      });
    }
  } else if (observedRedirects.length > 0) {
    for (const row of observedRedirects) {
      findings.push({
        id: input.nextId(),
        rule: 'redirect',
        severity: 'info',
        status: 'NOTE',
        page: row.page,
        detail: `Discovery recorded ${row.hop.status ?? 'redirect'} ${row.hop.from} → ${row.hop.to}. Destination correctness was not judged.`,
        expected: 'record observed hop',
        actual: `${row.hop.status ?? 'n/a'} ${row.hop.from} → ${row.hop.to}`,
      });
    }
  }

  if (!input.missingPath?.trim()) {
    const observed404 = findings.some((row) => row.rule === 'broken-link-404');
    findings.push({
      id: input.nextId(),
      rule: 'missing-path-404',
      severity: 'info',
      status: observed404 ? 'NOTE' : 'NOT_TESTED',
      page: input.origin,
      detail: observed404
        ? 'A 404 was observed on a discovered same-origin URL. seo.missingPath was not configured; a synthetic 404 path was not invented.'
        : 'seo.missingPath is not configured — a synthetic 404 URL was not invented.',
      expected: 'seo.missingPath or an observed 404',
      actual: observed404 ? 'observed 404 on a discovered URL' : 'not configured',
    });
  } else {
    const url = resolveHref(input.origin, input.missingPath) ?? input.missingPath;
    if (!sameOrigin(url, input.origin)) {
      findings.push({
        id: input.nextId(),
        rule: 'missing-path-404',
        severity: 'info',
        status: 'BLOCKED',
        page: url,
        detail: 'seo.missingPath is not on the configured origin and was not requested.',
        expected: 'same-origin missingPath',
        actual: url,
      });
    } else {
      const result = await headOrGet(input.probe, url, { redirect: 'manual' });
      const kind = classifyProbedUrl(result.status, result.error);
      findings.push({
        id: input.nextId(),
        rule: 'missing-path-404',
        severity: kind === 'not-found' ? 'info' : 'medium',
        status: kind === 'not-found' ? 'PASS' : kind === 'error' && result.error ? 'BLOCKED' : 'FAIL',
        page: url,
        detail:
          kind === 'not-found'
            ? 'Configured missingPath returned 404.'
            : `Configured missingPath returned ${result.status ?? result.error ?? 'unknown'} (expected 404).`,
        expected: '404',
        actual: result.status != null ? String(result.status) : (result.error ?? 'unknown'),
      });
    }
  }

  return findings;
}
