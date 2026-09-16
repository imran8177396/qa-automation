import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { loadConfig } from './lib/load-config';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import type { FailureAnalysisSummary } from './failures/types';
import { blockedSummary, buildRetestFromAnalysis, notExecutedSummary } from './retest/build';
import {
  originalFailuresStillPresent,
  preserveOriginalFailureEvidence,
  restoreLiveReportsFromOriginal,
} from './retest/preserve';
import { writeRetestArtifacts } from './retest/report';
import { RETEST_LIFECYCLE_STAGES, type RetestRunner, type RetestStageRunner, type RetestSummary } from './retest/types';

export { buildRetestFromAnalysis } from './retest/build';
export { writeRetestArtifacts } from './retest/report';

function loadFailureAnalysis(): { analysis: FailureAnalysisSummary | null; blockedReason: string | null } {
  const analysisPath = path.join(PATHS.reports.failures, 'summary.json');
  if (!fs.existsSync(analysisPath)) {
    return {
      analysis: null,
      blockedReason:
        'BLOCKED: no failure analysis summary (reports/failures/summary.json). Run npm run analyze:failures first. Original FAIL records were not invented.',
    };
  }
  try {
    const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8')) as FailureAnalysisSummary;
    return { analysis, blockedReason: null };
  } catch {
    return {
      analysis: null,
      blockedReason:
        'BLOCKED: reports/failures/summary.json is unreadable. Original FAIL records were not overwritten.',
    };
  }
}

function parseSourceFilter(argv: string[]): string | undefined {
  const prefixed = argv.find((arg) => arg.startsWith('--source='));
  if (prefixed) return prefixed.slice('--source='.length).trim() || undefined;
  const index = argv.indexOf('--source');
  if (index >= 0) return argv[index + 1];
  return undefined;
}

export function runRetest(
  options: {
    automationOnly?: boolean;
    skipExecute?: boolean;
    skipReason?: string;
    sourceFilter?: string;
    runner?: RetestRunner;
    stageRunner?: RetestStageRunner;
    analysis?: FailureAnalysisSummary;
    skipPreserve?: boolean;
  } = {}
): RetestSummary {
  const config = loadConfig();
  const enabled = config.retest?.enabled !== false;
  const automationOnly = options.automationOnly === true;

  let preserved: ReturnType<typeof preserveOriginalFailureEvidence> | null = null;
  if (!options.skipPreserve) {
    preserved = preserveOriginalFailureEvidence();
  }

  try {
    if (!enabled) {
      const summary = notExecutedSummary({
        reason: 'Retest is disabled in qa.config.json (retest.enabled = false).',
        enabled: false,
        automationOnly,
        outcome: 'NOT_EXECUTED',
        sourceFilter: options.sourceFilter ?? null,
      });
      writeRetestArtifacts(summary);
      return summary;
    }

    const loaded = options.analysis
      ? { analysis: options.analysis, blockedReason: null }
      : loadFailureAnalysis();

    if (!loaded.analysis) {
      const summary = blockedSummary(
        loaded.blockedReason ??
          'BLOCKED: no failure analysis summary (reports/failures/summary.json). Original FAIL records were not invented.',
        automationOnly
      );
      writeRetestArtifacts(summary);
      return summary;
    }

    const summary = buildRetestFromAnalysis(loaded.analysis, {
      enabled: true,
      automationOnly,
      skipExecute: options.skipExecute,
      skipReason: options.skipReason,
      sourceFilter: options.sourceFilter,
      runner: options.runner,
      stageRunner: options.stageRunner,
    });
    if (preserved) {
      summary.originalEvidenceDir = preserved.originalRoot;
    }
    writeRetestArtifacts(summary);
    return summary;
  } finally {
    if (!options.skipPreserve) {
      restoreLiveReportsFromOriginal();
    }
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const automationOnly = argv.includes('--automation-only');
  const dryRun = argv.includes('--dry-run');
  const sourceFilter = parseSourceFilter(argv);

  logStep(`Retest${automationOnly ? ' (AUTOMATION/FLAKY only)' : ''}${sourceFilter ? ` (source=${sourceFilter})` : ''}`);
  console.log(`Lifecycle: ${RETEST_LIFECYCLE_STAGES.join(' → ')}`);

  const summary = runRetest({
    automationOnly,
    sourceFilter,
    skipExecute: dryRun,
    skipReason: dryRun
      ? 'Retest invoked with --dry-run; no executions. Status is NOT_EXECUTED, not DRY_RUN.'
      : undefined,
  });

  const failuresIntact = originalFailuresStillPresent();
  if (!failuresIntact) {
    logError('reports/failures/summary.json is missing after retest — original FAIL evidence must remain.');
    process.exit(1);
  }
  logSuccess('Original reports/failures/ still present (not wiped).');

  if (summary.outcome === 'BLOCKED' || summary.outcome === 'NOTHING_TO_RETEST' || summary.status === 'NOT_EXECUTED') {
    logWarn(`${summary.outcome}: ${summary.reason}`);
    process.exit(0);
  }

  const stillFailing = summary.byFinalStatus.FAIL;
  logWarn(
    `Engine ${summary.outcome}: ${summary.executed} executed, ${stillFailing} still FAIL, ${summary.byFinalStatus.PASS} PASS (unstable if any). Original FAIL preserved (see reports/retest/).`
  );
  process.exit(stillFailing > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}
