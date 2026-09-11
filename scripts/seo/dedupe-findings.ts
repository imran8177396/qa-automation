import { normalizeFindingUrl } from '../lib/normalize-finding-url';
import type { SeoFinding } from './types';

export const SEO_FINDING_SOURCE_SUITE = 'suite';
export const SEO_FINDING_SOURCE_DISCOVERY = 'discovery';

export interface DedupedSeoFinding extends SeoFinding {
  sources: string[];
}

export interface DedupedSeoFindings {
  findings: DedupedSeoFinding[];
  rawFindingCount: number;
  uniqueFindingCount: number;
}

/** Dedupe key: (rule, severity, normalizedUrl, detail). */
export function seoFindingDedupeKey(finding: Pick<SeoFinding, 'rule' | 'severity' | 'page' | 'detail'>): string {
  return JSON.stringify({
    rule: finding.rule,
    severity: finding.severity,
    normalizedUrl: normalizeFindingUrl(finding.page),
    detail: finding.detail,
  });
}

function withSource(finding: SeoFinding, source: string): DedupedSeoFinding {
  const sources = [...(finding.sources ?? [])];
  if (source && !sources.includes(source)) sources.push(source);
  return { ...finding, sources };
}

export function dedupeSeoFindings(findings: SeoFinding[]): DedupedSeoFindings {
  const merged = new Map<string, DedupedSeoFinding>();

  for (const finding of findings) {
    const key = seoFindingDedupeKey(finding);
    const incoming: DedupedSeoFinding = {
      ...finding,
      sources: [...(finding.sources ?? [])],
    };
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, incoming);
      continue;
    }
    for (const source of incoming.sources) {
      if (source && !existing.sources.includes(source)) existing.sources.push(source);
    }
  }

  const unique = [...merged.values()];
  return {
    findings: unique,
    rawFindingCount: findings.length,
    uniqueFindingCount: unique.length,
  };
}

/**
 * Tag suite + discovery findings, then dedupe before any count or render.
 * First-seen finding data is kept; sources[] records both suites.
 */
export function collectSeoFindings(suiteFindings: SeoFinding[], discoveryFindings: SeoFinding[]): DedupedSeoFindings {
  const tagged: SeoFinding[] = [
    ...suiteFindings.map((row) => withSource(row, SEO_FINDING_SOURCE_SUITE)),
    ...discoveryFindings.map((row) => withSource(row, SEO_FINDING_SOURCE_DISCOVERY)),
  ];
  return dedupeSeoFindings(tagged);
}
