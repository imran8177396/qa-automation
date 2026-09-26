import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { runLocalBin } from '../lib/run-command';
import { DEFAULT_FIXTURE_PORT, ensureFixtureChildProcess } from '../testing/serve-fixture-site';
import { resolveUiTarget } from '../lib/ui-target';
import { applyCliWebsiteTarget } from '../lib/suite-origin';
import {
  classifyCompulsoryPlaywrightBrowsers,
  playwrightProjectArgs,
  resolvePlaywrightBrowsers,
} from '../lib/playwright-browsers';
import type { QaConfig } from '../types';
import { planUiPerformanceChecks } from './ui-applicability';
import { loadUiTimingEvidence, uiPerformanceWorkDir, writeUiPerformanceSummary } from './ui-evidence';
import { resolveUiPerformancePage, resolveUiPerformancePages } from './ui-pages';
import type { UiPerformanceSummary } from './types';

function notExecuted(reason: string, extras: Partial<UiPerformanceSummary> = {}): UiPerformanceSummary {
  return {
    ranAt: new Date().toISOString(),
    source: 'playwright-ui',
    label: 'Playwright UI page / navigation / resource timing',
    separateFromJmeter: true,
    separateFromLighthouse: true,
    status: 'NOT_EXECUTED',
    skipReason: reason,
    pageSource: extras.pageSource ?? null,
    target: extras.target ?? null,
    httpStatus: extras.httpStatus ?? null,
    measurement: extras.measurement ?? null,
    applicability: extras.applicability ?? planUiPerformanceChecks(),
    thresholds: extras.thresholds ?? {
      status: 'NOT_AVAILABLE',
      defined: false,
      note: reason,
    },
  };
}

export async function runUiPerformance(_config: QaConfig): Promise<boolean> {
  applyCliWebsiteTarget();
  logStep('Playwright UI performance — page load / navigation / resource timing (not JMeter)');

  const target = resolveUiTarget();
  const pages = resolveUiPerformancePages();
  const page = resolveUiPerformancePage();
  const applicability = planUiPerformanceChecks();

  if (!page) {
    const summary = notExecuted('No UI page was resolved for Playwright timing. Measurements were not invented.', {
      applicability,
      pageSource: pages.source,
    });
    writeUiPerformanceSummary(summary);
    logWarn(summary.skipReason ?? 'NOT_EXECUTED');
    return true;
  }

  const configPath = path.join(PATHS.root, 'playwright.performance.config.ts');
  if (!fs.existsSync(configPath)) {
    const summary = notExecuted('playwright.performance.config.ts is missing. UI timings were not collected.', {
      applicability,
      pageSource: pages.source,
      target: page.url,
    });
    writeUiPerformanceSummary(summary);
    logWarn(summary.skipReason ?? 'NOT_EXECUTED');
    return false;
  }

  fs.mkdirSync(PATHS.reports.performance, { recursive: true });
  fs.mkdirSync(uiPerformanceWorkDir(), { recursive: true });

  let server: { close: () => Promise<void> } | null = null;
  let playwrightPassed = false;
  try {
    if (target.isLoopback) {
      server = await ensureFixtureChildProcess(DEFAULT_FIXTURE_PORT);
      if (!server) {
        logWarn(`Fixture port ${DEFAULT_FIXTURE_PORT} already in use — assuming the UI performance target is running`);
      }
    } else {
      logStep(`UI performance target is live origin ${target.origin} — fixture site is not substituted`);
    }

    const requestedBrowsers = resolvePlaywrightBrowsers(_config.playwright);
    runLocalBin('playwright', ['install', ...requestedBrowsers]);
    const classified = classifyCompulsoryPlaywrightBrowsers(requestedBrowsers);
    if (classified.skippedBrowsers.length > 0) {
      logError(
        `Missing Playwright engines after install: ${classified.skippedBrowsers.map((row) => row.browser).join(', ')}`
      );
    }
    const result =
      classified.executableBrowsers.length === 0
        ? { status: 1 }
        : runLocalBin(
            'playwright',
            ['test', `--config=${configPath}`, ...playwrightProjectArgs(classified.executableBrowsers)],
            {
              env: {
                ...process.env,
                QA_PLAYWRIGHT_BASE_URL: target.url,
                QA_PLAYWRIGHT_HEADLESS: process.env.QA_PLAYWRIGHT_HEADLESS ?? 'true',
              },
            }
          );
    playwrightPassed = result.status === 0 && classified.skippedBrowsers.length === 0;
  } finally {
    await server?.close();
  }

  const measurement = loadUiTimingEvidence();
  if (!measurement) {
    const summary = notExecuted(
      playwrightPassed
        ? 'Playwright UI timing finished without writing evidence. Measurements were not invented.'
        : 'Playwright UI timing did not produce evidence (spec failed or did not run). Measurements were not invented.',
      { applicability, pageSource: pages.source, target: page.url }
    );
    writeUiPerformanceSummary(summary);
    if (playwrightPassed) {
      logWarn(summary.skipReason ?? 'NOT_EXECUTED');
      return true;
    }
    logError(summary.skipReason ?? 'Playwright UI timing failed');
    return false;
  }

  const summary: UiPerformanceSummary = {
    ranAt: new Date().toISOString(),
    source: 'playwright-ui',
    label: 'Playwright UI page / navigation / resource timing',
    separateFromJmeter: true,
    separateFromLighthouse: true,
    status: 'RECORDED',
    skipReason: null,
    pageSource: pages.source,
    target: measurement.url,
    httpStatus: measurement.httpStatus,
    measurement,
    applicability,
    thresholds: {
      status: 'RECORDED',
      defined: false,
      note: 'qa.config.json does not define Playwright UI timing SLAs. Measurements are RECORDED, not PASS. Lighthouse CWV scores are a separate artifact.',
    },
  };
  writeUiPerformanceSummary(summary);
  logSuccess(
    `UI timing RECORDED for ${measurement.pageName} — TTFB ${
      measurement.navigation?.ttfbMs == null ? 'NOT_AVAILABLE' : `${Math.round(measurement.navigation.ttfbMs)} ms`
    }, XHR/fetch ${measurement.xhrOrFetchCount}`
  );
  return playwrightPassed;
}
