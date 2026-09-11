import path from 'path';
import { runSync } from './sync-from-config';
import { loadConfig } from './lib/load-config';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { resolveDiscoveryConfig } from './core/scope';
import { DEFAULT_FIXTURE_PORT, ensureFixtureChildProcess } from './testing/serve-fixture-site';
import { collectResults, writeOrchestratorArtifacts } from './orchestrator/collect';
import { executionGate, isExecutionStage } from './orchestrator/ordering';
import {
  parseOrchestratorCli,
  isLoopbackUrl,
  readExistingSeedUrl,
  resolveOrchestratorUrl,
} from './orchestrator/resolve-url';
import { runChildStage, runChildStageAsync, skippedResult } from './orchestrator/spawn-stage';
import { buildStages } from './orchestrator/stages';
import {
  ORCHESTRATOR_DISCLAIMER,
  type OrchestratorContext,
  type StageDefinition,
  type StageResult,
} from './orchestrator/types';
import { cleanRunArtifacts } from './lib/clean-run-artifacts';
import { NO_SKIP_POLICY_STATEMENT, resolveExhaustiveExecutionPolicy } from './lib/no-skip-policy';

function buildContext(url: string, failFast: boolean, extraArgs: string[]): OrchestratorContext {
  const config = loadConfig();
  const discovery = resolveDiscoveryConfig(config.discovery);
  const exhaustive = resolveExhaustiveExecutionPolicy(config.pipeline);

  return {
    url,
    failFast,
    extraArgs,
    playwrightEnabled: config.playwright.enabled !== false,
    postmanEnabled: config.postman.enabled !== false,
    jmeterEnabled: config.jmeter.enabled !== false,
    discoveryEnabled: discovery.enabled,
    dependenciesEnabled: config.dependencies?.enabled !== false,
    securityEnabled: config.security?.enabled !== false,
    seoEnabled: config.seo?.enabled !== false,
    contentEnabled: config.content?.enabled !== false,
    failureAnalysisEnabled: config.failureAnalysis?.enabled !== false,
    retestEnabled: config.retest?.enabled !== false,
    reportEnabled: config.report?.enabled !== false,
    exhaustiveExecution: exhaustive.enabled,
  };
}

function stageEnv(url: string): NodeJS.ProcessEnv {
  const base = url.replace(/\/+$/, '');
  return {
    QA_WEBSITE_URL: url.endsWith('/') ? url : `${url}/`,
    QA_PLAYWRIGHT_BASE_URL: base,
  };
}

function discoveryArgs(url: string, extraArgs: string[]): string[] {
  const normalized = url.endsWith('/') ? url : `${url}/`;
  const passthrough = extraArgs.filter((arg) => arg.startsWith('--max-pages'));
  return [normalized, ...passthrough];
}

function collectStageResult(stage: { id: number; key: string; name: string }): StageResult {
  const now = new Date().toISOString();
  return {
    id: stage.id,
    key: stage.key,
    name: stage.name,
    status: 'PASS',
    exitCode: 0,
    startedAt: now,
    finishedAt: now,
    completedAt: now,
    durationMs: 0,
    reason: 'Aggregated in-process before writing orchestrator summary',
  };
}

function failsFast(status: StageResult['status']): boolean {
  return status === 'FAIL' || status === 'INVALID' || status === 'PARTIAL';
}

/** Always emit the professional report after earlier stages, including --fail-fast stops. */
function ensureFinalReportStage(input: {
  stages: StageDefinition[];
  results: StageResult[];
  ctx: OrchestratorContext;
  passthroughArgs: string[];
  env: NodeJS.ProcessEnv;
  effectiveUrl: string;
  failFast: boolean;
}): void {
  const reportStage = input.stages.find((stage) => stage.key === 'report');
  if (!reportStage) return;
  if (input.results.some((row) => row.key === 'report')) return;

  const skipReason = reportStage.skip?.(input.ctx) ?? null;
  if (skipReason) {
    input.results.push(skippedResult(reportStage, skipReason));
    writeOrchestratorArtifacts({
      url: input.effectiveUrl,
      failFast: input.failFast,
      results: input.results,
    });
    return;
  }

  logStep('Final report generation (always runs at end of qa:all)');
  const result = runChildStage(reportStage, [...(reportStage.args ?? []), ...input.passthroughArgs], {
    env: input.env,
  });
  input.results.push(result);
  writeOrchestratorArtifacts({
    url: input.effectiveUrl,
    failFast: input.failFast,
    results: input.results,
  });
}

