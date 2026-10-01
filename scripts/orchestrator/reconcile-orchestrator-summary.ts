import fs from 'fs';
import path from 'path';
import { readJsonIfExists, writeJson } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import { isSuiteStatus, type SuiteStatus } from '../lib/suite-status';
import { buildStages } from './stages';
import { readStageExecutedCounts, resolveStageOutcome } from './stage-outcome';
import type { OrchestratorSummary, StageDefinition, StageResult } from './types';

export interface OrchestratorStaleness {
  partial: boolean;
  stale: boolean;
  recordedStageCount: number;
  expectedStageCount: number;
  originalGeneratedAt: string | null;
  newestSuiteArtifactAt: string | null;
  note: string;
}

export interface ReconciledOrchestratorSummary {
  generatedAt: string;
  source: 'reconciled-from-suite-artifacts';
  originalSummaryPath: string;
  originalPreserved: true;
  url: string;
  failFast: boolean;
  staleness: OrchestratorStaleness;
  stages: StageResult[];
  originalStages: StageResult[];
  failed: string[];
  passed: string[];
  notExecuted: string[];
  overallStatus: 'PASS' | 'FAIL' | 'BLOCKED';
}

/** Suite / stage summary files used to detect "later individual runs". */
export const SUITE_ARTIFACT_PATHS_FOR_STALENESS: readonly string[] = [
  path.join(PATHS.reports.playwright, 'e2e', 'summary.json'),
  path.join(PATHS.reports.playwright, 'visual', 'summary.json'),
  path.join(PATHS.reports.playwright, 'responsive', 'summary.json'),
  path.join(PATHS.reports.playwright, 'cross-browser', 'summary.json'),
  path.join(PATHS.reports.accessibility, 'summary.json'),
  path.join(PATHS.reports.postman, 'summary.json'),
  PATHS.jmeterSummary,
  PATHS.performanceStageSummary,
  path.join(PATHS.reports.security, 'summary.json'),
  path.join(PATHS.reports.seo, 'summary.json'),
  path.join(PATHS.reports.content, 'summary.json'),
  path.join(PATHS.reports.workflows, 'summary.json'),
  PATHS.coverageSummaryFile,
  path.join(PATHS.reports.failures, 'summary.json'),
  path.join(PATHS.reports.retest, 'summary.json'),
  path.join(PATHS.reports.summary, 'final-qa-report.json'),
];

