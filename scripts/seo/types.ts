export type SeoSeverity = 'high' | 'medium' | 'low' | 'info';

export type SeoFindingStatus =
  | 'PASS'
  | 'FAIL'
  | 'WARNING'
  | 'NOTE'
  | 'NOT_TESTED'
  | 'BLOCKED'
  | 'NOT_APPLICABLE';

export interface SeoFinding {
  id: string;
  rule: string;
  severity: SeoSeverity;
  /** The affected page URL, or 'site-wide' / origin for a cross-page finding. */
  page: string;
  detail: string;
  /** Suites that produced this finding after merge (e.g. suite, discovery). */
  sources?: string[];
  status?: SeoFindingStatus;
  expected?: string;
  actual?: string;
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
  passCount?: number;
  warningCount?: number;
  noteCount?: number;
  notTestedCount?: number;
  blockedCount?: number;
  pagesAnalyzed: number;
  rawFindingCount: number;
  uniqueFindingCount: number;
  bySeverity?: Record<'high' | 'medium' | 'low' | 'info', number>;
  findings: SeoFinding[];
  disclaimer?: string;
  limitations?: string[];
}

export const SEO_LIMITATIONS = [
  'Technical SEO from discovery evidence plus observational GET/HEAD of robots.txt, sitemap.xml, and discovered same-origin links — not a ranking, crawl-budget, or content-strategy audit.',
  'A preferred trailing-slash, www, or scheme policy is not invented.',
  'A 404 URL is not invented unless seo.missingPath is configured.',
  'Redirect destinations are not judged correct unless seo.expectedRedirects names them.',
  'Meta tags and structure are observed at crawl time and on a single GET of each crawled page.',
];

export const SEO_DISCLAIMER = SEO_LIMITATIONS[0];
