import type { SuiteStatus } from '../lib/suite-status';
import type { FailureClass, OwnerFailureClass } from '../failures/types';

export const RETEST_LIFECYCLE_STAGES = [
  'FAIL',
  'ANALYZE',
  'CLASSIFY',
  'FIX_AUTOMATION_DEFECT_IF_REQUIRED',
  'RETEST',
  'VERIFY',
  'RECORD',
] as const;

export type RetestLifecycleStage = (typeof RETEST_LIFECYCLE_STAGES)[number];

export type RetestLifecycleStageStatus = 'DONE' | 'REQUIRED' | 'SKIPPED' | 'NOT_APPLICABLE';

export type RetestEngineOutcome = 'COMPLETE' | 'NOTHING_TO_RETEST' | 'BLOCKED' | 'NOT_EXECUTED';

export const RETEST_DISCLAIMER =
  'Retest preserves original FAIL records. Lifecycle: FAIL → ANALYZE → CLASSIFY → FIX AUTOMATION DEFECT IF REQUIRED → RETEST → VERIFY → RECORD. A passing retest is recorded as FAIL → PASS (unstable) and never overwrites the first failure.';

export const RETEST_LIMITATIONS = [
  'Retest consumes reports/failures/summary.json (Part 15 owner classes). It does not invent a second classification system.',
  'Every classified failure is linked on the retest record (original id, owner, evidence paths). Original FAIL files are copied under reports/retest/original/ and are never deleted.',
  'Scoped execution re-runs the failed Playwright spec or quality-stage finding. JMeter / heavy load is not re-run.',
  'Owner AUTOMATION records that an automation fix is required. Product assertions are never rewritten to go green.',
  'A retest PASS does not erase the original FAIL.',
  'Retest does not weaken assertions, hide failures, or downgrade severity.',
  'When retest is disabled, analysis is missing, or nothing is selected, outcome is NOT_EXECUTED / BLOCKED / NOTHING_TO_RETEST with a reason — not DRY_RUN with empty counts.',
];

/** Mechanism fallback used only with --automation-only when owner is missing. */
export const RETEST_SELECTABLE_CLASSES: readonly FailureClass[] = ['FLAKY'];

export const QUALITY_RETEST_SOURCES = ['security', 'seo', 'content', 'dependencies'] as const;
export type QualityRetestSource = (typeof QUALITY_RETEST_SOURCES)[number];

export const HEAVY_RETEST_SOURCES = ['jmeter', 'performance', 'lighthouse'] as const;

export type RetestOutcomeStatus = 'PASS' | 'FAIL' | 'NOT_EXECUTED';

export type StabilityVerdict =
  | 'FAIL → PASS (unstable)'
  | 'FAIL → FAIL (reproduced)'
  | 'FAIL → NOT_EXECUTED';

export interface RetestLifecycleEntry {
  stage: RetestLifecycleStage;
  status: RetestLifecycleStageStatus;
  note: string;
}

export interface RetestEvidencePaths {
  originalAnalysis: string;
  originalFailureId: string;
  artifactSourcePath: string;
  screenshotPath: string;
  tracePath: string;
  retestResultsPath: string;
}

export interface RetestItem {
  id: string;
  originalFailureId: string;
  testId: string;
  source: string;
  /** Technical mechanism class from Part 15. */
  classification: FailureClass | string;
  ownerClassification: OwnerFailureClass | string;
  title: string;
  specFile: string;
  /** Always the original recorded failure. Never overwritten. */
  originalStatus: 'FAIL';
  retestStatus: RetestOutcomeStatus;
  /** Alias of retestStatus for report-generator section 2.17. */
  finalStatus: RetestOutcomeStatus;
  runCount: number;
  stabilityVerdict: StabilityVerdict;
  note: string;
  automationFixRequired: boolean;
  classificationUnchanged: boolean;
  ownerClassificationUnchanged: boolean;
  lifecycle: RetestLifecycleEntry[];
  evidence: RetestEvidencePaths;
}

export interface RetestSection217Row {
  testId: string;
  originalFailureId?: string;
  originalStatus: 'FAIL';
  retestStatus: RetestOutcomeStatus;
  runCount: number;
  stabilityVerdict: StabilityVerdict;
  title: string;
  classification: string;
  ownerClassification?: string;
  originalEvidencePath?: string;
  retestEvidencePath?: string;
}

export interface RetestSection217 {
  section: '2.17';
  title: 'Retest';
  status: SuiteStatus;
  reason: string;
  lifecycle?: readonly RetestLifecycleStage[];
  rows: RetestSection217Row[];
}

export interface RetestIntegrity {
  originalFailuresDeleted: 0;
  assertionsWeakened: 0;
  failuresHidden: 0;
  severityDowngraded: 0;
  originalStatusPreserved: true;
}

export interface RetestSummary {
  generatedAt: string;
  /** Suite/stage status. Disabled or unrun retest is NOT_EXECUTED, never DRY_RUN with empty counts. */
  status: SuiteStatus;
  /** Engine outcome — COMPLETE means lifecycle + artifacts exist even when retest still FAILs. */
  outcome: RetestEngineOutcome;
  reason: string;
  disabledReason: string;
  enabled: boolean;
  dryRun: false;
  automationOnly: boolean;
  sourceFilter: string | null;
  selected: number;
  notSelected: number;
  executed: number;
  runCount: number;
  stabilityVerdict: string;
  byFinalStatus: Record<RetestOutcomeStatus, number>;
  byOwnerClass: Record<string, number>;
  lifecycle: readonly RetestLifecycleStage[];
  items: RetestItem[];
  integrity: RetestIntegrity;
  originalEvidenceDir: string;
  disclaimer: string;
  limitations: string[];
  section217: RetestSection217;
}

export interface RetestRunResult {
  status: RetestOutcomeStatus;
  reason: string;
  resultsPath: string | null;
}

export interface RetestRunnerInput {
  specFile: string;
  title: string;
  configPath: string;
  outputDir: string;
  resultsPath: string;
  projectName: string;
  source?: string;
}

export interface RetestRunner {
  runSpec(input: RetestRunnerInput): RetestRunResult;
}

export interface StageFinding {
  id?: string;
  status?: string;
  rule?: string;
  page?: string;
}

export interface StageRunResult {
  status: 'RAN' | 'NOT_EXECUTED';
  reason: string;
  resultsPath: string | null;
  findings: StageFinding[];
}

export interface RetestStageRunner {
  run(source: string): StageRunResult;
}
