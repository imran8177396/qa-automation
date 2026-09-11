/**
 * URL helpers for SEO dedupe (simple) and crawl frontier dedupe (full).
 *
 * `normalizeFindingUrl` keeps the P0-1 contract: lowercase the whole string and
 * strip a trailing slash. SEO imports that behavior.
 *
 * `normalizeCrawlUrl` / `normalizeUrl` add host-only lowercasing, query sorting,
 * and drop of tracking / sort / pagination params — including Apache autoindex
 * `C` and `O` pairs that use `;` or `&` as separators (`?C=N;O=D`).
 */

const TRACKING_PARAM_PREFIXES = ['utm_', 'fbclid', 'gclid', 'mc_eid', 'mc_cid', 'igshid'];

/** Sort, pagination, and Apache autoindex column/order params (matched case-insensitively). */
const DROP_QUERY_PARAMS = new Set([
  'c',
  'o',
  'page',
  'p',
  'pg',
  'pagenum',
  'pageno',
  'page_num',
  'offset',
  'start',
  'from',
  'limit',
  'count',
  'size',
  'per_page',
  'perpage',
  'pagesize',
  'page_size',
  'sort',
  'sortby',
  'sort_by',
  'order',
  'orderby',
  'order_by',
  'dir',
  'direction',
]);

function decodeQueryPart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** Split on both `&` and Apache autoindex `;`. */
export function parseQueryPairs(search: string): Array<[string, string]> {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return [];

  const pairs: Array<[string, string]> = [];
  for (const part of raw.split(/[;&]/)) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) {
      pairs.push([decodeQueryPart(part), '']);
      continue;
    }
    pairs.push([decodeQueryPart(part.slice(0, eq)), decodeQueryPart(part.slice(eq + 1))]);
  }
  return pairs;
}

export function shouldDropQueryParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (DROP_QUERY_PARAMS.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(prefix));
}

function stripTrailingSlashes(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '');
  }
  return pathname === '' ? '/' : pathname;
}

/**
 * Simple finding-URL normalizer for SEO dedupe keys: lowercase everything and
 * strip trailing slashes. Relative paths such as `/` are preserved.
 */
export function normalizeFindingUrl(url: string): string {
  let normalized = url.toLowerCase();
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.replace(/\/+$/, '');
  }
  return normalized;
}

/**
 * Full crawl / coverage normalizer. Throws if `rawUrl` is not an absolute URL
 * (same contract as the previous `scripts/core/scope.normalizeUrl`).
 */
export function normalizeCrawlUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }

  url.pathname = stripTrailingSlashes(url.pathname);

  const kept = parseQueryPairs(url.search).filter(([key]) => !shouldDropQueryParam(key));
  kept.sort((a, b) => {
    const keyCmp = a[0].localeCompare(b[0]);
    return keyCmp !== 0 ? keyCmp : a[1].localeCompare(b[1]);
  });

  url.search = '';
  for (const [key, value] of kept) {
    url.searchParams.append(key, value);
  }

  return url.toString();
}

/** Alias used by the crawler and existing `scope` imports. */
export function normalizeUrl(rawUrl: string): string {
  return normalizeCrawlUrl(rawUrl);
}

export function matchesExcludePattern(url: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;

  let pathname = url;
  let pathAndSearch = url;
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    pathAndSearch = `${parsed.pathname}${parsed.search}`;
  } catch {
    /* match against the raw string only */
  }

  const haystacks = [url, pathname, pathAndSearch];
  return patterns.some((pattern) => {
    const trimmed = pattern.trim();
    if (!trimmed) return false;
    try {
      const re = compileExcludePattern(trimmed);
      return haystacks.some((value) => re.test(value));
    } catch {
      return haystacks.some((value) => value.includes(trimmed));
    }
  });
}

function compileExcludePattern(pattern: string): RegExp {
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    return new RegExp(pattern.slice(1, -1), 'i');
  }
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLESTAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLESTAR::/g, '.*');
  return new RegExp(escaped, 'i');
}
