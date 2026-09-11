import { NOT_AVAILABLE } from '../lib/suite-origin';

export const FAILURE_CLASSES = [
  'ASSERTION_FAILURE',
  'NAVIGATION_TIMEOUT',
  'ELEMENT_TIMEOUT',
  'NETWORK_ERROR',
  'CONSOLE_ERROR',
  'ENVIRONMENT',
  'FLAKY',
  'UNKNOWN',
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

export const FAILURE_CLASSIFICATION_RULES = [
  'TIMEOUT_NEAR_DURATION_NAVIGATION',
  'TIMEOUT_NEAR_DURATION_ELEMENT',
  'ERROR_TEXT_NAVIGATION_TIMEOUT',
  'ERROR_TEXT_ELEMENT_TIMEOUT',
  'ERROR_TEXT_NETWORK',
  'ERROR_TEXT_CONSOLE',
  'ERROR_TEXT_ENVIRONMENT',
  'MIXED_RETRY_OUTCOMES',
  'ERROR_TEXT_FLAKY',
  'ERROR_TEXT_ASSERTION',
  'INSUFFICIENT_EVIDENCE',
] as const;

export type FailureClassificationRule = (typeof FAILURE_CLASSIFICATION_RULES)[number];

export interface FailureEvidence {
  id: string;
  source: string;
  title: string;
  /** Playwright title + project identity used for retest grep. */
  testId: string;
  specFile: string;
  projectName: string;
  errorMessage: string;
  stackTrace: string;
  durationMs: number | typeof NOT_AVAILABLE;
  retryCount: number;
  attemptStatuses: string[];
  screenshotPath: string | null;
  screenshotPresent: boolean;
  tracePath: string | null;
  videoPath: string | null;
}

export interface ClassifiedFailure {
  id: string;
  testId: string;
  source: string;
  title: string;
  classification: FailureClass;
  ruleFired: FailureClassificationRule;
  evidenceExcerpt: string;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  evidence: FailureEvidence;
}

export interface FailureAnalysisFinding {
  id: string;
  testId: string;
  classification: FailureClass;
  ruleFired: FailureClassificationRule;
  evidenceExcerpt: string;
  confidence: ClassifiedFailure['confidence'];
  title: string;
  source: string;
  reason: string;
  recommendation: string;
}

export interface FailureAnalysisMetadata {
  evidenceBased: true;
  classificationsAreDefectTickets: false;
  note: string;
}

export const FAILURE_ANALYSIS_DISCLAIMER =
  'Classifications are evidence-based heuristics from captured error text and duration. They are not defect tickets. Never modify a test merely to make it pass.';

export const FAILURE_ANALYSIS_METADATA: FailureAnalysisMetadata = {
  evidenceBased: true,
  classificationsAreDefectTickets: false,
  note: FAILURE_ANALYSIS_DISCLAIMER,
};

export const FAILURE_ANALYSIS_LIMITATIONS = [
  'Classification uses captured error text and duration only — no live debugging and no invented defect tickets.',
  'A duration within 5% of a configured Playwright timeout is NAVIGATION_TIMEOUT or ELEMENT_TIMEOUT, not an assertion failure.',
  'Duration missing from Playwright JSON is recorded as NOT_AVAILABLE; the timeout-proximity rule does not fire and classification falls back to error text.',
  'Error text is taken from result.error and result.errors via scripts/lib/playwright-results.ts. Additional Playwright error fields are not invented.',
  'Original FAIL records are preserved even when retest passes.',
];

export function recommendationFor(classification: FailureClass): string {
  switch (classification) {
    case 'ASSERTION_FAILURE':
      return 'Review the assertion against observed application behavior; do not weaken the assertion to pass.';
    case 'NAVIGATION_TIMEOUT':
      return 'Investigate page-load or navigation slowness; retest may rerun this spec unchanged.';
    case 'ELEMENT_TIMEOUT':
      return 'Investigate missing or delayed UI; do not loosen locator timeouts to hide the failure.';
    case 'NETWORK_ERROR':
      return 'Verify target reachability, DNS, and firewall; rerun when the environment is stable.';
    case 'CONSOLE_ERROR':
      return 'Inspect page console or pageerror evidence; fix the application script error.';
    case 'ENVIRONMENT':
      return 'Repair CI/runtime (browsers, services, PATH); rerun the stage.';
    case 'FLAKY':
      return 'Re-run the unchanged spec via npm run retest; original FAIL stays on record.';
    default:
      return 'Review artifacts manually. Classification is UNKNOWN — not a defect ticket.';
  }
}

export function toAnalysisFinding(row: ClassifiedFailure): FailureAnalysisFinding {
  return {
    id: row.id,
    testId: row.testId,
    classification: row.classification,
    ruleFired: row.ruleFired,
    evidenceExcerpt: row.evidenceExcerpt,
    confidence: row.confidence,
    title: row.title,
    source: row.source,
    reason: row.rationale,
    recommendation: recommendationFor(row.classification),
  };
}

export interface FailureAnalysisSection216Row {
  testId: string;
  classification: FailureClass;
  evidenceExcerpt: string;
  ruleFired: FailureClassificationRule;
  title: string;
  source: string;
}

export interface FailureAnalysisSection216 {
  section: '2.16';
  title: 'Failure Analysis';
  metadata: FailureAnalysisMetadata;
  disclaimer: string;
  byClass: Record<FailureClass, number>;
  rows: FailureAnalysisSection216Row[];
}

export interface FailureAnalysisSummary {
  generatedAt: string;
  analyzed: number;
  totalFailures: number;
  byClass: Record<FailureClass, number>;
  failures: ClassifiedFailure[];
  findings: FailureAnalysisFinding[];
  metadata: FailureAnalysisMetadata;
  disclaimer: string;
  limitations: string[];
  section216: FailureAnalysisSection216;
}
