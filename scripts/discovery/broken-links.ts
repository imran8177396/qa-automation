import type { DiscoveredPage } from './types';

export interface BrokenLinkFinding {
  url: string;
  status: number | null;
  kind: '4xx' | '5xx' | 'error';
  detail: string;
}

/**
 * True redirect-loop detection would need full redirect-chain tracking; Playwright's own navigation
 * already fails/times out on a genuine infinite redirect loop, which surfaces here as kind: 'error'.
 */
export function findBrokenLinks(pages: DiscoveredPage[]): BrokenLinkFinding[] {
  const findings: BrokenLinkFinding[] = [];

  for (const page of pages) {
    if (page.error) {
      findings.push({ url: page.url, status: page.status, kind: 'error', detail: page.error });
      continue;
    }
    if (page.status === null) continue;
    if (page.status >= 500) {
      findings.push({ url: page.url, status: page.status, kind: '5xx', detail: `Server error ${page.status}` });
    } else if (page.status >= 400) {
      findings.push({ url: page.url, status: page.status, kind: '4xx', detail: `Client error ${page.status}` });
    }
  }

  return findings;
}
