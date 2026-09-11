import type { SuiteStatus } from '../lib/suite-status';
import type { FailureClass } from '../failures/types';

export const RETEST_DISCLAIMER =
  'Retest preserves original FAIL records. A passing retest is recorded as FAIL → PASS (unstable) and never overwrites the first failure.';

export const RETEST_LIMITATIONS = [
  'Retest selects failures classified FLAKY or NAVIGATION_TIMEOUT and re-runs those Playwright specs unchanged.',
  'A retest PASS does not erase the original FAIL.',
  'Retest does not weaken assertions to achieve PASS.',
  'When retest is disabled or cannot run, status is NOT_EXECUTED with a reason — not DRY_RUN with empty counts.',
];

export const RETEST_SELECTABLE_CLASSES: readonly FailureClass[] = ['FLAKY', 'NAVIGATION_TIMEOUT'];

export type RetestOutcomeStatus = 'PASS' | 'FAIL' | 'NOT_EXECUTED';

export type StabilityVerdict =
  | 'FAIL → PASS (unstable)'
  | 'FAIL → FAIL (reproduced)'
  | 'FAIL → NOT_EXECUTED';

export interface RetestItem {
  id: string;
  testId: string;
  source: string;
  classification: FailureClass | string;
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
}

export interface RetestSection217Row {
  testId: string;
  originalStatus: 'FAIL';
  retestStatus: RetestOutcomeStatus;
  runCount: number;
  stabilityVerdict: StabilityVerdict;
  title: string;
  classification: string;
}

export interface RetestSection217 {
  section: '2.17';
  title: 'Retest';
  status: SuiteStatus;
  reason: string;
  rows: RetestSection217Row[];
}

export interface RetestSummary {
  generatedAt: string;
  /** Suite/stage status. Disabled or unrun retest is NOT_EXECUTED, never DRY_RUN with empty counts. */
  status: SuiteStatus;
  reason: string;
  disabledReason: string;
  enabled: boolean;
  dryRun: false;
  automationOnly: boolean;
  selected: number;
  notSelected: number;
  executed: number;
  runCount: number;
  stabilityVerdict: string;
  byFinalStatus: Record<RetestOutcomeStatus, number>;
  items: RetestItem[];
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
}

export interface RetestRunner {
  runSpec(input: RetestRunnerInput): RetestRunResult;
}
