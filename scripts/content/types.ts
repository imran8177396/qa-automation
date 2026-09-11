export interface ContentFinding {
  status: 'PASS' | 'FAIL' | 'NOTE';
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
  pagesAnalyzed: number;
  bySeverity: Record<'high' | 'medium' | 'low' | 'info', number>;
  findings: ContentFinding[];
  disclaimer: string;
  limitations: string[];
}

export const CONTENT_DISCLAIMER =
  'Structural content QA from discovery snapshots — not factual verification of business claims unless expectedValues are configured.';

export const CONTENT_LIMITATIONS = [
  'Observed at crawl time only — dynamic content may differ at test time.',
  'Does not verify legal, pricing, or marketing accuracy without explicit expectedValues.',
];
