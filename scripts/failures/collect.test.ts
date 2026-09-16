import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectFailuresWithScans } from './collect';
import { collectFindingFailures } from './collect-findings';

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('collectFindingFailures', () => {
  it('collects FAIL findings only and ignores PASS', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fail-findings-'));
    const reportPath = path.join(dir, 'summary.json');
    writeJson(reportPath, {
      findings: [
        {
          status: 'FAIL',
          rule: 'missing-canonical',
          detail: 'Page has no canonical <link>.',
          expected: 'canonical link',
          actual: '(absent)',
          page: 'https://example.test/',
        },
        {
          status: 'PASS',
          rule: 'title',
          detail: 'Page has a title.',
          page: 'https://example.test/',
        },
      ],
    });

    const { evidence, scans } = collectFindingFailures([
      { source: 'seo', reportPath },
    ]);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].title, 'missing-canonical');
    assert.match(evidence[0].errorMessage, /canonical/);
    assert.equal(evidence[0].screenshotPresent, false);
    assert.equal(evidence[0].screenshotPath, null);
    assert.equal(scans[0].failureCount, 1);
  });

  it('records unavailable artifact when the findings file is missing', () => {
    const missing = path.join(os.tmpdir(), 'qa-fail-missing', 'nope.json');
    const { evidence, scans } = collectFindingFailures([{ source: 'security', reportPath: missing }]);
    assert.equal(evidence.length, 0);
    assert.equal(scans[0].present, false);
    assert.equal(scans[0].failureCount, 0);
  });
});

describe('collectFailuresWithScans', () => {
  it('collects a Playwright failed result and attaches existing screenshot/trace only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fail-pw-'));
    const screenshot = path.join(dir, 'test-failed-1.png');
    const trace = path.join(dir, 'trace.zip');
    fs.writeFileSync(screenshot, 'png');
    fs.writeFileSync(trace, 'zip');
    const reportPath = path.join(dir, 'results.json');
    writeJson(reportPath, {
      suites: [
        {
          specs: [
            {
              title: 'axe scan /',
              file: 'axe.spec.ts',
              tests: [
                {
                  projectName: 'chromium',
                  results: [
                    {
                      status: 'failed',
                      duration: 1200,
                      retry: 0,
                      error: {
                        message:
                          'Error: axe violations on / (1):\n- page-has-heading-one\nexpect(received).toEqual(expected)',
                        stack: 'at axe.spec.ts:16:5',
                      },
                      attachments: [
                        { name: 'screenshot', path: screenshot, contentType: 'image/png' },
                        { name: 'trace', path: trace, contentType: 'application/zip' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const { evidence, scans } = collectFailuresWithScans({
      playwrightReports: [{ source: 'accessibility', reportPath }],
      postmanReportPath: path.join(dir, 'missing-postman.json'),
      findingSources: [],
    });

    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].screenshotPresent, true);
    assert.equal(evidence[0].tracePresent, true);
    assert.equal(evidence[0].videoPresent, false);
    assert.equal(evidence[0].videoPath, null);
    assert.equal(scans.some((row) => row.source === 'accessibility' && row.failureCount === 1), true);
  });
});
