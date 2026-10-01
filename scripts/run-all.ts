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
import { persistCliWebsiteUrl, readLastTargetUrl, websiteTargetEnv } from './lib/last-target';
import { runChildStage, runChildStageAsync, skippedResult } from './orchestrator/spawn-stage';
import { buildStages } from './orchestrator/stages';
import { POST_EXECUTION_STAGE_KEYS, REPORTING_STAGE_KEYS } from './orchestrator/contract-flow';
import { collectSuiteRollup } from './orchestrator/suite-rollup';
import {
  applyQualityGateToRollup,
  determineQualityGate,
  formatQualityGateBanner,
  loadQualityChecksForGate,
} from './orchestrator/quality-gate';
import { formatUniversalQaFlowHeader } from './orchestrator/universal-qa-flow';
import {
  buildOrchestratorPhasePlan,
  formatOrchestratorPhasesHeader,
} from './orchestrator/phases';
import {
  ORCHESTRATOR_DISCLAIMER,
  type OrchestratorContext,
  type StageDefinition,
  type StageResult,
} from './orchestrator/types';
import { cleanTestData } from './lib/clean-test-data';
import { NO_SKIP_POLICY_STATEMENT, resolveExhaustiveExecutionPolicy } from './lib/no-skip-policy';
import {
  applyExecutionIdentityEnv,
  archiveToHistory,
  beginQaExecution,
  persistExecutionIdentityToOrchestrator,
  type ExecutionIdentity,
} from './lib/qa-report/execution-archive';
import { generateMasterQaReport } from './reporting/generate-master-report';
import { writeReconciledOrchestratorSummary } from './orchestrator/reconcile-orchestrator-summary';
import { applyQaRuntimeEnv } from './lib/runtime-env';
import { ensurePlaywrightBrowsersInstalled } from './lib/ensure-playwright-browsers';

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

function stageEnv(url: string, identity?: ExecutionIdentity): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...websiteTargetEnv(url) };
  if (identity) applyExecutionIdentityEnv(identity, env);
  return env;
}

function discoveryArgs(url: string, extraArgs: string[]): string[] {
  const normalized = url.endsWith('/') ? url : `${url}/`;
  const passthrough = extraArgs.filter((arg) => arg.startsWith('--max-pages'));
  return [normalized, ...passthrough];
}

function isAuthorizeHeavyArg(arg: string): boolean {
  return arg === '--authorize-heavy' || arg.startsWith('--authorize-heavy=');
}

function childArgs(stage: StageDefinition, passthroughArgs: string[], extraArgs: string[], url: string): string[] {
  if (stage.key === 'discovery') return discoveryArgs(url, extraArgs);
  const merged = [...(stage.args ?? []), ...passthroughArgs];
  if (stage.key === 'performance') {
    return merged.filter((arg) => !isAuthorizeHeavyArg(arg));
  }
  return merged;
}

