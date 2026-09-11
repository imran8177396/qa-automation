import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { runLocalBin } from './lib/run-command';
import { writeJson } from './discovery/write-json';
import { DEFAULT_FIXTURE_PORT, ensureFixtureChildProcess } from './testing/serve-fixture-site';
import { resolveUiTarget } from './lib/ui-target';
import { printCoverageSummary, runCoverage } from './coverage/run-coverage';
import { resolveVisualCli } from './visual/cli';
import { loadConfig } from './lib/load-config';
import { QA_PLAYWRIGHT_SUITE_ENV, playwrightSuiteHtmlDir, playwrightSuiteResultsPath } from './lib/playwright-suites';
import { completePlaywrightSuite, preparePlaywrightSuite } from './lib/playwright-suite-summary';

const VISUAL_SKIPPED_BROWSERS = [
  { browser: 'firefox' as const, reason: 'visual suite is chromium-only; pixel comparison is not a stable cross-engine signal' },
  { browser: 'webkit' as const, reason: 'visual suite is chromium-only; pixel comparison is not a stable cross-engine signal' },
];

async function main(): Promise<void> {
  const cli = resolveVisualCli(process.argv);
  const config = loadConfig();
  const target = resolveUiTarget(config);
  const started = preparePlaywrightSuite({
    suiteName: 'visual',
    targetUrl: target.url,
    configuredBaseUrl: config.playwright.baseURL,
  });

  if (cli.updateBaselines) {
    logWarn('Baseline update approved — Playwright will write visual-baselines/. This is not the default compare path.');
  } else {
    logStep('Visual comparison (baselines are read-only unless you run test:visual:update)');
  }

  fs.mkdirSync(PATHS.reports.visual, { recursive: true });
  fs.mkdirSync(path.join(PATHS.root, 'test-results', 'visual'), { recursive: true });
  fs.mkdirSync(PATHS.visualBaselinesDir, { recursive: true });

  runLocalBin('playwright', ['install', 'chromium']);

  let server: Awaited<ReturnType<typeof ensureFixtureChildProcess>> = null;
  if (target.isLoopback) {
    server = await ensureFixtureChildProcess(DEFAULT_FIXTURE_PORT);
    if (server) logSuccess(`Fixture site listening at ${server.url} (child process)`);
    else logWarn(`Fixture port ${DEFAULT_FIXTURE_PORT} already in use — assuming the visual target is running`);
  } else {
    logStep(`Visual suite target is live origin ${target.origin} — fixture site is not substituted`);
  }

  let passed = false;
  try {
    const args = ['test', `--config=${path.join(PATHS.root, 'playwright.visual.config.ts')}`];
    if (cli.updateBaselines) {
      args.push('--update-snapshots');
    }
    args.push(...cli.extraArgs);

    const result = runLocalBin('playwright', args, {
      env: {
        ...process.env,
        QA_PLAYWRIGHT_BASE_URL: target.url,
        QA_PLAYWRIGHT_HEADLESS: process.env.QA_PLAYWRIGHT_HEADLESS ?? 'true',
        [QA_PLAYWRIGHT_SUITE_ENV]: 'visual',
      },
    });
    passed = result.status === 0;
  } finally {
    if (server) await server.close();
  }

  const suiteSummary = completePlaywrightSuite(started, {
    passed,
    executedBrowsers: ['chromium'],
    skippedBrowsers: VISUAL_SKIPPED_BROWSERS,
  });
  writeJson(path.join(PATHS.reports.visual, 'summary.json'), {
    generatedAt: new Date().toISOString(),
    target: target.url,
    targetOrigin: suiteSummary.targetOrigin,
    originStatus: suiteSummary.originStatus,
    updateBaselines: cli.updateBaselines,
    passed,
    resultsFile: playwrightSuiteResultsPath('visual'),
    htmlReport: playwrightSuiteHtmlDir('visual'),
    artifactsDir: path.join(PATHS.root, 'test-results', 'visual'),
    baselinesDir: PATHS.visualBaselinesDir,
    note: cli.updateBaselines
      ? 'Baselines were rewritten because --approve-baseline-update was passed.'
      : target.isLoopback
        ? 'Mismatches are failures. They are not written back to visual-baselines/. Target is the local fixture.'
        : 'Mismatches are failures. Live origin was used — the local fixture was not substituted. Missing live baselines are FAIL, not a skip.',
  });

  if (passed) logSuccess('Visual tests matched committed baselines');
  else logError('Visual tests failed — see reports/visual/ and test-results/visual/ (baselines were not updated)');

  if (fs.existsSync(PATHS.pageMapFile) || fs.existsSync(playwrightSuiteResultsPath('visual'))) {
    logStep('Updating coverage from visual execution evidence');
    printCoverageSummary(runCoverage());
  }

  if (!passed) process.exit(1);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
