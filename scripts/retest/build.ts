import { NOT_AVAILABLE } from '../lib/suite-origin';
import { resolveSuiteStatus, type SuiteStatus } from '../lib/suite-status';
import type { FailureAnalysisSummary, OwnerFailureClass } from '../failures/types';
import { executeClassifiedFailure } from './execute';
import { ORIGINAL_EVIDENCE_RELATIVE } from './preserve';
import { buildLifecycle, ownerRequiresAutomationFix } from './lifecycle';
import { isHeavyRetestSource, selectRetestCandidates } from './select';
import { runCountFor, stabilityVerdictFor } from './stability';
import {
  RETEST_DISCLAIMER,
  RETEST_LIFECYCLE_STAGES,
  RETEST_LIMITATIONS,
  type RetestEngineOutcome,
  type RetestItem,
  type RetestOutcomeStatus,
  type RetestRunner,
  type RetestSection217,
  type RetestStageRunner,
  type RetestSummary,
  type StageRunResult,
} from './types';

function emptyByFinalStatus(): Record<RetestOutcomeStatus, number> {
  return { PASS: 0, FAIL: 0, NOT_EXECUTED: 0 };
}

function countByOwner(items: RetestItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of items) {
    const key = String(row.ownerClassification || 'UNKNOWN');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function toSection217(summary: Omit<RetestSummary, 'section217'>): RetestSection217 {
  return {
    section: '2.17',
    title: 'Retest',
    status: summary.status,
    reason: summary.reason,
    lifecycle: [...RETEST_LIFECYCLE_STAGES],
    rows: summary.items.map((row) => ({
      testId: row.testId,
      originalFailureId: row.originalFailureId,
      originalStatus: row.originalStatus,
      retestStatus: row.retestStatus,
      runCount: row.runCount,
      stabilityVerdict: row.stabilityVerdict,
      title: row.title,
      classification: row.classification,
      ownerClassification: String(row.ownerClassification),
      originalEvidencePath: `${row.evidence.originalAnalysis}#${row.originalFailureId}`,
      retestEvidencePath: row.evidence.retestResultsPath,
    })),
  };
}

export function finishRetestSummary(draft: Omit<RetestSummary, 'section217'>): RetestSummary {
  return { ...draft, section217: toSection217(draft) };
}

function ownerOf(row: FailureAnalysisSummary['failures'][number]): OwnerFailureClass | string {
  return row.ownerClassification ?? 'UNKNOWN';
}

function evidencePaths(
  row: FailureAnalysisSummary['failures'][number],
  resultsPath: string | null
): RetestItem['evidence'] {
  return {
    originalAnalysis: `${ORIGINAL_EVIDENCE_RELATIVE}/summary.json`,
    originalFailureId: row.id,
    artifactSourcePath: row.evidence?.artifactSourcePath ?? row.evidence?.specFile ?? NOT_AVAILABLE,
    screenshotPath: row.evidence?.screenshotPath ?? NOT_AVAILABLE,
    tracePath: row.evidence?.tracePath ?? NOT_AVAILABLE,
    retestResultsPath: resultsPath
      ? resultsPath.replace(/\\/g, '/')
      : NOT_AVAILABLE,
  };
}

function toItem(
  row: FailureAnalysisSummary['failures'][number],
  retestStatus: RetestOutcomeStatus,
  note: string,
  resultsPath: string | null,
  analysisPresent: boolean
): RetestItem {
  const owner = ownerOf(row);
  const executed = retestStatus !== 'NOT_EXECUTED';
  return {
    id: row.id,
    originalFailureId: row.id,
    testId: row.testId ?? NOT_AVAILABLE,
    source: row.source,
    classification: row.classification,
    ownerClassification: owner,
    title: row.title,
    specFile: row.evidence?.specFile ?? NOT_AVAILABLE,
    originalStatus: 'FAIL',
    retestStatus,
    finalStatus: retestStatus,
    runCount: runCountFor(retestStatus),
    stabilityVerdict: stabilityVerdictFor(retestStatus),
    note,
    automationFixRequired: ownerRequiresAutomationFix(owner),
    classificationUnchanged: true,
    ownerClassificationUnchanged: true,
    lifecycle: buildLifecycle({
      ownerClassification: owner,
      retestStatus,
      executed,
      analysisPresent,
    }),
    evidence: evidencePaths(row, resultsPath),
  };
}

export function notExecutedSummary(input: {
  reason: string;
  enabled: boolean;
  automationOnly: boolean;
  outcome?: RetestEngineOutcome;
  selected?: number;
  notSelected?: number;
  sourceFilter?: string | null;
  items?: RetestItem[];
}): RetestSummary {
  const byFinalStatus = emptyByFinalStatus();
  for (const row of input.items ?? []) byFinalStatus[row.retestStatus] += 1;
  const outcome = input.outcome ?? 'NOT_EXECUTED';

  const draft: Omit<RetestSummary, 'section217'> = {
    generatedAt: new Date().toISOString(),
    status: 'NOT_EXECUTED',
    outcome,
    reason: input.reason,
    disabledReason: input.reason,
    enabled: input.enabled,
    dryRun: false,
    automationOnly: input.automationOnly,
    sourceFilter: input.sourceFilter ?? null,
    selected: input.selected ?? 0,
    notSelected: input.notSelected ?? 0,
    executed: 0,
    runCount: 0,
    stabilityVerdict: 'NOT_EXECUTED',
    byFinalStatus,
    byOwnerClass: countByOwner(input.items ?? []),
    lifecycle: [...RETEST_LIFECYCLE_STAGES],
    items: input.items ?? [],
    integrity: {
      originalFailuresDeleted: 0,
      assertionsWeakened: 0,
      failuresHidden: 0,
      severityDowngraded: 0,
      originalStatusPreserved: true,
    },
    originalEvidenceDir: ORIGINAL_EVIDENCE_RELATIVE,
    disclaimer: RETEST_DISCLAIMER,
    limitations: [...RETEST_LIMITATIONS],
  };
  return finishRetestSummary(draft);
}

function resolveRetestStatus(items: RetestItem[]): SuiteStatus {
  const executed = items.filter((row) => row.retestStatus !== 'NOT_EXECUTED');
  return resolveSuiteStatus({
    executedCount: executed.length,
    failedCount: executed.filter((row) => row.retestStatus === 'FAIL').length,
    passedCount: executed.filter((row) => row.retestStatus === 'PASS').length,
  });
}

function skipReasonFor(row: FailureAnalysisSummary['failures'][number], options: {
  automationOnly: boolean;
  sourceFilter: string | null;
}): string {
  if (options.sourceFilter && row.source !== options.sourceFilter) {
    return `Not in --source=${options.sourceFilter}. Original FAIL preserved.`;
  }
  if (isHeavyRetestSource(row.source)) {
    return 'Heavy JMeter/performance retest is out of scope. Original FAIL preserved.';
  }
  if (options.automationOnly) {
    return `Owner ${row.ownerClassification ?? 'UNKNOWN'} is not AUTOMATION (--automation-only). Original FAIL preserved.`;
  }
  return 'Retest was not executed. Original FAIL preserved.';
}

export function buildRetestFromAnalysis(
  analysis: FailureAnalysisSummary,
  options: {
    enabled: boolean;
    automationOnly?: boolean;
    skipExecute?: boolean;
    skipReason?: string;
    sourceFilter?: string;
    runner?: RetestRunner;
    stageRunner?: RetestStageRunner;
  }
): RetestSummary {
  const automationOnly = options.automationOnly === true;
  const sourceFilter = options.sourceFilter ?? null;
  const { selected, notSelected } = selectRetestCandidates(analysis.failures, {
    automationOnly,
    source: options.sourceFilter,
  });

  if (!options.enabled) {
    const items = analysis.failures.map((row) =>
      toItem(
        row,
        'NOT_EXECUTED',
        options.skipReason ?? 'Retest is disabled in qa.config.json (retest.enabled = false).',
        null,
        true
      )
    );
    return notExecutedSummary({
      reason: options.skipReason ?? 'Retest is disabled in qa.config.json (retest.enabled = false).',
      enabled: false,
      automationOnly,
      outcome: 'NOT_EXECUTED',
      selected: 0,
      notSelected: analysis.failures.length,
      sourceFilter,
      items,
    });
  }

  if (analysis.failures.length === 0 || analysis.outcome === 'NOTHING_TO_ANALYZE') {
    return notExecutedSummary({
      reason: 'No prior classified failures (NOTHING_TO_RETEST). Original FAIL records were not invented.',
      enabled: true,
      automationOnly,
      outcome: 'NOTHING_TO_RETEST',
      selected: 0,
      notSelected: 0,
      sourceFilter,
    });
  }

  if (options.skipExecute) {
    const items = analysis.failures.map((row) => {
      const selectedRow = selected.some((candidate) => candidate.id === row.id);
      return toItem(
        row,
        'NOT_EXECUTED',
        selectedRow
          ? options.skipReason ?? 'Retest was not executed. Original FAIL preserved.'
          : skipReasonFor(row, { automationOnly, sourceFilter }),
        null,
        true
      );
    });
    return notExecutedSummary({
      reason: options.skipReason ?? 'Retest was not executed.',
      enabled: true,
      automationOnly,
      outcome: 'NOT_EXECUTED',
      selected: selected.length,
      notSelected: notSelected.length,
      sourceFilter,
      items,
    });
  }

  if (selected.length === 0) {
    const items = analysis.failures.map((row) =>
      toItem(row, 'NOT_EXECUTED', skipReasonFor(row, { automationOnly, sourceFilter }), null, true)
    );
    return notExecutedSummary({
      reason: automationOnly
        ? 'No AUTOMATION/FLAKY failures selected for retest (--automation-only). NOTHING_TO_RETEST.'
        : options.sourceFilter
          ? `No classified failures for source "${options.sourceFilter}". NOTHING_TO_RETEST.`
          : 'No classified failures selected for retest. NOTHING_TO_RETEST.',
      enabled: true,
      automationOnly,
      outcome: 'NOTHING_TO_RETEST',
      selected: 0,
      notSelected: notSelected.length,
      sourceFilter,
      items,
    });
  }

  const stageCache = new Map<string, StageRunResult>();
  const selectedIds = new Set(selected.map((row) => row.id));
  const items: RetestItem[] = analysis.failures.map((row) => {
    if (!selectedIds.has(row.id)) {
      return toItem(row, 'NOT_EXECUTED', skipReasonFor(row, { automationOnly, sourceFilter }), null, true);
    }
    const result = executeClassifiedFailure(row, {
      runner: options.runner,
      stageRunner: options.stageRunner,
      stageCache,
    });
    return toItem(row, result.status, result.reason, result.resultsPath, true);
  });

  const byFinalStatus = emptyByFinalStatus();
  for (const row of items) byFinalStatus[row.retestStatus] += 1;
  const executed = items.filter((row) => row.retestStatus !== 'NOT_EXECUTED').length;
  const unstable = items.filter((row) => row.stabilityVerdict === 'FAIL → PASS (unstable)').length;
  const reproduced = items.filter((row) => row.stabilityVerdict === 'FAIL → FAIL (reproduced)').length;
  const status = resolveRetestStatus(items);

  const draft: Omit<RetestSummary, 'section217'> = {
    generatedAt: new Date().toISOString(),
    status,
    outcome: 'COMPLETE',
    reason:
      unstable > 0
        ? `${unstable} FAIL → PASS (unstable) — original FAIL preserved.`
        : executed === 0
          ? 'Selected failures were not executed. Original FAIL preserved.'
          : `${reproduced} FAIL → FAIL (reproduced), ${unstable} FAIL → PASS (unstable). Original FAIL + classification preserved.`,
    disabledReason: '',
    enabled: true,
    dryRun: false,
    automationOnly,
    sourceFilter,
    selected: selected.length,
    notSelected: notSelected.length,
    executed,
    runCount: items.reduce((sum, row) => sum + row.runCount, 0),
    stabilityVerdict:
      unstable > 0
        ? `${unstable} FAIL → PASS (unstable) — original FAIL preserved`
        : executed === 0
          ? 'NOT_EXECUTED'
          : 'RECORDED',
    byFinalStatus,
    byOwnerClass: countByOwner(items),
    lifecycle: [...RETEST_LIFECYCLE_STAGES],
    items,
    integrity: {
      originalFailuresDeleted: 0,
      assertionsWeakened: 0,
      failuresHidden: 0,
      severityDowngraded: 0,
      originalStatusPreserved: true,
    },
    originalEvidenceDir: ORIGINAL_EVIDENCE_RELATIVE,
    disclaimer: RETEST_DISCLAIMER,
    limitations: [...RETEST_LIMITATIONS],
  };
  return finishRetestSummary(draft);
}

export function blockedSummary(reason: string, automationOnly: boolean): RetestSummary {
  return notExecutedSummary({
    reason,
    enabled: true,
    automationOnly,
    outcome: 'BLOCKED',
  });
}

