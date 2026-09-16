import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSeoFindingsMarkdown, tallySeoFindings } from './findings';
import { SEO_DISCLAIMER, type SeoFinding, type SeoSuiteSummary } from './types';

test('tallySeoFindings() counts FAIL from status, not only high severity', () => {
  const findings: SeoFinding[] = [
    { id: 'SEO-0001', rule: 'title', severity: 'info', status: 'PASS', page: '/', detail: 'ok' },
    { id: 'SEO-0002', rule: 'missing-meta-description', severity: 'medium', status: 'FAIL', page: '/', detail: 'missing' },
    { id: 'SEO-0003', rule: 'duplicate-title', severity: 'info', status: 'NOT_TESTED', page: 'site-wide', detail: 'one page' },
    { id: 'SEO-0004', rule: 'robots-txt', severity: 'medium', status: 'BLOCKED', page: '/robots.txt', detail: 'down' },
  ];
  const counts = tallySeoFindings(findings);
  assert.equal(counts.failCount, 1);
  assert.equal(counts.passCount, 1);
  assert.equal(counts.notTestedCount, 1);
  assert.equal(counts.blockedCount, 1);
});

test('renderSeoFindingsMarkdown() quotes statuses and the disclaimer', () => {
  const summary: SeoSuiteSummary = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    target: 'https://www.saucedemo.com/',
    passed: false,
    failCount: 1,
    passCount: 1,
    warningCount: 0,
    noteCount: 0,
    notTestedCount: 1,
    blockedCount: 0,
    pagesAnalyzed: 1,
    rawFindingCount: 3,
    uniqueFindingCount: 3,
    findings: [
      { id: 'SEO-0001', rule: 'title', severity: 'info', status: 'PASS', page: '/', detail: 'Swag Labs' },
      { id: 'SEO-0002', rule: 'missing-canonical', severity: 'low', status: 'FAIL', page: '/', detail: 'absent' },
      { id: 'SEO-0003', rule: 'duplicate-title', severity: 'info', status: 'NOT_TESTED', page: 'site-wide', detail: 'one page' },
    ],
    disclaimer: SEO_DISCLAIMER,
    limitations: ['not a ranking audit'],
  };
  const md = renderSeoFindingsMarkdown(summary);
  assert.match(md, /\| PASS \|/);
  assert.match(md, /\| FAIL \|/);
  assert.match(md, /\| NOT_TESTED \|/);
  assert.match(md, /not a ranking/i);
});
