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

/** Owner-level classes from reporting.mdc / Part 15. Mechanism classes stay on `classification`. */
export const OWNER_FAILURE_CLASSES = [
  'APPLICATION',
  'AUTOMATION',
  'ENVIRONMENT',
  'TEST_DATA',
  'CONFIGURATION',
  'NETWORK',
  'BROWSER',
  'DEPENDENCY',
  'UNKNOWN',
] as const;

export type OwnerFailureClass = (typeof OWNER_FAILURE_CLASSES)[number];

export const FAILURE_ANALYSIS_OUTCOMES = ['ANALYZED', 'NOTHING_TO_ANALYZE'] as const;
export type FailureAnalysisOutcome = (typeof FAILURE_ANALYSIS_OUTCOMES)[number];

export const EVIDENCE_KINDS = [
  'error',
  'stackTrace',
  'screenshot',
  'video',
  'trace',
  'console',
  'network',
  'logs',
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type EvidenceAvailability = 'present' | 'unavailable';

export interface EvidenceRefs {
  error: string;
  stackTrace: string;
  screenshot: string;
  video: string;
  trace: string;
  console: string;
  network: string;
  logs: string;
  availability: Record<EvidenceKind, EvidenceAvailability>;
}

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

export const OWNER_CLASSIFICATION_RULES = [
  'SOURCE_APPLICATION_QUALITY',
  'SOURCE_DEPENDENCY',
  'ERROR_TEXT_CONFIGURATION',
  'ERROR_TEXT_TEST_DATA',
  'ERROR_TEXT_DEPENDENCY',
  'ERROR_TEXT_NETWORK',
  'ERROR_TEXT_BROWSER',
  'ERROR_TEXT_ENVIRONMENT',
  'MECHANISM_AUTOMATION',
  'MECHANISM_APPLICATION',
  'MECHANISM_ENVIRONMENT',
  'MECHANISM_NETWORK',
  'INSUFFICIENT_EVIDENCE',
] as const;

export type OwnerClassificationRule = (typeof OWNER_CLASSIFICATION_RULES)[number];

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
  consoleLog?: string;
  networkLog?: string;
  logPath?: string | null;
  consolePresent?: boolean;
  networkPresent?: boolean;
  logPresent?: boolean;
  videoPresent?: boolean;
  tracePresent?: boolean;
  evidenceRefs?: EvidenceRefs;
  artifactSourcePath?: string;
}

export interface ClassifiedFailure {
  id: string;
  testId: string;
  source: string;
  title: string;
  /** Technical mechanism class — used by retest selection. */
  classification: FailureClass;
  ruleFired: FailureClassificationRule;
  /** Owner-level class (APPLICATION / AUTOMATION / …). Optional on legacy fixtures. */
  ownerClassification?: OwnerFailureClass;
  ownerRuleFired?: OwnerClassificationRule;
  ownerRationale?: string;
  evidenceExcerpt: string;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  evidence: FailureEvidence;
  originalStatus?: 'FAIL';
}

export interface FailureAnalysisFinding {
  id: string;
  testId: string;
  classification: FailureClass;
  ruleFired: FailureClassificationRule;
  ownerClassification?: OwnerFailureClass;
  ownerRuleFired?: OwnerClassificationRule;
  evidenceExcerpt: string;
  confidence: ClassifiedFailure['confidence'];
  title: string;
  source: string;
  reason: string;
  recommendation: string;
  originalStatus?: 'FAIL';
  evidenceRefs?: EvidenceRefs;
}

export interface FailureAnalysisMetadata {
  evidenceBased: true;
  classificationsAreDefectTickets: false;
  note: string;
}

export const FAILURE_ANALYSIS_DISCLAIMER =
  'Classifications are evidence-based heuristics from captured error text, duration, and attached artifacts. They are not defect tickets. Failures stay FAIL. Never modify a test merely to make it pass.';

export const FAILURE_ANALYSIS_METADATA: FailureAnalysisMetadata = {
  evidenceBased: true,
  classificationsAreDefectTickets: false,
  note: FAILURE_ANALYSIS_DISCLAIMER,
};

