import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROOT } from '../lib/paths';
import { NOT_AVAILABLE, type PlaywrightJsonReport } from '../lib/playwright-results';
import { resolveCrossBrowserEngines } from '../lib/playwright-browsers';
import { buildCrossBrowserMatrix, collectCrossBrowserFindings, summarizeMatrixRows } from './matrix';
import { renderCrossBrowserMatrixMarkdown } from './report';
import { CROSS_BROWSER_LIMITATIONS, readBundledEngineVersions } from './versions';

describe('cross-browser engines', () => {
  it('always returns chromium, firefox, and webkit regardless of qa.config browsers', () => {
    assert.deepEqual(resolveCrossBrowserEngines(), ['chromium', 'firefox', 'webkit']);
  });
});

describe('cross-browser matrix', () => {
  const report: PlaywrightJsonReport = {
    suites: [
      {
        title: 'home.spec.ts',
        file: 'home.spec.ts',
        specs: [
          {
            title: 'login page loads @cross-browser',
            ok: false,
            file: 'home.spec.ts',
            tests: [
              {
                projectName: 'chromium',
                results: [{ status: 'passed', duration: 100 }],
              },
              {
                projectName: 'firefox',
                results: [
                  {
                    status: 'failed',
                    duration: 200,
                    error: { message: 'Expected: visible\nReceived: hidden' },
                    attachments: [
                      { name: 'screenshot', path: `${ROOT.replace(/\\/g, '/')}/test-results/ff.png`, contentType: 'image/png' },
                    ],
                  },
                ],
              },
              {
                projectName: 'webkit',
                results: [{ status: 'passed', duration: 150 }],
              },
            ],
          },
          {
            title: 'empty login error @cross-browser',
            ok: false,
            file: 'home.spec.ts',
            tests: [
              {
                projectName: 'chromium',
                results: [{ status: 'failed', duration: 80, error: { message: 'shared boom' } }],
              },
              {
                projectName: 'firefox',
                results: [{ status: 'failed', duration: 90, error: { message: 'shared boom' } }],
              },
              {
                projectName: 'webkit',
                results: [{ status: 'failed', duration: 95, error: { message: 'shared boom' } }],
              },
            ],
          },
        ],
      },
    ],
  };

  it('builds a per-test per-engine matrix and flags engine-specific failures', () => {
    const rows = buildCrossBrowserMatrix(report);
    assert.equal(rows.length, 2);
    const login = rows.find((row) => row.title.includes('login page loads'));
    assert.ok(login);
    assert.equal(login.cells.chromium.status, 'PASS');
    assert.equal(login.cells.firefox.status, 'FAIL');
    assert.equal(login.cells.webkit.status, 'PASS');
    assert.equal(login.engineSpecificFailure, true);
    assert.deepEqual(login.failedEngines, ['firefox']);
    assert.deepEqual(login.passedEngines, ['chromium', 'webkit']);
  });

  it('classifies shared vs engine-specific findings', () => {
    const findings = collectCrossBrowserFindings(buildCrossBrowserMatrix(report));
    assert.equal(findings.length, 2);
    const specific = findings.find((row) => row.kind === 'engine-specific-failure');
    const shared = findings.find((row) => row.kind === 'shared-failure');
    assert.ok(specific);
    assert.ok(shared);
    assert.deepEqual(specific.failedEngines, ['firefox']);
    assert.deepEqual(shared.failedEngines, ['chromium', 'firefox', 'webkit']);
  });

  it('summarizes counts per engine', () => {
    const totals = summarizeMatrixRows(buildCrossBrowserMatrix(report));
    assert.equal(totals.chromium.passed, 1);
    assert.equal(totals.chromium.failed, 1);
    assert.equal(totals.firefox.failed, 2);
    assert.equal(totals.webkit.passed, 1);
    assert.equal(totals.webkit.failed, 1);
  });
});

describe('cross-browser report', () => {
  it('names engines, versions, evidence, and does not claim physical devices', () => {
    const markdown = renderCrossBrowserMatrixMarkdown({
      target: 'https://www.saucedemo.com',
      passed: false,
      playwrightVersion: '1.62.1',
      versions: [
        { engine: 'chromium', bundledVersion: '151.0', runtimeVersion: '151.0', version: '151.0' },
        { engine: 'firefox', bundledVersion: '153.0', runtimeVersion: NOT_AVAILABLE, version: '153.0' },
        { engine: 'webkit', bundledVersion: '26.5', runtimeVersion: '26.5', version: '26.5' },
      ],
      rows: [
        {
          title: 'login page loads @cross-browser',
          specFile: 'home.spec.ts',
          engineSpecificFailure: true,
          passedEngines: ['chromium', 'webkit'],
          failedEngines: ['firefox'],
          cells: {
            chromium: {
              engine: 'chromium',
              status: 'PASS',
              durationMs: 1,
              errorMessage: NOT_AVAILABLE,
              screenshotPath: NOT_AVAILABLE,
              tracePath: NOT_AVAILABLE,
              videoPath: NOT_AVAILABLE,
            },
            firefox: {
              engine: 'firefox',
              status: 'FAIL',
              durationMs: 2,
              errorMessage: 'Expected: visible',
              screenshotPath: 'reports/cross-browser/evidence/ff.png',
              tracePath: 'reports/cross-browser/evidence/trace.zip',
              videoPath: NOT_AVAILABLE,
            },
            webkit: {
              engine: 'webkit',
              status: 'PASS',
              durationMs: 3,
              errorMessage: NOT_AVAILABLE,
              screenshotPath: NOT_AVAILABLE,
              tracePath: NOT_AVAILABLE,
              videoPath: NOT_AVAILABLE,
            },
          },
        },
      ],
      findings: [
        {
          kind: 'engine-specific-failure',
          title: 'login page loads @cross-browser',
          specFile: 'home.spec.ts',
          failedEngines: ['firefox'],
          passedEngines: ['chromium', 'webkit'],
          errorMessage: 'Expected: visible',
          screenshotPath: 'reports/cross-browser/evidence/ff.png',
          tracePath: 'reports/cross-browser/evidence/trace.zip',
          videoPath: NOT_AVAILABLE,
        },
      ],
      engineTotals: {
        chromium: { total: 1, passed: 1, failed: 0, skipped: 0, notExecuted: 0 },
        firefox: { total: 1, passed: 0, failed: 1, skipped: 0, notExecuted: 0 },
        webkit: { total: 1, passed: 1, failed: 0, skipped: 0, notExecuted: 0 },
      },
    });

    assert.match(markdown, /chromium/i);
    assert.match(markdown, /firefox/i);
    assert.match(markdown, /webkit/i);
    assert.match(markdown, /151\.0/);
    assert.match(markdown, /reports\/cross-browser\/evidence\/ff\.png/);
    assert.match(markdown, /not a real device/i);
    assert.match(markdown, /WebKit is not iOS Safari/i);
    assert.match(markdown, /Chromium is not Android Chrome/i);
    assert.doesNotMatch(markdown, /tested on a physical iPhone|real iOS Safari session|real Android Chrome device/i);
    for (const line of CROSS_BROWSER_LIMITATIONS) {
      assert.match(markdown, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });
});

describe('bundled engine versions', () => {
  it('reads Playwright browsers.json versions when the package is installed', () => {
    const versions = readBundledEngineVersions();
    assert.equal(typeof versions.chromium, 'string');
    assert.equal(typeof versions.firefox, 'string');
    assert.equal(typeof versions.webkit, 'string');
  });
});
