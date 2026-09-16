import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ROOT } from './paths';
import {
  NOT_AVAILABLE,
  buildBrowserSuiteStats,
  firstRepoStackFrame,
  parseAssertionExpectedActual,
  parseFailedExecutions,
  projectToEngine,
  type PlaywrightJsonReport,
} from './playwright-results';

const longMessage = `Error: expect(received).toHaveText(expected)\n\nExpected: ${'x'.repeat(400)}\nReceived: ${'y'.repeat(400)}\n\nat tests/e2e/example.spec.ts:12:5`;

describe('playwright failure detail parser', () => {
  it('never truncates the error message and captures assertion + repo frame + retry + artifacts', () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: 'example',
          file: 'tests/e2e/example.spec.ts',
          specs: [
            {
              title: 'shows heading',
              ok: false,
              file: 'tests/e2e/example.spec.ts',
              tests: [
                {
                  projectName: 'chromium',
                  results: [
                    {
                      status: 'failed',
                      retry: 2,
                      error: {
                        message: longMessage,
                        stack: `Error: boom\n    at Object.<anonymous> (${path.join(ROOT, 'tests', 'e2e', 'example.spec.ts')}:12:5)\n    at ${path.join(ROOT, 'node_modules', '@playwright', 'test', 'index.js')}:1:1`,
                      },
                      attachments: [
                        { name: 'screenshot', path: path.join(ROOT, 'test-results', 'fail.png'), contentType: 'image/png' },
                        { name: 'trace', path: path.join(ROOT, 'test-results', 'trace.zip'), contentType: 'application/zip' },
                        { name: 'video', path: path.join(ROOT, 'test-results', 'video.webm'), contentType: 'video/webm' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const details = parseFailedExecutions(report, 'generated-check', path.join(ROOT, 'reports', 'playwright', 'generated-check', 'results.json'));
    assert.equal(details.source, 'playwright-failure-details');
    assert.equal(details.executions.length, 1);
    const row = details.executions[0];
    assert.equal(row.errorMessage, longMessage);
    assert.ok(row.errorMessage.length > 800);
    assert.equal(row.assertion.expected, 'x'.repeat(400));
    assert.equal(row.assertion.actual, 'y'.repeat(400));
    assert.equal(row.firstRepoStackFrame, 'tests/e2e/example.spec.ts:12:5');
    assert.equal(row.retryCount, 2);
    assert.equal(row.screenshotPath, 'test-results/fail.png');
    assert.equal(row.tracePath, 'test-results/trace.zip');
    assert.equal(row.videoPath, 'test-results/video.webm');
  });

  it('emits NOT_AVAILABLE when assertion values or stack frames are missing', () => {
    assert.deepEqual(parseAssertionExpectedActual('something failed'), {
      expected: NOT_AVAILABLE,
      actual: NOT_AVAILABLE,
    });
    assert.equal(firstRepoStackFrame(''), NOT_AVAILABLE);
    assert.equal(firstRepoStackFrame('at /usr/lib/node/internal.js:1:1'), NOT_AVAILABLE);
  });

  it('maps Playwright project names to engines without treating Safari as a real device', () => {
    assert.equal(projectToEngine('chromium'), 'chromium');
    assert.equal(projectToEngine('firefox'), 'firefox');
    assert.equal(projectToEngine('webkit'), 'webkit');
    assert.equal(projectToEngine('Desktop Safari'), 'webkit');
  });

  it('records skipped engines as NOT_EXECUTED with a reason', () => {
    const stats = buildBrowserSuiteStats({
      report: { suites: [] },
      executedBrowsers: ['chromium'],
      skippedBrowsers: [
        { browser: 'firefox', reason: 'not listed in qa.config.json playwright.browsers' },
        { browser: 'webkit', reason: 'not listed in qa.config.json playwright.browsers' },
      ],
    });
    assert.equal(stats.length, 3);
    assert.equal(stats[0]?.browser, 'chromium');
    assert.equal(stats[0]?.status, 'EXECUTED');
    assert.equal(stats[1]?.status, 'NOT_EXECUTED');
    assert.equal(stats[1]?.reason, 'not listed in qa.config.json playwright.browsers');
    assert.equal(stats[1]?.total, NOT_AVAILABLE);
    assert.equal(stats[2]?.status, 'NOT_EXECUTED');
    assert.equal(stats[2]?.reason, 'not listed in qa.config.json playwright.browsers');
  });
});
