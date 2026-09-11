import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { runLocalBin } from './lib/run-command';
import { writeJson } from './discovery/write-json';
import { buildWorkflowExecutionPlan } from './correlation/execution-plan';
import { loadConfig } from './lib/load-config';
import { DEFAULT_FIXTURE_PORT, ensureFixtureChildProcess } from './testing/serve-fixture-site';
import { resolveUiTarget } from './lib/ui-target';
import { QA_PLAYWRIGHT_SUITE_ENV, playwrightSuiteResultsPath } from './lib/playwright-suites';
import { completePlaywrightSuite, preparePlaywrightSuite } from './lib/playwright-suite-summary';

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
    configuredBaseUrl: config.playwright.baseURL,
  });

  logStep('Combined UI+API workflow checks');
  logWarn(plan.note);
  fs.mkdirSync(PATHS.reports.workflows, { recursive: true });

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

    const suiteSummary = completePlaywrightSuite(started, {
      passed: result.status === 0,
      executedBrowsers: ['chromium'],
      skippedBrowsers: WORKFLOW_SKIPPED_BROWSERS,
    });

    const recorded = [...plan.executable, ...plan.gated];
    writeJson(path.join(PATHS.reports.workflows, 'summary.json'), {
      generatedAt: new Date().toISOString(),
      target: target.url,
      targetOrigin: suiteSummary.targetOrigin,
      originStatus: suiteSummary.originStatus,
      passed: result.status === 0,
      resultsFile: playwrightSuiteResultsPath('workflows'),
      workflows: recorded.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        status: row.status,
        reason: row.reason,
        uiPath: row.uiPath,
        api: row.apiMethod && row.apiPath ? `${row.apiMethod} ${row.apiPath}` : undefined,
      })),
      note: plan.note,
    });

    if (result.status === 0) logSuccess('Workflow checks recorded (correlated + inferred; gated items are not silent skips)');
    else logError('Workflow checks failed');
    exitCode = result.status === 0 ? 0 : 1;
  } finally {
    await server?.close();
  }
  process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
