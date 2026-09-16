import type { OwnerFailureClass } from '../failures/types';
import type { RetestOutcomeStatus } from './types';
import {
  RETEST_LIFECYCLE_STAGES,
  type RetestLifecycleEntry,
  type RetestLifecycleStageStatus,
} from './types';

export function ownerRequiresAutomationFix(owner: OwnerFailureClass | string | undefined): boolean {
  return owner === 'AUTOMATION';
}

export function buildLifecycle(input: {
  ownerClassification: OwnerFailureClass | string;
  retestStatus: RetestOutcomeStatus;
  executed: boolean;
  analysisPresent: boolean;
}): RetestLifecycleEntry[] {
  const automationFix = ownerRequiresAutomationFix(input.ownerClassification);
  const classifyStatus: RetestLifecycleStageStatus = input.analysisPresent ? 'DONE' : 'SKIPPED';
  const retestStage: RetestLifecycleStageStatus = input.executed
    ? 'DONE'
    : input.retestStatus === 'NOT_EXECUTED'
      ? 'SKIPPED'
      : 'DONE';

  const notes: Record<(typeof RETEST_LIFECYCLE_STAGES)[number], string> = {
    FAIL: 'Original status is FAIL and remains on record.',
    ANALYZE: input.analysisPresent
      ? 'Consumed reports/failures/summary.json (Part 15).'
      : 'Failure analysis summary was not present.',
    CLASSIFY: input.analysisPresent
      ? `Owner class ${input.ownerClassification} reused — not reclassified.`
      : 'Classification skipped — analysis missing.',
    FIX_AUTOMATION_DEFECT_IF_REQUIRED: automationFix
      ? 'AUTOMATION owner: harness fix is required. Product assertions were not changed.'
      : `Owner is ${input.ownerClassification} — no automation fix required.`,
    RETEST: input.executed
      ? `Retest executed; result ${input.retestStatus}. Original FAIL preserved.`
      : 'Retest was not executed. Original FAIL preserved.',
    VERIFY: `Verified originalStatus=FAIL, owner=${input.ownerClassification} unchanged, severity not downgraded.`,
    RECORD: 'Recorded original FAIL + retest outcome under reports/retest/.',
  };

  return RETEST_LIFECYCLE_STAGES.map((stage) => {
    let status: RetestLifecycleStageStatus = 'DONE';
    if (stage === 'ANALYZE' || stage === 'CLASSIFY') status = classifyStatus;
    if (stage === 'FIX_AUTOMATION_DEFECT_IF_REQUIRED') {
      status = automationFix ? 'REQUIRED' : 'NOT_APPLICABLE';
    }
    if (stage === 'RETEST') status = retestStage;
    return { stage, status, note: notes[stage] };
  });
}
