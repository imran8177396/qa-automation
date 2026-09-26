import { readJsonIfExists } from '../discovery/write-json';
import { resolveGeneratedCheckPlan } from '../lib/generated-check-plan';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { PATHS } from '../lib/paths';
import {
  classifyCompulsoryPlaywrightBrowsers,
  playwrightProjectArgs,
  resolvePlaywrightBrowsers,
  type PlaywrightBrowser,
} from '../lib/playwright-browsers';
import { runLocalBin } from '../lib/run-command';
import { QA_PLAYWRIGHT_SUITE_ENV, type PlaywrightSuiteName } from '../lib/playwright-suites';
import {
  completePlaywrightSuite,
  preparePlaywrightSuite,
  recordPlaywrightSuiteNotExecuted,
} from '../lib/playwright-suite-summary';
import { applyCliWebsiteTarget, resolveConfiguredPlaywrightBaseUrl } from '../lib/suite-origin';
import type { QaConfig } from '../types';

export interface RunPlaywrightOptions {
  /** Passed through as `--grep`, e.g. '@generated' to run only discovery-generated checks. */
  grep?: string;
  grepInvert?: string;
  suiteName?: PlaywrightSuiteName;
  browsers?: PlaywrightBrowser[];
}

export async function runPlaywright(config: QaConfig, options?: RunPlaywrightOptions): Promise<boolean> {
  if (!config.playwright.enabled) {
    logWarn('Playwright step skipped (disabled in qa.config.json).');
    return true;
  }

  const targetUrl = applyCliWebsiteTarget();
  const suiteName: PlaywrightSuiteName =
    options?.suiteName ?? (options?.grep === '@generated' ? 'generated-check' : 'e2e');
  const requestedBrowsers = options?.browsers ?? resolvePlaywrightBrowsers(config.playwright);

  const headed = process.argv.includes('--headed');
  const debug = process.argv.includes('--debug');

  const started = preparePlaywrightSuite({
    suiteName,
    targetUrl,
    configuredBaseUrl: resolveConfiguredPlaywrightBaseUrl(),
  });

  logStep(`E2E tests (Playwright) — suite ${suiteName} — ${requestedBrowsers.join(', ')}`);

  runLocalBin('playwright', ['install', ...requestedBrowsers]);

  const classified = classifyCompulsoryPlaywrightBrowsers(requestedBrowsers);
  const { executableBrowsers, skippedBrowsers } = classified;

  if (skippedBrowsers.length > 0) {
    logError(
      `Missing Playwright engines after install: ${skippedBrowsers.map((row) => row.browser).join(', ')}`
    );
  }

  if (executableBrowsers.length === 0) {
    completePlaywrightSuite(started, {
      passed: false,
      executedBrowsers: [],
      skippedBrowsers,
    });
    logWarn(`No Playwright browsers were available for suite ${suiteName}.`);
    return false;
  }

  const args = ['test'];

  if (headed) {
    args.push('--headed');
  }

  if (debug) {
    args.push('--debug');
  }

  if (options?.grep) {
    args.push('--grep', options.grep);
  }

  if (options?.grepInvert) {
    args.push('--grep-invert', options.grepInvert);
  }

  args.push(...playwrightProjectArgs(executableBrowsers));

  const result = runLocalBin('playwright', args, {
    env: {
      ...process.env,
      QA_PLAYWRIGHT_HEADLESS: headed ? 'false' : String(config.playwright.headless),
      [QA_PLAYWRIGHT_SUITE_ENV]: suiteName,
      QA_PLAYWRIGHT_BASE_URL: targetUrl,
    },
  });

  const passed = result.status === 0 && skippedBrowsers.length === 0;

  completePlaywrightSuite(started, {
    passed,
    executedBrowsers: executableBrowsers,
    skippedBrowsers,
  });

  if (passed) {
    logSuccess(`Playwright suite ${suiteName} passed on: ${executableBrowsers.join(', ')}`);
    return true;
  }

  return false;
}

export async function runGeneratedCheckSuite(config: QaConfig): Promise<boolean> {
  if (!config.playwright.enabled) {
    logWarn('Playwright generated-check skipped (disabled in qa.config.json).');
    return true;
  }

  const raw = readJsonIfExists<unknown>(PATHS.plannedChecksFile);
  const plan = resolveGeneratedCheckPlan(raw);
  if (!plan.execute) {
    const reason = plan.reason ?? 'NOT_EXECUTED: 0 generated checks.';
    logWarn(reason);
    const started = preparePlaywrightSuite({
      suiteName: 'generated-check',
      targetUrl: resolveConfiguredPlaywrightBaseUrl(),
      configuredBaseUrl: resolveConfiguredPlaywrightBaseUrl(),
    });
    recordPlaywrightSuiteNotExecuted(started, { reason });
    return true;
  }

  return runPlaywright(config, {
    suiteName: 'generated-check',
    grep: '@generated',
  });
}

export async function runE2eAndGeneratedCheck(config: QaConfig): Promise<boolean> {
  const e2ePassed = await runPlaywright(config, {
    suiteName: 'e2e',
    grepInvert: '@generated',
  });
  const generatedPassed = await runGeneratedCheckSuite(config);
  return e2ePassed && generatedPassed;
}
