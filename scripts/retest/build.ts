import path from 'path';
import { PATHS } from '../lib/paths';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import { resolveSuiteStatus, type SuiteStatus } from '../lib/suite-status';
import type { FailureAnalysisSummary, FailureClass } from '../failures/types';
import { configPathForSource, createPlaywrightRetestRunner } from './execute';
import { selectRetestCandidates } from './select';
import { runCountFor, stabilityVerdictFor } from './stability';
import {
  RETEST_DISCLAIMER,
  RETEST_LIMITATIONS,
  type RetestItem,
  type RetestOutcomeStatus,
  type RetestRunner,
  type RetestSection217,
  type RetestSummary,
} from './types';

function emptyByFinalStatus(): Record<RetestOutcomeStatus, number> {
  return { PASS: 0, FAIL: 0, NOT_EXECUTED: 0 };
}

function toSection217(summary: Omit<RetestSummary, 'section217'>): RetestSection217 {
  return {
    section: '2.17',
    title: 'Retest',
    status: summary.status,
    reason: summary.reason,
    rows: summary.items.map((row) => ({
      testId: row.testId,
      originalStatus: row.originalStatus,
      retestStatus: row.retestStatus,
      runCount: row.runCount,
      stabilityVerdict: row.stabilityVerdict,
      title: row.title,
      classification: row.classification,
    })),
  };
}

export function finishRetestSummary(draft: Omit<RetestSummary, 'section217'>): RetestSummary {
  return { ...draft, section217: toSection217(draft) };
}

export function notExecutedSummary(input: {
  reason: string;
  enabled: boolean;
  automationOnly: boolean;
  selected?: number;
  notSelected?: number;
  items?: RetestItem[];
}): RetestSummary {
  const byFinalStatus = emptyByFinalStatus();
  for (const row of input.items ?? []) byFinalStatus[row.retestStatus] += 1;

  const draft: Omit<RetestSummary, 'section217'> = {
    generatedAt: new Date().toISOString(),
    status: 'NOT_EXECUTED',
    reason: input.reason,
    disabledReason: input.reason,
    enabled: input.enabled,
    dryRun: false,
    automationOnly: input.automationOnly,
    selected: input.selected ?? 0,
    notSelected: input.notSelected ?? 0,
    executed: 0,
    runCount: 0,
    stabilityVerdict: 'NOT_EXECUTED',
    byFinalStatus,
    items: input.items ?? [],
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

function notExecutedItem(
  row: FailureAnalysisSummary['failures'][number],
  reason: string
): RetestItem {
  return {
    id: row.id,
    testId: row.testId ?? NOT_AVAILABLE,
    source: row.source,
    classification: row.classification,
    title: row.title,
    specFile: row.evidence?.specFile ?? NOT_AVAILABLE,
    originalStatus: 'FAIL',
    retestStatus: 'NOT_EXECUTED',
    finalStatus: 'NOT_EXECUTED',
    runCount: 1,
    stabilityVerdict: 'FAIL → NOT_EXECUTED',
    note: reason,
  };
}

export function buildRetestFromAnalysis(
  analysis: FailureAnalysisSummary,
  options: {
    enabled: boolean;
    automationOnly?: boolean;
    skipExecute?: boolean;
    skipReason?: string;
    runner?: RetestRunner;
  }
): RetestSummary {
  const automationOnly = options.automationOnly === true;
  const { selected, notSelected } = selectRetestCandidates(analysis.failures, { automationOnly });

  if (!options.enabled) {
    return notExecutedSummary({
      reason: options.skipReason ?? 'Retest is disabled in qa.config.json (retest.enabled = false).',
      enabled: false,
      automationOnly,
      selected: 0,
      notSelected: analysis.failures.length,
    });
  }

  if (options.skipExecute) {
    const items = selected.map((row) =>
      notExecutedItem(row, options.skipReason ?? 'Retest was not executed. Original FAIL preserved.')
    );
    return notExecutedSummary({
      reason: options.skipReason ?? 'Retest was not executed.',
      enabled: true,
      automationOnly,
      selected: selected.length,
      notSelected: notSelected.length,
      items,
    });
  }

  if (selected.length === 0) {
    return notExecutedSummary({
      reason: automationOnly
        ? 'No FLAKY failures selected for retest (--automation-only).'
        : 'No FLAKY or NAVIGATION_TIMEOUT failures selected for retest.',
      enabled: true,
      automationOnly,
      selected: 0,
      notSelected: notSelected.length,
    });
  }

  const runner = options.runner ?? createPlaywrightRetestRunner();
  const items: RetestItem[] = selected.map((row) => {
    const specFile = row.evidence?.specFile ?? NOT_AVAILABLE;
    const configPath = configPathForSource(row.source);
    if (!configPath) {
      return notExecutedItem(
        row,
        `Retest execution is not wired for source "${row.source}". Original FAIL preserved.`
      );
    }
    if (!specFile || specFile === NOT_AVAILABLE) {
      return notExecutedItem(row, 'Spec file is NOT_AVAILABLE. Original FAIL preserved.');
    }

    const result = runner.runSpec({
      specFile,
      title: row.title,
      configPath,
      outputDir: path.join(PATHS.reports.retest, 'output', row.id),
      resultsPath: path.join(PATHS.reports.retest, 'runs', `${row.id}.json`),
      projectName: row.evidence?.projectName ?? NOT_AVAILABLE,
    });

    const retestStatus = result.status;
    return {
      id: row.id,
      testId: row.testId ?? NOT_AVAILABLE,
      source: row.source,
      classification: row.classification as FailureClass,
      title: row.title,
      specFile,
      originalStatus: 'FAIL',
      retestStatus,
      finalStatus: retestStatus,
      runCount: runCountFor(retestStatus),
      stabilityVerdict: stabilityVerdictFor(retestStatus),
      note: result.reason,
    };
  });

  const byFinalStatus = emptyByFinalStatus();
  for (const row of items) byFinalStatus[row.retestStatus] += 1;
  const executed = items.filter((row) => row.retestStatus !== 'NOT_EXECUTED').length;
  const unstable = items.filter((row) => row.stabilityVerdict === 'FAIL → PASS (unstable)').length;
  const status = resolveRetestStatus(items);

  const draft: Omit<RetestSummary, 'section217'> = {
    generatedAt: new Date().toISOString(),
    status,
    reason:
      unstable > 0
        ? `${unstable} FAIL → PASS (unstable) — original FAIL preserved.`
        : executed === 0
          ? 'Selected failures were not executed. Original FAIL preserved.'
          : 'Retest recorded against original FAIL evidence.',
    disabledReason: '',
    enabled: true,
    dryRun: false,
    automationOnly,
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
    items,
    disclaimer: RETEST_DISCLAIMER,
    limitations: [...RETEST_LIMITATIONS],
  };
  return finishRetestSummary(draft);
}
