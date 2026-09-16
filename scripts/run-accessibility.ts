import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { runLocalBin } from './lib/run-command';
import { writeJson } from './discovery/write-json';
import { DEFAULT_FIXTURE_PORT, ensureFixtureChildProcess } from './testing/serve-fixture-site';
import { resolveUiTarget } from './lib/ui-target';
import { resolveAccessibilityPages } from './accessibility/pages';
import { planAccessibilityChecks } from './accessibility/applicability';
import {
  accessibilityAxeDir,
  accessibilityFindingsDir,
  axePagesToFindings,
  collectAxePages,
  copyAccessibilityEvidence,
  loadCheckFindings,
  renderFindingsMarkdown,
} from './accessibility/findings';
import {
  A11Y_DISCLAIMER,
  A11Y_LIMITATIONS,
  A11Y_TESTING_MODE,
  type AccessibilityFinding,
  type AccessibilityImpact,
  type AccessibilitySummary,
} from './accessibility/types';
import { loadConfig } from './lib/load-config';
import { ALL_PLAYWRIGHT_ENGINES, QA_PLAYWRIGHT_SUITE_ENV, playwrightSuiteResultsPath } from './lib/playwright-suites';
import { completePlaywrightSuite, preparePlaywrightSuite } from './lib/playwright-suite-summary';
import { resolveConfiguredPlaywrightBaseUrl } from './lib/suite-origin';
import { printCoverageSummary, runCoverage } from './coverage/run-coverage';

const A11Y_SKIPPED_BROWSERS = [
  { browser: 'firefox' as const, reason: 'accessibility suite runs axe/keyboard checks on Chromium only' },
  { browser: 'webkit' as const, reason: 'accessibility suite runs axe/keyboard checks on Chromium only' },
];

function emptyImpact(): Record<AccessibilityImpact, number> {
  return { critical: 0, serious: 0, moderate: 0, minor: 0, info: 0 };
}

function countByImpact(findings: AccessibilityFinding[]): Record<AccessibilityImpact, number> {
  const byImpact = emptyImpact();
  for (const row of findings.filter((item) => item.status === 'FAIL')) {
    byImpact[row.impact] += 1;
  }
  return byImpact;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const target = resolveUiTarget(config);
  const pages = resolveAccessibilityPages();
  const applicability = planAccessibilityChecks();
  const started = preparePlaywrightSuite({
    suiteName: 'accessibility',
    targetUrl: target.url,
    configuredBaseUrl: resolveConfiguredPlaywrightBaseUrl(),
  });
  logStep('Accessibility testing (automated — not a complete WCAG audit)');
  logWarn(A11Y_DISCLAIMER);
  logWarn(A11Y_TESTING_MODE);

  fs.mkdirSync(PATHS.reports.accessibility, { recursive: true });
  fs.mkdirSync(path.join(PATHS.root, 'test-results', 'accessibility'), { recursive: true });
  fs.rmSync(accessibilityFindingsDir(), { recursive: true, force: true });
  fs.rmSync(accessibilityAxeDir(), { recursive: true, force: true });
  fs.mkdirSync(accessibilityFindingsDir(), { recursive: true });
  fs.mkdirSync(accessibilityAxeDir(), { recursive: true });

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
  let playwrightPassed = false;
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
    playwrightPassed = result.status === 0;
  } finally {
    await server?.close();
  }

  const axePages = collectAxePages();
  const checkFindings = loadCheckFindings();
  const axeFindings = axePagesToFindings(axePages);
  const findings = [...axeFindings, ...checkFindings];
  const violationCount = axePages.reduce((sum, page) => sum + page.violations.length, 0);
  const incompleteCount = axePages.reduce((sum, page) => sum + page.incomplete.length, 0);
  const checkFails = checkFindings.filter((row) => row.status === 'FAIL');
  const passed = playwrightPassed && violationCount === 0 && checkFails.length === 0;
  const evidenceFiles = copyAccessibilityEvidence();

  completePlaywrightSuite(started, {
    passed,
    executedBrowsers: ['chromium'],
    skippedBrowsers: A11Y_SKIPPED_BROWSERS,
  });

  const structured = {
    generatedAt: new Date().toISOString(),
    target: target.url,
    testingMode: A11Y_TESTING_MODE,
    disclaimer: A11Y_DISCLAIMER,
    limitations: [...A11Y_LIMITATIONS],
    url: target.url,
    pages: axePages,
    violations: axePages.flatMap((page) => page.violations.map((row) => ({ ...row, url: page.url }))),
    findings,
    applicability,
  };
  writeJson(path.join(PATHS.reports.accessibility, 'findings.json'), structured);
  writeJson(path.join(PATHS.reports.accessibility, 'results.json'), structured);
  writeJson(path.join(PATHS.reports.accessibility, 'applicability.json'), {
    generatedAt: new Date().toISOString(),
    target: target.url,
    testingMode: A11Y_TESTING_MODE,
    disclaimer: A11Y_DISCLAIMER,
    checks: applicability,
  });
  fs.writeFileSync(
    path.join(PATHS.reports.accessibility, 'findings.md'),
    renderFindingsMarkdown({ target: target.url, passed, pages: axePages, findings }),
    'utf8'
  );

  const summary: AccessibilitySummary = {
    generatedAt: new Date().toISOString(),
    target: target.url,
    passed,
    pagesAnalyzed: pages.length,
    violationCount,
    incompleteCount,
    byImpact: countByImpact(findings),
    findings,
    disclaimer: A11Y_DISCLAIMER,
    limitations: [...A11Y_LIMITATIONS],
    testingMode: A11Y_TESTING_MODE,
    resultsFile: playwrightSuiteResultsPath('accessibility'),
    findingsFile: path.join(PATHS.reports.accessibility, 'findings.json'),
    applicableCount: applicability.filter((row) => row.status === 'APPLICABLE').length,
    notApplicableCount: applicability.filter((row) => row.status === 'NOT_APPLICABLE').length,
  };
  writeJson(path.join(PATHS.reports.accessibility, 'summary.json'), summary);

  if (passed) logSuccess('Accessibility checks passed (automated only — not a WCAG certification)');
  else logError('Accessibility checks failed — application defects are not hidden. See reports/accessibility/findings.md');

  if (evidenceFiles.length > 0) {
    logStep(`Copied ${evidenceFiles.length} accessibility evidence file(s)`);
  }

  if (fs.existsSync(PATHS.pageMapFile) || fs.existsSync(playwrightSuiteResultsPath('accessibility'))) {
    logStep('Updating coverage from accessibility execution evidence');
    printCoverageSummary(runCoverage());
  }

  process.exit(passed ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