function fileMtimeIso(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

export function newestSuiteArtifactIso(
  paths: readonly string[] = SUITE_ARTIFACT_PATHS_FOR_STALENESS
): string | null {
  let newest: string | null = null;
  for (const filePath of paths) {
    const mtime = fileMtimeIso(filePath);
    if (!mtime) continue;
    if (!newest || mtime > newest) newest = mtime;
  }
  return newest;
}

export function detectOrchestratorStaleness(input: {
  original: Pick<OrchestratorSummary, 'generatedAt' | 'stages'> | null;
  expectedStageCount: number;
  newestSuiteArtifactAt?: string | null;
}): OrchestratorStaleness {
  const recordedStageCount = input.original?.stages?.length ?? 0;
  const expectedStageCount = input.expectedStageCount;
  const originalGeneratedAt = input.original?.generatedAt ?? null;
  const newestSuiteArtifactAt =
    input.newestSuiteArtifactAt === undefined
      ? newestSuiteArtifactIso()
      : input.newestSuiteArtifactAt;
  const partial = recordedStageCount > 0 && recordedStageCount < expectedStageCount;
  const artifactsNewer = Boolean(
    originalGeneratedAt && newestSuiteArtifactAt && newestSuiteArtifactAt > originalGeneratedAt
  );
  // A complete N/N orchestrator summary is authoritative for this run. Do not treat
  // newer suite/report mtimes (e.g. report:final refresh) as "stale abort/resume".
  const stale = partial || (recordedStageCount === 0 && Boolean(newestSuiteArtifactAt));
  const lastRecorded = originalGeneratedAt ?? 'unknown';
  const note = partial
    ? `Orchestrator summary is partial/stale: ${recordedStageCount} of ${expectedStageCount} stages recorded, last recorded ${lastRecorded}; later stages were run individually.`
    : recordedStageCount === 0
      ? `Orchestrator summary is missing or empty; expected ${expectedStageCount} stages. Suite artifacts may still exist from individual runs.`
      : artifactsNewer
        ? `Orchestrator summary records ${recordedStageCount} of ${expectedStageCount} stages (generated ${lastRecorded}). Suite artifacts were refreshed after that timestamp (${newestSuiteArtifactAt}); original summary is complete and preserved.`
        : `Orchestrator summary records ${recordedStageCount} of ${expectedStageCount} stages (generated ${lastRecorded}).`;
  return {
    partial,
    stale,
    recordedStageCount,
    expectedStageCount,
    originalGeneratedAt,
    newestSuiteArtifactAt,
    note,
  };
}

function stamp(): string {
  return new Date().toISOString();
}

/**
 * Resolve one stage status from on-disk suite artifacts only.
 * Never invents PASS for missing evidence. Does not rewrite the original orch summary.
 */
export function resolveStageStatusFromArtifacts(stage: StageDefinition): StageResult {
  const now = stamp();
  const base: StageResult = {
    id: stage.id,
    key: stage.key,
    name: stage.name,
    status: 'NOT_EXECUTED',
    exitCode: null,
    startedAt: now,
    finishedAt: now,
    completedAt: now,
    durationMs: 0,
    reason: 'No suite artifact for this stage — recorded NOT_EXECUTED (not invented as PASS)',
    executedCount: 0,
  };

  if (stage.key === 'collect') {
    return {
      ...base,
      status: 'PASS',
      exitCode: 0,
      reason: 'In-process collect stage — reconciled as present when any suite artifacts exist',
    };
  }

  // Prefer explicit engine summaries that already carry honest non-PASS statuses.
  if (stage.key === 'api') {
    const summary = readJsonIfExists<{ status?: string; note?: string }>(
      path.join(PATHS.reports.postman, 'summary.json')
    );
    if (summary?.status === 'REQUIRES_CONFIGURATION') {
      return {
        ...base,
        status: 'REQUIRES_CONFIGURATION',
        exitCode: 1,
        reason: summary.note ?? 'REQUIRES_CONFIGURATION from reports/postman/summary.json',
      };
    }
    if (summary?.status === 'FAIL') {
      const outcome = resolveStageOutcome({
        key: 'api',
        processStatus: 'FAIL',
        processFailed: true,
      });
      return {
        ...base,
        status: outcome.status,
        exitCode: 1,
        reason: outcome.reason ?? 'Postman suite artifact indicates failure',
        executedCount: outcome.executedCount,
      };
    }
  }

  if (stage.key === 'performance') {
    const jmeter = readJsonIfExists<{ status?: string; targetSource?: string }>(PATHS.jmeterSummary);
    if (jmeter?.status) {
      const outcome = resolveStageOutcome({
        key: 'performance',
        processStatus: jmeter.status === 'breached' ? 'FAIL' : 'PASS',
        processFailed: jmeter.status === 'breached' || jmeter.status === 'FAIL',
      });
      return {
        ...base,
        status: outcome.status,
        exitCode: outcome.status === 'FAIL' || outcome.status === 'PARTIAL' ? 1 : 0,
        reason:
          jmeter.targetSource === 'website'
            ? 'Liveness against the website under test, no API URL configured; status RECORDED, not PASS'
            : `From reports/jmeter/summary.json status=${jmeter.status}`,
        executedCount: outcome.executedCount,
      };
    }
  }

  const counts = readStageExecutedCounts(stage.key);
  if (!counts) {
    return base;
  }

  const processFailed = (counts.failedCount ?? 0) > 0;
  const outcome = resolveStageOutcome({
    key: stage.key,
    processStatus: processFailed ? 'FAIL' : 'PASS',
    processFailed,
  });
  const status: SuiteStatus = isSuiteStatus(outcome.status) ? outcome.status : 'NOT_EXECUTED';
  return {
    ...base,
    status,
    exitCode: status === 'FAIL' || status === 'PARTIAL' || status === 'INVALID' ? 1 : 0,
    reason: outcome.reason ?? `Reconciled from suite artifact (executedCount=${outcome.executedCount ?? 0})`,
    executedCount: outcome.executedCount,
  };
}

function rollupNames(stages: StageResult[]): {
  failed: string[];
  passed: string[];
  notExecuted: string[];
  overallStatus: 'PASS' | 'FAIL' | 'BLOCKED';
} {
  const failed: string[] = [];
  const passed: string[] = [];
  const notExecuted: string[] = [];
  let sawFail = false;
  let sawBlocked = false;
  for (const row of stages) {
    if (row.status === 'FAIL' || row.status === 'PARTIAL' || row.status === 'INVALID') {
      failed.push(row.name);
      sawFail = true;
    } else if (row.status === 'PASS' || row.status === 'RECORDED') {
      passed.push(row.name);
    } else {
      notExecuted.push(row.name);
      if (
        row.status === 'BLOCKED' ||
        row.status === 'REQUIRES_CONFIGURATION' ||
        row.status === 'NOT_EXECUTED'
      ) {
        sawBlocked = true;
      }
    }
  }
  return {
    failed,
    passed,
    notExecuted,
    overallStatus: sawFail ? 'FAIL' : sawBlocked ? 'BLOCKED' : 'PASS',
  };
}

/**
 * Build + write reports/orchestrator/reconciled-summary.json alongside the
 * original summary.json (never deleted or overwritten).
 */
export function writeReconciledOrchestratorSummary(options?: {
  expectedStages?: StageDefinition[];
}): ReconciledOrchestratorSummary {
  const expectedStages = options?.expectedStages ?? buildStages();
  const original = readJsonIfExists<OrchestratorSummary>(
    path.join(PATHS.reports.orchestrator, 'summary.json')
  );
  const staleness = detectOrchestratorStaleness({
    original,
    expectedStageCount: expectedStages.length,
  });
  const stages = expectedStages.map((stage) => resolveStageStatusFromArtifacts(stage));
  // Prefer original stage rows when the orch run recorded them (same key) — do not erase FAIL.
  const originalByKey = new Map((original?.stages ?? []).map((row) => [row.key, row]));
  const merged = stages.map((reconciled) => {
    const prior = originalByKey.get(reconciled.key);
    if (!prior) return reconciled;
    // Keep original FAIL/PARTIAL when reconcile would soften it.
    if (
      (prior.status === 'FAIL' || prior.status === 'PARTIAL' || prior.status === 'INVALID') &&
      reconciled.status !== 'FAIL' &&
      reconciled.status !== 'PARTIAL'
    ) {
      return { ...prior, reason: prior.reason ?? 'Preserved original FAIL from orchestrator summary' };
    }
    // Prefer explicit REQUIRES_CONFIGURATION from artifacts over a diluted FAIL from orch.
    if (reconciled.status === 'REQUIRES_CONFIGURATION') return reconciled;
    if (reconciled.status === 'NOT_EXECUTED' && prior.status !== 'NOT_EXECUTED') return prior;
    return reconciled.status === 'NOT_EXECUTED' ? prior : reconciled;
  });

  const names = rollupNames(merged);
  const document: ReconciledOrchestratorSummary = {
    generatedAt: stamp(),
    source: 'reconciled-from-suite-artifacts',
    originalSummaryPath: 'reports/orchestrator/summary.json',
    originalPreserved: true,
    url: original?.url ?? '',
    failFast: Boolean(original?.failFast),
    staleness,
    stages: merged,
    originalStages: original?.stages ?? [],
    failed: names.failed,
    passed: names.passed,
    notExecuted: names.notExecuted,
    overallStatus: names.overallStatus,
  };

  fs.mkdirSync(PATHS.reports.orchestrator, { recursive: true });
  writeJson(PATHS.orchestratorReconciledSummary, document);
  return document;
}

export function readReconciledOrchestratorSummary(): ReconciledOrchestratorSummary | null {
  return readJsonIfExists<ReconciledOrchestratorSummary>(PATHS.orchestratorReconciledSummary);
}

export function formatOrchestratorStalenessBanner(staleness: OrchestratorStaleness): string {
  return [
    '',
    '============================================================',
    'ORCHESTRATOR SUMMARY INTEGRITY',
    '============================================================',
    staleness.note,
    `Partial: ${staleness.partial}  Stale: ${staleness.stale}`,
    `Recorded stages: ${staleness.recordedStageCount} / ${staleness.expectedStageCount}`,
    `Original generatedAt: ${staleness.originalGeneratedAt ?? 'n/a'}`,
    `Newest suite artifact: ${staleness.newestSuiteArtifactAt ?? 'n/a'}`,
    `Reconciled view: reports/orchestrator/reconciled-summary.json (original preserved)`,
    '============================================================',
  ].join('\n');
}
