import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { runLocalBin } from './lib/run-command';
import { writeJson } from './discovery/write-json';
import {
  isPlaywrightBrowserInstalled,
  resolveCrossBrowserEngines,
  resolvePlaywrightBrowsers,
} from './lib/playwright-browsers';
import { loadConfig } from './lib/load-config';
import {
  ALL_PLAYWRIGHT_ENGINES,
  PLAYWRIGHT_ENGINE_CAVEATS,
  QA_PLAYWRIGHT_SUITE_ENV,
  playwrightSuiteHtmlDir,
  playwrightSuiteResultsPath,
} from './lib/playwright-suites';
import { completePlaywrightSuite, preparePlaywrightSuite } from './lib/playwright-suite-summary';
import { loadPlaywrightJsonReport } from './lib/playwright-results';
import { resolveConfiguredPlaywrightBaseUrl } from './lib/suite-origin';
import { printCoverageSummary, runCoverage } from './coverage/run-coverage';
import { copyCrossBrowserEvidence } from './cross-browser/evidence';
import {
  buildCrossBrowserMatrix,
  collectCrossBrowserFindings,
  summarizeMatrixRows,
} from './cross-browser/matrix';
import { renderCrossBrowserMatrixMarkdown } from './cross-browser/report';
import {
  CROSS_BROWSER_LIMITATIONS,
  playwrightPackageVersion,
  resolveEngineVersions,
} from './cross-browser/versions';

async function main(): Promise<void> {
  const config = loadConfig();
  const qaAllBrowsers = resolvePlaywrightBrowsers(config.playwright);
  const browsers = resolveCrossBrowserEngines();
  const targetUrl = process.env.QA_PLAYWRIGHT_BASE_URL || config.playwright.baseURL;
  const started = preparePlaywrightSuite({
    suiteName: 'cross-browser',
    targetUrl,
    configuredBaseUrl: resolveConfiguredPlaywrightBaseUrl(),
  });

  logStep('Cross-browser testing (Chromium / Firefox / WebKit — not iOS Safari / Android Chrome)');
  for (const line of CROSS_BROWSER_LIMITATIONS) {
    logWarn(line);
  }
  if (qaAllBrowsers.join(',') !== browsers.join(',')) {
    logWarn(
      `qa.config.json playwright.browsers is [${qaAllBrowsers.join(', ')}] for qa:all / e2e. This dedicated suite still launches ${browsers.join(', ')}.`
    );
  }

  fs.mkdirSync(PATHS.reports.crossBrowser, { recursive: true });
  fs.mkdirSync(path.join(PATHS.root, 'test-results', 'playwright', 'cross-browser'), { recursive: true });

  runLocalBin('playwright', ['install', ...browsers]);

  const missing = browsers.filter((browser) => !isPlaywrightBrowserInstalled(browser));
  const executableBrowsers = browsers.filter((browser) => !missing.includes(browser));
  const skippedBrowsers = missing.map((browser) => ({
    browser,
    reason: `Playwright browser binary not installed (${browser}) after playwright install`,
  }));

  if (missing.length > 0) {
    logError(`Missing Playwright engines after install: ${missing.join(', ')}`);
  }

  let resultStatus = 1;
  if (executableBrowsers.length > 0) {
    const args = ['test', '--grep', '@cross-browser'];
    for (const browser of executableBrowsers) {
      args.push(`--project=${browser}`);
    }
    // Dedicated 3-engine suite: serialize workers on Windows so two Firefox
    // processes do not hang on SWGL/context.close. Does not change assertions.
    if (process.platform === 'win32') {
      args.push('--workers=1');
    }

    const result = runLocalBin('playwright', args, {
      env: {
        ...process.env,
        [QA_PLAYWRIGHT_SUITE_ENV]: 'cross-browser',
      },
    });
    resultStatus = result.status ?? 1;
  }

  const versions = await resolveEngineVersions(browsers);
  const resultsFile = playwrightSuiteResultsPath('cross-browser');
  const report = loadPlaywrightJsonReport(resultsFile);
  const rows = buildCrossBrowserMatrix(report);
  const findings = collectCrossBrowserFindings(rows);
  const engineTotals = summarizeMatrixRows(rows);
  const evidenceFiles = copyCrossBrowserEvidence(rows, findings);
  const playwrightVersion = playwrightPackageVersion();
  const allEnginesExecuted = ALL_PLAYWRIGHT_ENGINES.every((engine) => executableBrowsers.includes(engine));
  const passed = resultStatus === 0 && allEnginesExecuted && findings.length === 0;

  const suiteSummary = completePlaywrightSuite(started, {
    passed,
    executedBrowsers: executableBrowsers,
    skippedBrowsers,
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    target: targetUrl,
    targetOrigin: suiteSummary.targetOrigin,
    originStatus: suiteSummary.originStatus,
    passed,
    playwrightVersion,
    browsers,
    executedBrowsers: executableBrowsers,
    skippedBrowsers,
    qaAllBrowsers,
    versions,
    engineTotals,
    engineSpecificFailureCount: findings.filter((row) => row.kind === 'engine-specific-failure').length,
    sharedFailureCount: findings.filter((row) => row.kind === 'shared-failure').length,
    resultsFile: playwrightSuiteResultsPath('cross-browser'),
    htmlReport: playwrightSuiteHtmlDir('cross-browser'),
    matrixFile: path.join(PATHS.reports.crossBrowser, 'matrix.md'),
    findingsFile: path.join(PATHS.reports.crossBrowser, 'findings.json'),
    evidenceDir: path.join(PATHS.reports.crossBrowser, 'evidence'),
    evidenceFiles,
    artifactsDir: path.join(PATHS.root, 'test-results', 'playwright', 'cross-browser'),
    engineCaveats: [...PLAYWRIGHT_ENGINE_CAVEATS],
    limitations: [...CROSS_BROWSER_LIMITATIONS],
    realDeviceTesting: false,
    deviceCloud: false,
    note: 'Playwright desktop engines only. WebKit is not iOS Safari. Chromium is not Android Chrome.',
  };

  writeJson(path.join(PATHS.reports.crossBrowser, 'summary.json'), summary);
  writeJson(path.join(PATHS.reports.crossBrowser, 'findings.json'), {
    generatedAt: new Date().toISOString(),
    target: targetUrl,
    testingMode: 'playwright-desktop-engines',
    realDeviceTesting: false,
    deviceCloud: false,
    limitations: [...CROSS_BROWSER_LIMITATIONS],
    versions,
    findings,
    matrix: rows,
  });
  fs.writeFileSync(
    path.join(PATHS.reports.crossBrowser, 'matrix.md'),
    renderCrossBrowserMatrixMarkdown({
      target: targetUrl,
      passed,
      versions,
      playwrightVersion,
      rows,
      findings,
      engineTotals,
    }),
    'utf8'
  );

  if (passed) logSuccess('Cross-browser checks passed on Chromium, Firefox, and WebKit (engines — not real devices)');
  else logError('Cross-browser checks failed — see reports/cross-browser/matrix.md and reports/playwright/cross-browser/');

  if (fs.existsSync(PATHS.pageMapFile) || fs.existsSync(resultsFile)) {
    logStep('Updating coverage from cross-browser execution evidence');
    printCoverageSummary(runCoverage());
  }

  if (!passed) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
