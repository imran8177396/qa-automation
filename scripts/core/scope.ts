import type { DiscoveryConfig } from '../types';
import { matchesExcludePattern } from '../lib/url-normalize';

export { normalizeUrl, matchesExcludePattern } from '../lib/url-normalize';

export interface DiscoveryConfigResolved {
  enabled: boolean;
  maxPages: number;
  maxDepth: number;
  sameOriginOnly: boolean;
  additionalHosts: string[];
  respectRobotsTxt: boolean;
  useSitemap: boolean;
  concurrency: number;
  excludePatterns: string[];
}

const DEFAULTS: DiscoveryConfigResolved = {
  enabled: true,
  maxPages: 50,
  maxDepth: 3,
  sameOriginOnly: true,
  additionalHosts: [],
  respectRobotsTxt: true,
  useSitemap: true,
  concurrency: 4,
  excludePatterns: [],
};

export function resolveDiscoveryConfig(input?: DiscoveryConfig & { maxPages?: number }): DiscoveryConfigResolved {
  return {
    enabled: input?.enabled ?? DEFAULTS.enabled,
    maxPages: input?.maxPages ?? DEFAULTS.maxPages,
    maxDepth: input?.maxDepth ?? DEFAULTS.maxDepth,
    sameOriginOnly: input?.sameOriginOnly ?? DEFAULTS.sameOriginOnly,
    additionalHosts: input?.additionalHosts ?? DEFAULTS.additionalHosts,
    respectRobotsTxt: input?.respectRobotsTxt ?? DEFAULTS.respectRobotsTxt,
    useSitemap: input?.useSitemap ?? DEFAULTS.useSitemap,
    concurrency: input?.concurrency ?? DEFAULTS.concurrency,
    excludePatterns: input?.excludePatterns ?? DEFAULTS.excludePatterns,
  };
}

export function isExcludedUrl(url: string, excludePatterns: string[]): boolean {
  return matchesExcludePattern(url, excludePatterns);
}

export interface ScopeAnchor {
  host: string;
  additionalHosts: Set<string>;
}

export function resolveScopeAnchor(seedUrl: string, additionalHosts: string[] = []): ScopeAnchor {
  const url = new URL(seedUrl);
  return {
    host: url.host,
    additionalHosts: new Set(additionalHosts.map((host) => host.toLowerCase())),
  };
}

/**
 * Strict host match by default (never an unbounded internet crawl). With sameOriginOnly=false,
 * subdomains of the anchor host are also in scope. Deliberately does NOT use a Public Suffix List /
 * eTLD+1 comparison — that would risk wandering into unrelated sites that merely share a registrable
 * domain suffix.
 */
export function isInScope(candidateUrl: string, anchor: ScopeAnchor, sameOriginOnly: boolean): boolean {
  let url: URL;
  try {
    url = new URL(candidateUrl);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  const host = url.host.toLowerCase();
  const anchorHost = anchor.host.toLowerCase();

  if (host === anchorHost) return true;
  if (anchor.additionalHosts.has(host)) return true;
  if (!sameOriginOnly && host.endsWith(`.${anchorHost}`)) return true;

  return false;
}

/** Simple bounded-concurrency promise pool — each worker pulls the next index synchronously. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
