import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderContentFindingsMarkdown, tallyContentFindings } from './findings';
import { CONTENT_DISCLAIMER, type ContentFinding, type ContentSummary } from './types';

test('tallyContentFindings() counts every recorded status', () => {
  const findings: ContentFinding[] = [
    { status: 'PASS', rule: 'missing-title', severity: 'info', page: '/', detail: 'ok' },
    { status: 'FAIL', rule: 'placeholder-text', severity: 'medium', page: '/', detail: 'lorem' },
    { status: 'NOT_TESTED', rule: 'duplicate-content', severity: 'info', page: 'site-wide', detail: 'one page' },
    { status: 'NOTE', rule: 'expected-content', severity: 'info', page: 'site-wide', detail: 'not configured' },
  ];
  const counts = tallyContentFindings(findings);
  assert.equal(counts.passCount, 1);
  assert.equal(counts.failCount, 1);
  assert.equal(counts.notTestedCount, 1);
  assert.equal(counts.noteCount, 1);
});

test('renderContentFindingsMarkdown() quotes statuses', () => {
  const summary: ContentSummary = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    target: 'https://www.saucedemo.com/',
    passed: false,
    failCount: 1,
    passCount: 1,
    noteCount: 1,
    notTestedCount: 1,
    pagesAnalyzed: 1,
    bySeverity: { high: 0, medium: 1, low: 0, info: 3 },
    findings: [
      { status: 'PASS', rule: 'missing-title', severity: 'info', page: '/', detail: 'ok' },
      { status: 'FAIL', rule: 'empty-heading', severity: 'medium', page: '/', detail: 'empty' },
      { status: 'NOT_TESTED', rule: 'duplicate-content', severity: 'info', page: 'site-wide', detail: 'one page' },
    ],
    disclaimer: CONTENT_DISCLAIMER,
    limitations: ['not fact-checking'],
  };
  const md = renderContentFindingsMarkdown(summary);
  assert.match(md, /\| FAIL \|/);
  assert.match(md, /\| NOT_TESTED \|/);
  assert.match(md, /not factual verification/i);
});
