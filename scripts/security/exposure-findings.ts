import { normalizeCrawlUrl } from '../lib/url-normalize';
import { isAutoindexPage, isAutoindexTitle } from './autoindex';
import type { SecurityFinding } from './types';

export interface ExposureScanPage {
  url: string;
  title?: string;
  isAutoindex?: boolean;
  outboundLinks?: Array<{ href: string; text: string }>;
  status?: number | null;
  error?: string;
}

function pagePath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  } catch {
    return url;
  }
}

function normalizeKey(url: string): string {
  try {
    return normalizeCrawlUrl(url);
  } catch {
    return url;
  }
}

export function isBuildArtifactUrl(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const segments = pathname.split('/').filter(Boolean);
  const file = segments[segments.length - 1] ?? '';
  if (segments.some((segment) => segment.toLowerCase().startsWith('__next'))) return true;
  if (/\.map$/i.test(file)) return true;
  if (/\.txt$/i.test(file) && /manifest/i.test(file)) return true;
  return false;
}

function isReachable(page: ExposureScanPage): boolean {
  return !page.error && (page.status == null || page.status < 400);
}

function asFinding(
  input: Omit<SecurityFinding, 'status'> & { status?: SecurityFinding['status'] }
): SecurityFinding {
  return {
    status: input.status ?? 'FAIL',
    rule: input.rule,
    severity: input.severity,
    detail: input.detail,
    page: input.page,
    pagePath: input.pagePath,
    expected: input.expected,
    actual: input.actual,
  };
}

/**
 * Observational exposure rules only: directory listings already crawled, and
 * reachable `__next*` / source-map / `.txt` build-manifest URLs. Does not probe
 * extra paths.
 */
export function collectExposureFindings(input: { pages: ExposureScanPage[] }): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const seenListing = new Set<string>();
  const seenArtifact = new Set<string>();

  if (input.pages.length === 0) {
    return [
      asFinding({
        status: 'NOT_TESTED',
        rule: 'directory-listing-enabled',
        severity: 'info',
        detail: 'No discovery pages were available — directory listing was not invented',
        expected: 'Directory listing disabled',
        actual: 'no discovery pages',
      }),
      asFinding({
        status: 'NOT_TESTED',
        rule: 'build-artifact-exposed',
        severity: 'info',
        detail: 'No discovery pages were available — build-artifact URLs were not invented',
        expected: 'Build artifacts not publicly reachable',
        actual: 'no discovery pages',
      }),
    ];
  }

  for (const page of input.pages) {
    if (!isReachable(page)) continue;

    const autoindex = page.isAutoindex === true || isAutoindexPage({ title: page.title ?? '' });
    if (autoindex) {
      const key = normalizeKey(page.url);
      if (!seenListing.has(key)) {
        seenListing.add(key);
        const exposed = pagePath(page.url);
        findings.push(
          asFinding({
            rule: 'directory-listing-enabled',
            severity: 'high',
            detail: `Directory listing is enabled for path ${exposed}`,
            page: page.url,
            pagePath: exposed,
            expected: 'Directory listing disabled',
            actual: page.title && isAutoindexTitle(page.title) ? page.title : 'Apache-style listing',
          })
        );
      }
    }

    const candidates = [page.url, ...(page.outboundLinks ?? []).map((link) => link.href)];
    for (const candidate of candidates) {
      if (!isBuildArtifactUrl(candidate)) continue;
      const key = normalizeKey(candidate);
      if (seenArtifact.has(key)) continue;
      seenArtifact.add(key);
      const exposed = pagePath(candidate);
      findings.push(
        asFinding({
          rule: 'build-artifact-exposed',
          severity: 'high',
          detail: `Build artifact is reachable at ${exposed}`,
          page: candidate,
          pagePath: exposed,
          expected: 'Build artifacts not publicly reachable',
          actual: exposed,
        })
      );
    }
  }

  if (seenListing.size === 0) {
    findings.push(
      asFinding({
        status: 'PASS',
        rule: 'directory-listing-enabled',
        severity: 'info',
        detail: 'No Apache-style directory listing was present in discovery evidence',
        expected: 'Directory listing disabled',
        actual: 'no autoindex pages observed',
      })
    );
  }
  if (seenArtifact.size === 0) {
    findings.push(
      asFinding({
        status: 'PASS',
        rule: 'build-artifact-exposed',
        severity: 'info',
        detail: 'No reachable __next / source-map / build-manifest URLs were present in discovery evidence',
        expected: 'Build artifacts not publicly reachable',
        actual: 'none observed',
      })
    );
  }

  return findings;
}