export const FAILURE_ANALYSIS_LIMITATIONS = [
  'Classification uses captured error text, duration, and artifact paths only — no live debugging and no invented defect tickets.',
  'A duration within 5% of a configured Playwright timeout is NAVIGATION_TIMEOUT or ELEMENT_TIMEOUT, not an assertion failure.',
  'Duration missing from Playwright JSON is recorded as NOT_AVAILABLE; the timeout-proximity rule does not fire and classification falls back to error text.',
  'Error text is taken from result.error and result.errors via scripts/lib/playwright-results.ts. Additional Playwright error fields are not invented.',
  'Screenshot, video, trace, console, network, and log paths are attached only when present on disk. Missing kinds are unavailable — they are not fabricated.',
  'Stage FAIL findings (security, SEO, content, dependencies) are collected from reports/*. Accessibility/visual/responsive findings are omitted when the matching Playwright suite JSON already recorded the same FAIL.',
  'Owner classes (APPLICATION, AUTOMATION, ENVIRONMENT, TEST_DATA, CONFIGURATION, NETWORK, BROWSER, DEPENDENCY, UNKNOWN) are evidence-based. Insufficient evidence is UNKNOWN with a reason.',
  'Original FAIL records are preserved. Classification never converts a failure to PASS.',
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

export function recommendationForOwner(classification: OwnerFailureClass): string {
  switch (classification) {
    case 'APPLICATION':
      return 'Treat as a product defect. Do not weaken the assertion to make the failure disappear.';
    case 'AUTOMATION':
      return 'Fix the harness (locator, wait, or assertion wiring) only. Original FAIL stays on record.';
    case 'ENVIRONMENT':
      return 'Repair the runtime (services, PATH, CI image) and rerun. Do not mark PASS without new evidence.';
    case 'TEST_DATA':
      return 'Correct fixtures or seeded data. Do not change expected results to match bad data.';
    case 'CONFIGURATION':
      return 'Supply the missing config/credentials. Record REQUIRES_CONFIGURATION until then — do not skip silently.';
    case 'NETWORK':
      return 'Verify DNS, TLS, and reachability. Rerun when the network is stable.';
    case 'BROWSER':
      return 'Investigate the engine-specific failure. Chromium/Firefox/WebKit are not interchangeable with real devices.';
    case 'DEPENDENCY':
      return 'Address the advisory or missing package. Do not ignore a FAIL to keep the pipeline green.';
    default:
      return 'Evidence is insufficient. Leave as UNKNOWN — do not invent a class or convert the FAIL to PASS.';
  }
}

export function toAnalysisFinding(row: ClassifiedFailure): FailureAnalysisFinding {
  const owner = row.ownerClassification ?? 'UNKNOWN';
  const ownerRule = row.ownerRuleFired ?? 'INSUFFICIENT_EVIDENCE';
  const refs = row.evidence.evidenceRefs;
  return {
    id: row.id,
    testId: row.testId,
    classification: row.classification,
    ruleFired: row.ruleFired,
    ownerClassification: owner,
    ownerRuleFired: ownerRule,
    evidenceExcerpt: row.evidenceExcerpt,
    confidence: row.confidence,
    title: row.title,
    source: row.source,
    reason: row.ownerRationale ?? row.rationale,
    recommendation: recommendationForOwner(owner),
    originalStatus: 'FAIL',
    evidenceRefs: refs ?? {
      error: row.evidence.errorMessage,
      stackTrace: row.evidence.stackTrace,
      screenshot: row.evidence.screenshotPath ?? NOT_AVAILABLE,
      video: row.evidence.videoPath ?? NOT_AVAILABLE,
      trace: row.evidence.tracePath ?? NOT_AVAILABLE,
      console: row.evidence.consoleLog ?? NOT_AVAILABLE,
      network: row.evidence.networkLog ?? NOT_AVAILABLE,
      logs: row.evidence.logPath ?? NOT_AVAILABLE,
      availability: {
        error: row.evidence.errorMessage && row.evidence.errorMessage !== NOT_AVAILABLE ? 'present' : 'unavailable',
        stackTrace: row.evidence.stackTrace && row.evidence.stackTrace !== NOT_AVAILABLE ? 'present' : 'unavailable',
        screenshot: row.evidence.screenshotPresent ? 'present' : 'unavailable',
        video: row.evidence.videoPresent ? 'present' : 'unavailable',
        trace: row.evidence.tracePresent ? 'present' : 'unavailable',
        console: row.evidence.consolePresent ? 'present' : 'unavailable',
        network: row.evidence.networkPresent ? 'present' : 'unavailable',
        logs: row.evidence.logPresent ? 'present' : 'unavailable',
      },
    },
  };
}

export interface FailureAnalysisSection216Row {
  testId: string;
  classification: FailureClass;
  evidenceExcerpt: string;
  ruleFired: FailureClassificationRule;
  title: string;
  source: string;
  ownerClassification?: OwnerFailureClass;
}

export interface EvidenceSourceScan {
  source: string;
  path: string;
  present: boolean;
  failureCount: number;
}

export interface FailureAnalysisSection216 {
  section: '2.16';
  title: 'Failure Analysis';
  metadata: FailureAnalysisMetadata;
  disclaimer: string;
  byClass: Record<FailureClass, number>;
  byOwnerClass?: Record<OwnerFailureClass, number>;
  rows: FailureAnalysisSection216Row[];
}

export interface FailureAnalysisSummary {
  generatedAt: string;
  outcome?: FailureAnalysisOutcome;
  analyzed: number;
  totalFailures: number;
  byClass: Record<FailureClass, number>;
  byOwnerClass?: Record<OwnerFailureClass, number>;
  failures: ClassifiedFailure[];
  findings: FailureAnalysisFinding[];
  sourcesScanned?: EvidenceSourceScan[];
  metadata: FailureAnalysisMetadata;
  disclaimer: string;
  limitations: string[];
  section216: FailureAnalysisSection216;
  integrity?: {
    failuresConvertedToPass: 0;
    assertionsWeakened: 0;
    originalStatusPreserved: true;
  };
}
