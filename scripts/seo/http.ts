import { parseHtml, type ParsedHtml } from '../lib/html-snapshot';
import { mapLimit } from '../lib/map-limit';
import { headerValue, safeGet, safeHead, type ProbeResult } from '../security/probe';

export const SEO_PROBE_USER_AGENT =
  'QA-Automation/1.0 (technical SEO QA; GET/HEAD only; not a ranking audit)';

export const SEO_PROBE_CONCURRENCY = 3;
export const SEO_MAX_LINK_PROBES = 40;
export const SEO_MAX_IMAGE_PROBES = 20;
export const SEO_MAX_PAGE_GETS = 10;
export const SEO_MAX_SITEMAPS = 3;

export interface SeoProbe {
  get: (url: string, options?: { redirect?: RequestRedirect; maxBodyBytes?: number }) => Promise<ProbeResult>;
  head: (url: string, options?: { redirect?: RequestRedirect }) => Promise<ProbeResult>;
}

export const defaultSeoProbe: SeoProbe = {
  get: (url, options) =>
    safeGet(url, {
      ...options,
      userAgent: SEO_PROBE_USER_AGENT,
    }),
  head: (url, options) =>
    safeHead(url, {
      ...options,
      userAgent: SEO_PROBE_USER_AGENT,
    }),
};

export function isRedirectStatus(status: number | null): boolean {
  return status != null && status >= 300 && status < 400;
}

export async function headOrGet(
  probe: SeoProbe,
  url: string,
  options?: { redirect?: RequestRedirect; maxBodyBytes?: number }
): Promise<ProbeResult> {
  const redirect = options?.redirect ?? 'manual';
  const head = await probe.head(url, { redirect });
  if (head.status === 405 || head.status === 501 || head.error) {
    return probe.get(url, { redirect, maxBodyBytes: options?.maxBodyBytes ?? 8 * 1024 });
  }
  return head;
}

export function locationOf(probe: ProbeResult): string {
  return headerValue(probe.headers, 'location') ?? probe.finalUrl;
}

export interface PageHtmlSnapshot {
  url: string;
  parsed: ParsedHtml;
  error?: string;
}

export async function fetchPageHtml(
  urls: string[],
  probe: SeoProbe
): Promise<Map<string, PageHtmlSnapshot>> {
  const limited = urls.slice(0, SEO_MAX_PAGE_GETS);
  const rows = await mapLimit(limited, SEO_PROBE_CONCURRENCY, async (url) => {
    const result = await probe.get(url, { redirect: 'follow', maxBodyBytes: 256 * 1024 });
    if (result.error || result.status == null) {
      return { url, parsed: parseHtml(''), error: result.error ?? 'no status' } satisfies PageHtmlSnapshot;
    }
    return { url, parsed: parseHtml(result.body) } satisfies PageHtmlSnapshot;
  });
  return new Map(rows.map((row) => [row.url, row]));
}
