import path from 'path';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess } from './lib/logger';
import { runLocalBin } from './lib/run-command';
import { writeJson } from './discovery/write-json';
import { resolvePlaywrightBrowsers } from './lib/playwright-browsers';
import { loadConfig } from './lib/load-config';
import {
  ALL_PLAYWRIGHT_ENGINES,
  PLAYWRIGHT_ENGINE_CAVEATS,
  QA_PLAYWRIGHT_SUITE_ENV,
  playwrightSuiteResultsPath,
} from './lib/playwright-suites';
import { completePlaywrightSuite, preparePlaywrightSuite } from './lib/playwright-suite-summary';

async function main(): Promise<void> {
  const config = loadConfig();
  const browsers = resolvePlaywrightBrowsers(config.playwright);
  const targetUrl = process.env.QA_PLAYWRIGHT_BASE_URL || config.playwright.baseURL;
  const started = preparePlaywrightSuite({
    suiteName: 'cross-browser',
    targetUrl,
    configuredBaseUrl: config.playwright.baseURL,
  });

  logStep('Cross-browser testing (Chromium / Firefox / WebKit — not iOS Safari / Android Chrome)');

  runLocalBin('playwright', ['install', ...browsers]);

  const args = ['test', '--grep', '@cross-browser'];
  for (const browser of browsers) {
    args.push(`--project=${browser}`);
  }

  const skippedBrowsers = ALL_PLAYWRIGHT_ENGINES.filter((browser) => !browsers.includes(browser)).map((browser) => ({
    browser,
    reason: 'not listed in qa.config.json playwright.browsers',
  }));

  const result = runLocalBin('playwright', args, {
    env: {
      ...process.env,
      [QA_PLAYWRIGHT_SUITE_ENV]: 'cross-browser',
    },
  });

  const suiteSummary = completePlaywrightSuite(started, {
    passed: result.status === 0,
    executedBrowsers: browsers,
    skippedBrowsers,
  });

  writeJson(path.join(PATHS.reports.crossBrowser, 'summary.json'), {
    generatedAt: new Date().toISOString(),
    target: targetUrl,
    targetOrigin: suiteSummary.targetOrigin,
    originStatus: suiteSummary.originStatus,
    passed: result.status === 0,
    browsers,
    resultsFile: playwrightSuiteResultsPath('cross-browser'),
    engineCaveats: [...PLAYWRIGHT_ENGINE_CAVEATS],
    note: 'WebKit is not iOS Safari. Chromium is not Android Chrome.',
  });

  if (result.status === 0) logSuccess('Cross-browser checks passed');
  else logError('Cross-browser checks failed — see reports/playwright/cross-browser/');

  process.exit(result.status === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
