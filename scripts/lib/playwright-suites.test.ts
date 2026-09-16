import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PATHS, generatedCheckResultsPath } from './paths';
import {
  PLAYWRIGHT_ENGINE_CAVEATS,
  PLAYWRIGHT_SUITE_NAMES,
  PLAYWRIGHT_SUITE_OUTPUT_PATHS,
  assertNoDuplicateOutputPaths,
  assertUniquePlaywrightSuitePaths,
  playwrightAllureReporterConfig,
  playwrightHtmlReporterConfig,
  playwrightSuiteResultsPath,
} from './playwright-suites';

describe('playwright suite output paths', () => {
  it('maps every suite to reports/playwright/<suiteName>/results.json', () => {
    for (const suiteName of PLAYWRIGHT_SUITE_NAMES) {
      const expected = path.join(PATHS.reports.playwright, suiteName, 'results.json');
      assert.equal(playwrightSuiteResultsPath(suiteName), expected);
      assert.equal(PLAYWRIGHT_SUITE_OUTPUT_PATHS[suiteName], expected);
    }
  });

  it('exposes generatedCheckResultsPath for section 2.6', () => {
    assert.equal(generatedCheckResultsPath, playwrightSuiteResultsPath('generated-check'));
    assert.equal(PATHS.generatedCheckResultsPath, generatedCheckResultsPath);
    assert.match(generatedCheckResultsPath.replace(/\\/g, '/'), /reports\/playwright\/generated-check\/results\.json$/);
  });

  it('keeps engine caveats that WebKit is not iOS Safari and Chromium is not Android Chrome', () => {
    assert.ok(PLAYWRIGHT_ENGINE_CAVEATS.some((line) => /WebKit is not iOS Safari/i.test(line)));
    assert.ok(PLAYWRIGHT_ENGINE_CAVEATS.some((line) => /Chromium is not Android Chrome/i.test(line)));
  });

  it('adds Allure results under reports/allure/results without replacing HTML reporter', () => {
    const allure = playwrightAllureReporterConfig('e2e');
    const html = playwrightHtmlReporterConfig('e2e');
    assert.equal(allure.resultsDir, 'reports/allure/results');
    assert.equal(allure.detail, true);
    assert.match(html.outputFolder, /reports\/playwright\/e2e\/html$/);
    assert.equal(html.open, 'never');
    assert.equal(allure.environmentInfo.suite, 'e2e');
  });

  it('fails the run when two suites resolve to the same output path', () => {
    assert.doesNotThrow(() => assertUniquePlaywrightSuitePaths());
    assert.throws(
      () =>
        assertNoDuplicateOutputPaths({
          e2e: '/tmp/shared/results.json',
          visual: '/tmp/shared/results.json',
        }),
      /suite output collision/
    );
  });
});