function childEnv(stage: StageDefinition, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (stage.key !== 'performance') return env;
  const next = { ...env };
  delete next.QA_PERF_AUTHORIZE;
  return next;
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

/** Allure, Playwright HTML index, then final markdown/JSON — always after earlier stages. */
function ensureReportingStages(input: {
  stages: StageDefinition[];
  results: StageResult[];
  ctx: OrchestratorContext;
  passthroughArgs: string[];
  extraArgs: string[];
  env: NodeJS.ProcessEnv;
  effectiveUrl: string;
  failFast: boolean;
}): void {
  for (const key of POST_EXECUTION_STAGE_KEYS) {
    if (input.results.some((row) => row.key === key)) continue;
    const stage = input.stages.find((row) => row.key === key);
    if (!stage) continue;

    const skipReason = stage.skip?.(input.ctx) ?? null;
    if (skipReason) {
      input.results.push(skippedResult(stage, skipReason));
      writeOrchestratorArtifacts({
        url: input.effectiveUrl,
        failFast: input.failFast,
        results: input.results,
      });
      continue;
    }

    logStep(`${stage.name} (always runs after execution — coverage / analyze / retest / reports)`);
    const result = runChildStage(stage, childArgs(stage, input.passthroughArgs, input.extraArgs, input.effectiveUrl), {
      env: childEnv(stage, input.env),
    });
    input.results.push(result);
    writeOrchestratorArtifacts({
      url: input.effectiveUrl,
      failFast: input.failFast,
      results: input.results,
    });
  }
}

async function main(): Promise<void> {
  applyQaRuntimeEnv(process.env);
  const startedAt = new Date();
  const { url: cliUrl, failFast, keepArtifacts, extraArgs } = parseOrchestratorCli();
  const config = loadConfig();
  persistCliWebsiteUrl(cliUrl);
  if (cliUrl) Object.assign(process.env, websiteTargetEnv(cliUrl));
  const identity = beginQaExecution({
    startedAt,
    testSuite: 'qa:all',
    baseUrlHint: cliUrl || process.env.QA_WEBSITE_URL || readLastTargetUrl() || config.urls.website,
  });
  applyExecutionIdentityEnv(identity);

  logStep(`${config.project.name} — qa:all orchestrator`);
  const browsers = ensurePlaywrightBrowsersInstalled();
  if (!browsers.installed) {
    logWarn(`Playwright browsers incomplete before stages: ${browsers.detail}`);
  } else if (browsers.missingBefore.length > 0) {
    logSuccess(`Playwright browsers ready: ${browsers.detail}`);
  }
  logStep(`Execution ID ${identity.executionId} (${identity.startTime} ${identity.timezone})`);
  console.log(ORCHESTRATOR_DISCLAIMER);
  const phasePlan = buildOrchestratorPhasePlan({ tests: config.tests });
  logStep('Orchestrator phases (11)');
  console.log(formatOrchestratorPhasesHeader(phasePlan));
  logStep('Universal QA flow (31 conceptual steps → existing stages)');
  console.log(formatUniversalQaFlowHeader());
  console.log(
    'Existing child stages still run (including dependencies, content, workflows, collect, and selected opt-in engines). ' +
      'UI performance and JMeter smoke share one liveness command (no --authorize-heavy).'
  );
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
    const { removed } = cleanTestData();
    logSuccess(
      removed.length === 0
        ? 'No previous run artifacts were present'
        : `Removed ${removed.length} previous artifact path(s)`
    );
  }
  persistExecutionIdentityToOrchestrator(identity);
  applyExecutionIdentityEnv(identity);

  await runSync();

  const url = resolveOrchestratorUrl({
    cliUrl,
    playwrightEnvUrl: process.env.QA_PLAYWRIGHT_BASE_URL,
    envUrl: process.env.QA_WEBSITE_URL,
    lastTargetUrl: readLastTargetUrl(),
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

  identity.baseUrl = effectiveUrl;
  persistExecutionIdentityToOrchestrator(identity);
  Object.assign(process.env, websiteTargetEnv(effectiveUrl));

  const ctx = buildContext(effectiveUrl, failFast, extraArgs);
  const stages = buildStages({ tests: config.tests });
  const results: StageResult[] = [];
  const env = stageEnv(effectiveUrl, identity);
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
            runChildStageAsync(groupStage, childArgs(groupStage, passthroughArgs, extraArgs, effectiveUrl), {
              env: childEnv(groupStage, env),
            })
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

    const result = runChildStage(stage, childArgs(stage, passthroughArgs, extraArgs, effectiveUrl), {
      env: childEnv(stage, env),
    });
    results.push(result);
    writeOrchestratorArtifacts({ url: effectiveUrl, failFast, results });

    const isReporting = (REPORTING_STAGE_KEYS as readonly string[]).includes(stage.key);
    if (failFast && failsFast(result.status) && !isReporting) {
      logError(`--fail-fast set; stopping execution after ${stage.name}`);
      break;
    }

    stageIndex += 1;
  }

  ensureReportingStages({
    stages,
    results,
    ctx,
    passthroughArgs,
    extraArgs,
    env,
    effectiveUrl,
    failFast,
  });

  const summary = collectResults({
    url: effectiveUrl,
    failFast,
    results,
    tests: config.tests,
    phasePlan,
    selection: phasePlan.selection,
  });
  const qualityGate = determineQualityGate({
    required: collectSuiteRollup(results).lines,
    qualityChecks: loadQualityChecksForGate(),
  });
  const rollup = applyQualityGateToRollup(collectSuiteRollup(results), qualityGate);

  if (fixtureClose) {
    await fixtureClose();
  }

  const archived = archiveToHistory({
    identity,
    endedAt: new Date(),
    overallStatus: qualityGate.status,
  });
  logSuccess(`History folder: ${archived.folderPath}`);
  logSuccess(`Execution metadata: ${archived.metadataPath}`);

  logStep('MASTER-QA-REPORT');
  const master = generateMasterQaReport({
    identity,
    folderPath: archived.folderPath,
  });
  logSuccess(`MASTER-QA-REPORT.html: ${master.htmlPath}`);
  logSuccess(`MASTER-QA-REPORT.json: ${master.jsonPath}`);

  // Refresh reconciled view from the just-completed 26-stage summary (never overwrite summary.json).
  const reconciled = writeReconciledOrchestratorSummary({ expectedStages: stages });
  logSuccess(
    `Reconciled orchestrator summary: ${PATHS.orchestratorReconciledSummary} (${reconciled.stages.length}/${reconciled.staleness.expectedStageCount} stages)`
  );
  if (reconciled.staleness.partial || reconciled.staleness.stale) {
    logWarn(reconciled.staleness.note);
  }

  logStep('Quality gate');
  console.log(formatQualityGateBanner(qualityGate));

  logStep('Orchestrator summary');
  console.log(`URL:     ${summary.url}`);
  console.log(`Execution: ${identity.executionId}`);
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
  logSuccess(`Universal QA flow: ${PATHS.orchestratorUniversalFlow}`);
  logSuccess(`Quality gate: ${PATHS.orchestratorQualityGate}`);
  console.log(rollup.banner);

  process.exit(summary.exitCode);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
