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
}): OrchestratorSummary {
  const groups = rollupStageGroups(input.results);
  const timeline = buildStageTimeline(toTimelineRows(input.results));
  const suiteRollup = collectSuiteRollup(input.results);
  const exitCode = orchestratorProcessExitCode(suiteRollup.overall, overallExitCode(input.results));

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
    overallStatus: suiteRollup.overall,
    exitCode,
    orderingValid: timeline.ordering.ok,
    orderingViolations: timeline.ordering.violations,
    suiteRollup: suiteRollup.lines,
  };

  const dir = PATHS.reports.orchestrator;
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(PATHS.reports.summary, { recursive: true });
  writeJson(path.join(dir, 'summary.json'), summary);
  writeJson(path.join(dir, 'timeline.json'), timeline);
  writeJson(path.join(PATHS.reports.summary, 'qa-all.json'), summary);

  const lines = [
    '# qa:all stage results',
    '',
    `URL: ${summary.url}`,
    `Overall: ${summary.overallStatus}`,
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
}): OrchestratorSummary {
  return writeOrchestratorArtifacts(input);
}