async function main(): Promise<void> {
  const { url: cliUrl, failFast, keepArtifacts, extraArgs } = parseOrchestratorCli();
  const config = loadConfig();

  logStep(`${config.project.name} — qa:all orchestrator`);
  console.log(ORCHESTRATOR_DISCLAIMER);
  const exhaustive = resolveExhaustiveExecutionPolicy(config.pipeline);
  if (exhaustive.enabled) {
    logStep('Exhaustive execution policy');
    console.log(NO_SKIP_POLICY_STATEMENT);
  }
  console.log('');

  if (keepArtifacts) {
    logWarn('Keeping previous run artifacts (--keep-artifacts)');
  } else {
    logStep('Cleaning previous test artifacts and cache');
    const { removed } = cleanRunArtifacts();
    logSuccess(
      removed.length === 0
        ? 'No previous run artifacts were present'
        : `Removed ${removed.length} previous artifact path(s)`
    );
  }

  await runSync();

  const url = resolveOrchestratorUrl({
    cliUrl,
    envUrl: process.env.QA_WEBSITE_URL,
    websiteUrl: config.urls.website,
    playwrightBaseUrl: config.playwright.baseURL,
    existingSeed: readExistingSeedUrl(),
  });

  let fixtureClose: (() => Promise<void>) | null = null;
  let effectiveUrl = url;

  if (isLoopbackUrl(url)) {
    const port = Number(new URL(url).port || DEFAULT_FIXTURE_PORT);
    const fixture = await ensureFixtureChildProcess(port);
    if (fixture) {
      fixtureClose = fixture.close;
      effectiveUrl = `${fixture.url}/`;
      logSuccess(`Fixture site running at ${fixture.url}`);
    } else {
      logWarn(`Fixture port ${port} already in use — assuming server is running`);
      effectiveUrl = url.endsWith('/') ? url : `${url}/`;
    }
  }

  const ctx = buildContext(effectiveUrl, failFast, extraArgs);
  const stages = buildStages();
  const results: StageResult[] = [];
  const env = stageEnv(effectiveUrl);
  const passthroughArgs = extraArgs.filter(
    (arg) =>
      arg !== '--' &&
      !arg.startsWith('--url=') &&
      !arg.startsWith('--max-pages') &&
      arg !== '--fail-fast' &&
      arg !== '--keep-artifacts'
  );

  let stageIndex = 0;
  stageLoop: while (stageIndex < stages.length) {
    const stage = stages[stageIndex];

    const skipReason = stage.skip?.(ctx) ?? null;
    if (skipReason) {
      results.push(skippedResult(stage, skipReason));
      writeOrchestratorArtifacts({ url: effectiveUrl, failFast, results });
      stageIndex += 1;
      continue;
    }

    if (isExecutionStage(stage.key)) {
      const gate = executionGate(results);
      if (!gate.ok) {
        results.push(skippedResult(stage, gate.reason));
        writeOrchestratorArtifacts({ url: effectiveUrl, failFast, results });
        stageIndex += 1;
        continue;
      }
    }

    if (stage.key === 'collect') {
      results.push(collectStageResult(stage));
      writeOrchestratorArtifacts({ url: effectiveUrl, failFast, results });
      stageIndex += 1;
      continue;
    }

    // Stages sharing a parallelGroup with the ones immediately after them
    // run concurrently — e.g. security/seo/content are all page-fetch based
    // with no shared browser/JVM resource. Each stage in the group still
    // gets its own skip/execution-gate check before being included.
    if (stage.parallelGroup) {
      const groupEnd = stages.findIndex(
        (candidate, idx) => idx > stageIndex && candidate.parallelGroup !== stage.parallelGroup
      );
      const groupStages = stages.slice(stageIndex, groupEnd === -1 ? stages.length : groupEnd);

      const runnable: StageDefinition[] = [];
      for (const groupStage of groupStages) {
        const groupSkipReason = groupStage.skip?.(ctx) ?? null;
        if (groupSkipReason) {
          results.push(skippedResult(groupStage, groupSkipReason));
          continue;
        }
        if (isExecutionStage(groupStage.key)) {
          const gate = executionGate(results);
          if (!gate.ok) {
            results.push(skippedResult(groupStage, gate.reason));
            continue;
          }
        }
        runnable.push(groupStage);
      }
      writeOrchestratorArtifacts({ url: effectiveUrl, failFast, results });

      if (runnable.length > 0) {
        logStep(`Running ${runnable.length} stage(s) concurrently (${stage.parallelGroup})`);
        const batchResults = await Promise.all(
          runnable.map((groupStage) =>
            runChildStageAsync(groupStage, [...(groupStage.args ?? []), ...passthroughArgs], { env })
          )
        );
        for (const result of batchResults) results.push(result);
        writeOrchestratorArtifacts({ url: effectiveUrl, failFast, results });

        if (failFast) {
          const failed = batchResults.find((result) => failsFast(result.status));
          if (failed) {
            logError(`--fail-fast set; stopping execution after ${failed.name}`);
            stageIndex = groupEnd === -1 ? stages.length : groupEnd;
            break stageLoop;
          }
        }
      }

      stageIndex = groupEnd === -1 ? stages.length : groupEnd;
      continue;
    }

    const args =
      stage.key === 'discovery'
        ? discoveryArgs(effectiveUrl, extraArgs)
        : [...(stage.args ?? []), ...passthroughArgs];

    const result = runChildStage(stage, args, { env });
    results.push(result);
    writeOrchestratorArtifacts({ url: effectiveUrl, failFast, results });

    if (failFast && failsFast(result.status) && stage.key !== 'report') {
      logError(`--fail-fast set; stopping execution after ${stage.name}`);
      break;
    }

    stageIndex += 1;
  }

  ensureFinalReportStage({
    stages,
    results,
    ctx,
    passthroughArgs,
    env,
    effectiveUrl,
    failFast,
  });

  const summary = collectResults({ url: effectiveUrl, failFast, results });

  if (fixtureClose) {
    await fixtureClose();
  }

  logStep('Orchestrator summary');
  console.log(`URL:     ${summary.url}`);
  console.log(`Overall: ${summary.overallStatus}`);
  if (summary.passed.length > 0) {
    console.log(`Passed:  ${summary.passed.join(', ')}`);
  }
  if (summary.failed.length > 0) {
    logError(`Failed:  ${summary.failed.join(', ')}`);
  }
  if (summary.notExecuted.length > 0) {
    logWarn(`Not executed: ${summary.notExecuted.join(', ')}`);
  }
  if (!summary.orderingValid) {
    logError(`Stage ordering violated: ${summary.orderingViolations.join('; ')}`);
  }
  logSuccess(`Stage report: ${path.join(PATHS.reports.orchestrator, 'stages.md')}`);

  process.exit(summary.exitCode);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
