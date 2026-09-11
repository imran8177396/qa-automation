import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { loadConfig } from './lib/load-config';
import { logStep, logSuccess, logWarn } from './lib/logger';
import { writeJson } from './discovery/write-json';
import type { FailureAnalysisSummary } from './failures/types';
import { buildRetestFromAnalysis, notExecutedSummary } from './retest/build';
import type { RetestRunner, RetestSummary } from './retest/types';

function writeRetestArtifacts(summary: RetestSummary): void {
  fs.mkdirSync(PATHS.reports.retest, { recursive: true });
  writeJson(path.join(PATHS.reports.retest, 'summary.json'), summary);
  writeJson(path.join(PATHS.reports.retest, 'latest.json'), summary.section217);
  writeJson(path.join(PATHS.reports.retest, 'section-2.17.json'), summary.section217);
}

export { buildRetestFromAnalysis } from './retest/build';

export function runRetest(
  options: {
    automationOnly?: boolean;
    skipExecute?: boolean;
    skipReason?: string;
    runner?: RetestRunner;
    analysis?: FailureAnalysisSummary;
  } = {}
): RetestSummary {
  const config = loadConfig();
  const enabled = config.retest?.enabled !== false;
  const automationOnly = options.automationOnly === true;

  if (!enabled) {
    const summary = notExecutedSummary({
      reason: 'Retest is disabled in qa.config.json (retest.enabled = false).',
      enabled: false,
      automationOnly,
    });
    writeRetestArtifacts(summary);
    return summary;
  }

  const analysis =
    options.analysis ??
    ((): FailureAnalysisSummary | null => {
      const analysisPath = path.join(PATHS.reports.failures, 'summary.json');
      if (!fs.existsSync(analysisPath)) return null;
      return JSON.parse(fs.readFileSync(analysisPath, 'utf8')) as FailureAnalysisSummary;
    })();

  if (!analysis) {
    const summary = notExecutedSummary({
      reason:
        'No failure analysis summary (reports/failures/summary.json). Original FAIL records were not overwritten.',
      enabled: true,
      automationOnly,
    });
    writeRetestArtifacts(summary);
    return summary;
  }

  const summary = buildRetestFromAnalysis(analysis, {
    enabled: true,
    automationOnly,
    skipExecute: options.skipExecute,
    skipReason: options.skipReason,
    runner: options.runner,
  });
  writeRetestArtifacts(summary);
  return summary;
}

function main(): void {
  const automationOnly = process.argv.includes('--automation-only');
  const dryRun = process.argv.includes('--dry-run');
  logStep(`Retest${automationOnly ? ' (FLAKY only)' : ''}`);

  const summary = runRetest({
    automationOnly,
    skipExecute: dryRun,
    skipReason: dryRun
      ? 'Retest invoked with --dry-run; no executions. Status is NOT_EXECUTED, not DRY_RUN.'
      : undefined,
  });

  if (summary.status === 'NOT_EXECUTED') {
    logWarn(`${summary.reason}`);
    return;
  }

  if (summary.executed === 0) {
    logSuccess('No retest executions — original failures preserved.');
    return;
  }

  logWarn(`${summary.executed} retest execution(s) recorded — original FAIL preserved (see reports/retest/).`);
}

if (require.main === module) {
  main();
}
