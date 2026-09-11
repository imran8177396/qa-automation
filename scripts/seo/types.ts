export type SeoSeverity = 'high' | 'medium' | 'low';

export interface SeoFinding {
  id: string;
  rule: string;
  severity: SeoSeverity;
  /** The affected page URL, or 'site-wide' for a cross-page finding like a duplicate title. */
  page: string;
  detail: string;
  /** Suites that produced this finding after merge (e.g. suite, discovery). */
  sources?: string[];
}

export interface SeoAnalysisResult {
  analyzedAt: string;
  pagesAnalyzed: number;
  findings: SeoFinding[];
}

export interface SeoSuiteSummary {
  generatedAt: string;
  target: string | null;
  passed: boolean;
  failCount: number;
  pagesAnalyzed: number;
  rawFindingCount: number;
  uniqueFindingCount: number;
  findings: SeoFinding[];
  disclaimer?: string;
  limitations?: string[];
}

export const SEO_LIMITATIONS = [
  'Technical SEO from discovery evidence only — not a ranking audit.',
  'Meta tags and structure are observed at crawl time, not re-fetched unless tests run.',
];

export const SEO_DISCLAIMER = SEO_LIMITATIONS.join(' ');
