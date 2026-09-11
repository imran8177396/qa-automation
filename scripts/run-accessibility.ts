import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { runLocalBin } from './lib/run-command';
import { writeJson } from './discovery/write-json';
import { DEFAULT_FIXTURE_PORT, ensureFixtureChildProcess } from './testing/serve-fixture-site';
import { resolveUiTarget } from './lib/ui-target';
import { resolveAccessibilityRoutes } from './accessibility/routes';
import { A11Y_DISCLAIMER, A11Y_LIMITATIONS, type AccessibilitySummary } from './accessibility/types';
import { loadConfig } from './lib/load-config';
import { ALL_PLAYWRIGHT_ENGINES, QA_PLAYWRIGHT_SUITE_ENV, playwrightSuiteResultsPath } from './lib/playwright-suites';
import { completePlaywrightSuite, preparePlaywrightSuite } from './lib/playwright-suite-summary';

const A11Y_SKIPPED_BROWSERS = [
  { browser: 'firefox' as const, reason: 'accessibility suite runs axe/keyboard checks on Chromium only' },
  { browser: 'webkit' as const, reason: 'accessibility suite runs axe/keyboard checks on Chromium only' },
];

async function main(): Promise<void> {
  const config = loadConfig();
  const target = resolveUiTarget(config);
  const routes = resolveAccessibilityRoutes();
  const started = preparePlaywrightSuite({
    suiteName: 'accessibility',
    targetUrl: target.url,
    configuredBaseUrl: config.playwright.baseURL,
  });
  logStep('Accessibility testing (automated — not a complete WCAG audit)');
  fs.mkdirSync(PATHS.reports.accessibility, { recursive: true });
  const configPath = path.join(PATHS.root, 'playwright.accessibility.config.ts');

  if (!fs.existsSync(configPath)) {
    completePlaywrightSuite(started, {
      passed: false,
      executedBrowsers: [],
      skippedBrowsers: ALL_PLAYWRIGHT_ENGINES.map((browser) => ({
        browser,
        reason: 'playwright.accessibility.config.ts is missing',
      })),
    });
    logWarn('Accessibility config missing — recorded BLOCKED.');
    process.exit(1);
  }

  let server: { close: () => Promise<void> } | null = null;
  let exitCode = 1;
  try {
    if (target.isLoopback) {
      server = await ensureFixtureChildProcess(DEFAULT_FIXTURE_PORT);
      if (!server) {
        logWarn(`Fixture port ${DEFAULT_FIXTURE_PORT} already in use — assuming the accessibility target is running`);
      }
    } else {
      logStep(`Accessibility suite target is live origin ${target.origin} — fixture site is not substituted`);
    }

    runLocalBin('playwright', ['install', 'chromium']);
    const result = runLocalBin('playwright', ['test', `--config=${configPath}`], {
      env: {
        ...process.env,
        QA_PLAYWRIGHT_BASE_URL: target.url,
        [QA_PLAYWRIGHT_SUITE_ENV]: 'accessibility',
      },
    });

    completePlaywrightSuite(started, {
      passed: result.status === 0,
      executedBrowsers: ['chromium'],
      skippedBrowsers: A11Y_SKIPPED_BROWSERS,
    });

    const summary: AccessibilitySummary = {
      generatedAt: new Date().toISOString(),
      target: target.url,
      passed: result.status === 0,
      pagesAnalyzed: routes.length,
      violationCount: result.status === 0 ? 0 : 1,
      incompleteCount: 0,
      byImpact: { critical: 0, serious: result.status === 0 ? 0 : 1, moderate: 0, minor: 0, info: 0 },
      findings: [],
      disclaimer: A11Y_DISCLAIMER,
      limitations: [...A11Y_LIMITATIONS],
      resultsFile: playwrightSuiteResultsPath('accessibility'),
    };
    writeJson(path.join(PATHS.reports.accessibility, 'summary.json'), summary);

    if (result.status === 0) logSuccess('Accessibility checks passed');
    else logError('Accessibility checks failed');
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
