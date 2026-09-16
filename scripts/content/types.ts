export type ContentFindingStatus =
  | 'PASS'
  | 'FAIL'
  | 'WARNING'
  | 'NOTE'
  | 'NOT_TESTED'
  | 'BLOCKED'
  | 'NOT_APPLICABLE';

export interface ContentFinding {
  status: ContentFindingStatus;
  rule: string;
  severity: 'high' | 'medium' | 'low' | 'info';
  page: string;
  detail: string;
  expected?: string;
  actual?: string;
}

export interface ContentSummary {
  generatedAt: string;
  target: string | null;
  passed: boolean;
  failCount: number;
  passCount: number;
  noteCount: number;
  warningCount?: number;
  notTestedCount?: number;
  blockedCount?: number;
  pagesAnalyzed: number;
  bySeverity: Record<'high' | 'medium' | 'low' | 'info', number>;
  findings: ContentFinding[];
  disclaimer: string;
  limitations: string[];
}

export const CONTENT_DISCLAIMER =
  'Structural content QA from discovery snapshots and observational GET/HEAD — not factual verification of business claims unless expectedValues are configured.';

export const CONTENT_LIMITATIONS = [
  'Observed at crawl time plus one GET per crawled page — dynamic content may differ at test time.',
  'Does not verify legal, pricing, or marketing accuracy without explicit expectedValues.',
  'Placeholder detection uses common tokens (lorem ipsum, TODO, TBD, FIXME, xxx, placeholder copy) — not a business-copy oracle.',
  'Duplicate-content comparison requires two or more crawled pages.',
];
