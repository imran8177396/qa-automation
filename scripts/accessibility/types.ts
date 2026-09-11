export interface AccessibilityPageDef {
  name: string;
  path: string;
}

export interface AccessibilityFinding {
  status: 'PASS' | 'FAIL' | 'NOTE';
  rule: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | 'info';
  page: string;
  pagePath: string;
  actual: string;
}

export interface AccessibilitySummary {
  generatedAt: string;
  target?: string | null;
  passed: boolean;
  blocked?: boolean;
  reason?: string;
  resultsFile?: string;
  pagesAnalyzed: number;
  violationCount: number;
  incompleteCount: number;
  byImpact: Record<'critical' | 'serious' | 'moderate' | 'minor' | 'info', number>;
  findings: AccessibilityFinding[];
  disclaimer: string;
  limitations: string[];
}

export const A11Y_DISCLAIMER =
  'AUTOMATED ACCESSIBILITY TESTING is not a COMPLETE MANUAL ACCESSIBILITY AUDIT. These results do not constitute complete WCAG 2.x conformance or legal certification.';

export const A11Y_LIMITATIONS = [
  'axe-core and keyboard/structure checks only',
  'Not a substitute for manual assistive-technology testing',
];
