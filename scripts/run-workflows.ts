import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { runLocalBin } from './lib/run-command';
import { writeJson } from './discovery/write-json';
import { buildWorkflowExecutionPlan } from './correlation/execution-plan';
import {
  buildWorkflowEvidenceReport,
  recordRuntimeCorrelation,
  resetWorkflowEvidenceWorkDir,
  writeWorkflowEvidenceReport,
} from './correlation/evidence';
import { runFixtureCorrelationSelfCheck } from './correlation/fixture-self-check';
import { loadConfig } from './lib/load-config';
import { DEFAULT_FIXTURE_PORT, ensureFixtureChildProcess } from './testing/serve-fixture-site';
import { resolveUiTarget } from './lib/ui-target';
import { QA_PLAYWRIGHT_SUITE_ENV, playwrightSuiteResultsPath } from './lib/playwright-suites';
import { completePlaywrightSuite, preparePlaywrightSuite } from './lib/playwright-suite-summary';
import { resolveConfiguredPlaywrightBaseUrl } from './lib/suite-origin';

const WORKFLOW_SKIPPED_BROWSERS = [
  { browser: 'firefox' as const, reason: 'workflow suite runs on Chromium only' },
  { browser: 'webkit' as const, reason: 'workflow suite runs on Chromium only' },
];

async function main(): Promise<void> {
  const config = loadConfig();
  const plan = buildWorkflowExecutionPlan(config);
  const target = resolveUiTarget(config);
  const configPath = path.join(PATHS.root, 'playwright.workflows.config.ts');
  const started = preparePlaywrightSuite({
    suiteName: 'workflows',
    targetUrl: target.url,
    configuredBaseUrl: resolveConfiguredPlaywrightBaseUrl(),
  });

  logStep('Combined UI+API workflow checks');
  logWarn(plan.note);
  fs.mkdirSync(PATHS.reports.workflows, { recursive: true });
  resetWorkflowEvidenceWorkDir();

  if (!fs.existsSync(configPath)) {
    logError('playwright.workflows.config.ts is missing.');
    process.exit(1);
  }

  let server: Awaited<ReturnType<typeof ensureFixtureChildProcess>> = null;
  let exitCode = 1;
  try {
    if (target.isLoopback) {
      server = await ensureFixtureChildProcess(DEFAULT_FIXTURE_PORT);
      if (!server) {
        logWarn(`Fixture port ${DEFAULT_FIXTURE_PORT} already in use — assuming the workflow target is running`);
      }
    } else {
      logStep(`Workflow suite target is live origin ${target.origin} — fixture site is not substituted`);
    }

    runLocalBin('playwright', ['install', 'chromium']);
    const result = runLocalBin('playwright', ['test', `--config=${configPath}`], {
      env: {
        ...process.env,
        QA_PLAYWRIGHT_BASE_URL: target.url,
        QA_API_URL: config.urls.api,
        [QA_PLAYWRIGHT_SUITE_ENV]: 'workflows',
      },
    });

    const fixtureEvidence = await runFixtureCorrelationSelfCheck();
    recordRuntimeCorrelation(fixtureEvidence);
    logStep(
      `Framework self-check ${fixtureEvidence.status}: ${fixtureEvidence.request?.method ?? ''} ${fixtureEvidence.request?.url ?? fixtureEvidence.reason ?? ''}`.trim()
    );

    const evidence = writeWorkflowEvidenceReport(
      buildWorkflowEvidenceReport({
        target: target.url,
        plan,
        applicability: plan.applicability,
      })
    );

    const suiteSummary = completePlaywrightSuite(started, {
      passed: result.status === 0,
      executedBrowsers: ['chromium'],
      skippedBrowsers: WORKFLOW_SKIPPED_BROWSERS,
    });

    const recorded = [...plan.executable, ...plan.gated];
    const correlatedExecuted = plan.executable.filter((row) => row.kind === 'correlated').length;
    writeJson(path.join(PATHS.reports.workflows, 'summary.json'), {
      generatedAt: new Date().toISOString(),
      target: target.url,
      targetOrigin: suiteSummary.targetOrigin,
      originStatus: suiteSummary.originStatus,
      passed: result.status === 0 && fixtureEvidence.status !== 'FAIL',
      resultsFile: playwrightSuiteResultsPath('workflows'),
      evidenceFile: evidence.evidenceFile,
      findingsFile: evidence.findingsFile,
      correlationUsed: evidence.correlationUsed,
      correlatedExecuted,
      discoveredXhrCount: plan.applicability.discoveredXhrCount,
      documentedPairCount: plan.applicability.documentedPairCount,
      suitesRemainSeparate: evidence.suitesRemainSeparate,
      workflows: recorded.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        status: row.id === fixtureEvidence.id ? fixtureEvidence.status : row.status,
        reason: row.id === fixtureEvidence.id ? fixtureEvidence.note ?? row.reason : row.reason,
        uiPath: row.uiPath,
        api: row.apiMethod && row.apiPath ? `${row.apiMethod} ${row.apiPath}` : undefined,
        request: row.id === fixtureEvidence.id ? fixtureEvidence.request : undefined,
        uiAssertion: row.id === fixtureEvidence.id ? fixtureEvidence.uiAssertion : undefined,
      })),
      note: plan.note,
    });

    if (result.status === 0 && fixtureEvidence.status !== 'FAIL') {
      logSuccess('Workflow checks recorded (correlated + inferred + N/A reasons; gated items are not silent skips)');
    } else {
      logError('Workflow checks failed');
    }
    exitCode = result.status === 0 && fixtureEvidence.status !== 'FAIL' ? 0 : 1;
  } finally {
    await server?.close();
  }
  process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
