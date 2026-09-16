export interface AccessibilityPageDef {
  name: string;
  path: string;
}

export type AccessibilityFindingStatus = 'PASS' | 'FAIL' | 'NOTE' | 'NOT_APPLICABLE';

export type AccessibilityImpact = 'critical' | 'serious' | 'moderate' | 'minor' | 'info';

export interface AccessibilityFinding {
  status: AccessibilityFindingStatus;
  rule: string;
  impact: AccessibilityImpact;
  page: string;
  pagePath: string;
  actual: string;
  expected?: string;
  wcag?: string;
  selector?: string;
  helpUrl?: string;
  nodeCount?: string;
}

export interface AxeViolationRecord {
  id: string;
  impact?: string;
  help?: string;
  helpUrl?: string;
  tags: string[];
  nodes: Array<{ target: string[]; html: string }>;
  url?: string;
}

export interface AccessibilityAxePage {
  url: string;
  path: string;
  violations: AxeViolationRecord[];
  incomplete: AxeViolationRecord[];
}

export interface AccessibilitySummary {
  generatedAt: string;
  target?: string | null;
  passed: boolean;
  blocked?: boolean;
  reason?: string;
  resultsFile?: string;
  findingsFile?: string;
  testingMode?: string;
  pagesAnalyzed: number;
  violationCount: number;
  incompleteCount: number;
  byImpact: Record<AccessibilityImpact, number>;
  findings: AccessibilityFinding[];
  disclaimer: string;
  limitations: string[];
  applicableCount?: number;
  notApplicableCount?: number;
}

export const A11Y_TESTING_MODE =
  'QA-level automated accessibility (axe-core + Playwright keyboard/structure/label/zoom/touch checks on Chromium). This is not a complete manual WCAG audit and does not constitute WCAG 2.x conformance certification.';

export const A11Y_DISCLAIMER =
  'AUTOMATED ACCESSIBILITY TESTING is not a COMPLETE MANUAL ACCESSIBILITY AUDIT. These results do not constitute complete WCAG 2.x conformance or legal certification.';

export const A11Y_LIMITATIONS = [
  'axe-core and keyboard/structure checks only',
  'Not a substitute for manual assistive-technology testing',
  'Contrast is recorded only when axe-core can measure it',
  'Zoom checks use Chromium CSS zoom, not a real browser zoom UI or assistive technology',
  'Touch-target checks measure CSS bounding boxes in Chromium — not a real device',
  'Form error announcement is not exercised by submitting Login (generated a11y does not submit)',
  'These results do not constitute WCAG 2.x conformance certification',
];
