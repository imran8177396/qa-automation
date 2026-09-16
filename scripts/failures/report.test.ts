import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import { buildFailureAnalysisSummary, renderFailureAnalysisMarkdown, writeFailureAnalysisReports } from './report';
import type { FailureEvidence } from './types';

describe('failure analysis report', () => {
  it('records NOTHING_TO_ANALYZE when the evidence set is empty', () => {
    const summary = buildFailureAnalysisSummary([], [], '2026-09-16T00:00:00.000Z');
    assert.equal(summary.outcome, 'NOTHING_TO_ANALYZE');
    assert.equal(summary.totalFailures, 0);
    assert.equal(summary.integrity?.failuresConvertedToPass, 0);
    assert.equal(summary.integrity?.assertionsWeakened, 0);
    const md = renderFailureAnalysisMarkdown(summary);
    assert.match(md, /NOTHING_TO_ANALYZE/);
    assert.match(md, /Never convert a classified failure to PASS/);
  });

  it('keeps original FAIL and quotes APPLICATION for a product assertion fixture', () => {
    const evidence: FailureEvidence = {
      id: 'SEO-0001',
      source: 'seo',
      title: 'missing-h1',
      testId: 'SEO-0001',
      specFile: 'reports/seo/summary.json',
      projectName: NOT_AVAILABLE,
      errorMessage: 'Page has no <h1>.\nExpected: at least one h1\nActual: 0',
      stackTrace: NOT_AVAILABLE,
      durationMs: NOT_AVAILABLE,
      retryCount: 0,
      attemptStatuses: ['failed'],
      screenshotPath: null,
      screenshotPresent: false,
      tracePath: null,
      videoPath: null,
    };
    const summary = buildFailureAnalysisSummary([evidence], []);
    assert.equal(summary.outcome, 'ANALYZED');
    assert.equal(summary.failures[0].ownerClassification, 'APPLICATION');
    assert.equal(summary.failures[0].originalStatus, 'FAIL');
    assert.equal(summary.findings[0].originalStatus, 'FAIL');
    const md = renderFailureAnalysisMarkdown(summary);
    assert.match(md, /Classification: APPLICATION/);
    assert.match(md, /originalStatus=FAIL preserved/);
    assert.doesNotMatch(md, /Original status: PASS/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fail-report-'));
    writeFailureAnalysisReports(summary, dir);
    assert.equal(fs.existsSync(path.join(dir, 'summary.json')), true);
    assert.equal(fs.existsSync(path.join(dir, 'findings.md')), true);
    assert.equal(fs.existsSync(path.join(dir, 'section-2.16.json')), true);
  });
});
