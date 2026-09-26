import fs from 'fs';
import path from 'path';
import { writeJson } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import { rollupStageGroups } from '../lib/suite-status';
import {
  buildStageTimeline,
  formatStageTimelineRows,
  stagePhaseForKey,
  type StageTimelineRow,
} from '../lib/stage-timeline';
import type { OrchestratorSummary, StageResult } from './types';
import { overallExitCode } from './spawn-stage';
import { collectSuiteRollup, orchestratorProcessExitCode } from './suite-rollup';
import {
  applyQualityGateToRollup,
  determineQualityGate,
  evaluateReleaseGate,
  formatQualityGateBanner,
  loadQualityChecksForGate,
} from './quality-gate';
import { bindUniversalQaFlow, formatUniversalQaFlowMarkdown } from './universal-qa-flow';
import { loadExecutionIdentity } from '../lib/qa-report/execution-archive';
import {
  buildOrchestratorPhasePlan,
  normalizeExistingEngineResults,
  recordAssertionsPhase,
  recordInventoryPhase,
  type EngineSelectionRecord,
  type OrchestratorPhasePlan,
} from './phases';
import type { TestsConfig } from '../types';
import { loadConfig } from '../lib/load-config';

function toTimelineRows(results: StageResult[]): StageTimelineRow[] {
  return results.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    phase: stagePhaseForKey(row.key),
    status: row.status,
    exitCode: row.exitCode,
    startedAt: row.startedAt || 'NOT_AVAILABLE',
    completedAt: row.completedAt || row.finishedAt || 'NOT_AVAILABLE',
    durationMs: row.durationMs,
    reason: row.reason,
    executedCount: row.executedCount,
  }));
}

export function writeOrchestratorArtifacts(input: {
  url: string;
  failFast: boolean;
  results: StageResult[];
  tests?: TestsConfig;
  phasePlan?: OrchestratorPhasePlan;
  selection?: EngineSelectionRecord;
}): OrchestratorSummary {
  const groups = rollupStageGroups(input.results);
  const timeline = buildStageTimeline(toTimelineRows(input.results));
  const rawRollup = collectSuiteRollup(input.results);
  const qualityGate = determineQualityGate({
    required: rawRollup.lines,
    qualityChecks: loadQualityChecksForGate(),
  });
  const suiteRollup = applyQualityGateToRollup(rawRollup, qualityGate);
  const universalFlow = bindUniversalQaFlow({ results: input.results, qualityGate });
  const exitCode = orchestratorProcessExitCode(qualityGate.status, overallExitCode(input.results));

  const config = loadConfig();
  const tests = input.tests ?? config.tests;
  const releaseGate = evaluateReleaseGate(
    {
      criticalFailures: groups.failed.length,
    },
    config.qualityGate ?? {}
  );
  // releaseGate is recorded only — never used to alter exitCode when blockRelease is not true.
  const phasePlan =
    input.phasePlan ??
    buildOrchestratorPhasePlan({
      tests,
      discoveryRan: input.results.some((row) => row.key === 'discovery' && row.status !== 'NOT_EXECUTED'),
    });
  const selection = input.selection ?? phasePlan.selection;
  const inventory = recordInventoryPhase({
    discoveryRan: input.results.some((row) => row.key === 'discovery' && row.status !== 'NOT_EXECUTED'),
  });
  const normalized = normalizeExistingEngineResults(selection);
  const assertions = recordAssertionsPhase({ normalized, qualityGate });

  const summary: OrchestratorSummary = {
    generatedAt: new Date().toISOString(),
    command: 'qa:all',
    url: input.url,
    failFast: input.failFast,
    stages: input.results,
    failed: groups.failed,
    skipped: groups.notExecuted,
    passed: groups.passed,
    notExecuted: groups.notExecuted,
    overallStatus: qualityGate.status,
    executionId: loadExecutionIdentity()?.executionId,
    exitCode,
    orderingValid: timeline.ordering.ok,
    orderingViolations: timeline.ordering.violations,
    suiteRollup: suiteRollup.lines,
    qualityGate: {
      status: qualityGate.status,
      reasons: qualityGate.reasons,
    },
    releaseGate,
  };

  const dir = PATHS.reports.orchestrator;
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(PATHS.reports.summary, { recursive: true });
  writeJson(path.join(dir, 'summary.json'), summary);
  writeJson(path.join(dir, 'timeline.json'), timeline);
  writeJson(PATHS.orchestratorQualityGate, qualityGate);
  writeJson(PATHS.orchestratorUniversalFlow, universalFlow);
  writeJson(PATHS.orchestratorPhasePlan, { ...phasePlan, inventory });
  writeJson(PATHS.orchestratorEngineSelection, selection);
  writeJson(PATHS.orchestratorNormalizedResults, normalized);
  writeJson(PATHS.orchestratorAssertions, assertions);
  writeJson(path.join(PATHS.reports.summary, 'qa-all.json'), summary);
  fs.writeFileSync(path.join(dir, 'universal-qa-flow.md'), formatUniversalQaFlowMarkdown(universalFlow), 'utf8');
  fs.writeFileSync(path.join(dir, 'quality-gate.md'), `${formatQualityGateBanner(qualityGate).trim()}\n`, 'utf8');

  const lines = [
    '# qa:all stage results',
    '',
    `URL: ${summary.url}`,
    `Overall: ${summary.overallStatus}`,
    `Execution ID: ${summary.executionId ?? 'NOT_AVAILABLE'}`,
    '',
    '## Orchestrator phases (11)',
    '',
    ...phasePlan.phaseNames.map((name, index) => `${index + 1}. ${name}`),
    '',
    '## Quality gate',
    '',
    '```',
    formatQualityGateBanner(qualityGate).trim(),
    '```',
    '',
    '## Suite rollup',
    '',
    '```',
    suiteRollup.banner.trim(),
    '```',
    '',
    '## Stage groups',
    '',
    `Passed: ${summary.passed.join(', ') || 'none'}`,
    `Failed: ${summary.failed.join(', ') || 'none'}`,
    `Not executed: ${summary.notExecuted.join(', ') || 'none'}`,
    '',
    '## Timeline',
    '',
    `Discovery completedAt: ${timeline.ordering.discoveryCompletedAt}`,
    `First execution startedAt: ${timeline.ordering.firstExecutionStartedAt}`,
    `Ordering valid: ${timeline.ordering.ok ? 'yes' : 'no'}`,
    ...(timeline.ordering.violations.length > 0
      ? timeline.ordering.violations.map((row) => `- ${row}`)
      : []),
    '',
    '| # | Stage | Status | Exit | Started | Completed | Duration | Reason |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...formatStageTimelineRows(timeline.stages),
    '',
  ];
  fs.writeFileSync(path.join(dir, 'stages.md'), `${lines.join('\n')}\n`, 'utf8');
  return summary;
}

export function collectResults(input: {
  url: string;
  failFast: boolean;
  results: StageResult[];
  tests?: TestsConfig;
  phasePlan?: OrchestratorPhasePlan;
  selection?: EngineSelectionRecord;
}): OrchestratorSummary {
  return writeOrchestratorArtifacts(input);
}
