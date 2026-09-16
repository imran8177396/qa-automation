import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFindingsMarkdown, tallyFindings } from './findings';
import { SECURITY_DISCLAIMER, type SecurityFinding, type SecuritySummary } from './types';

test('tallyFindings() counts every recorded status', () => {
  const findings: SecurityFinding[] = [
    { status: 'PASS', rule: 'https-scheme', severity: 'info', detail: 'ok' },
    { status: 'FAIL', rule: 'content-security-policy', severity: 'medium', detail: 'missing' },
    { status: 'WARNING', rule: 'csrf-indicator', severity: 'low', detail: 'no token' },
    { status: 'NOTE', rule: 'rate-limit-headers', severity: 'info', detail: 'absent' },
    { status: 'NOT_TESTED', rule: 'cookie-attributes', severity: 'info', detail: 'none' },
    { status: 'BLOCKED', rule: 'fetch-error', severity: 'medium', detail: 'down' },
    { status: 'NOT_APPLICABLE', rule: 'https-scheme', severity: 'info', detail: 'loopback' },
  ];
  const counts = tallyFindings(findings);
  assert.equal(counts.passCount, 1);
  assert.equal(counts.failCount, 1);
  assert.equal(counts.warningCount, 1);
  assert.equal(counts.noteCount, 2);
  assert.equal(counts.notTestedCount, 1);
  assert.equal(counts.blockedCount, 1);
});

test('renderFindingsMarkdown() quotes statuses and the disclaimer', () => {
  const summary: SecuritySummary = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    target: 'https://www.saucedemo.com/',
    passed: false,
    failCount: 1,
    passCount: 1,
    noteCount: 0,
    warningCount: 1,
    notTestedCount: 1,
    blockedCount: 0,
    pagesAnalyzed: 1,
    originsAnalyzed: 1,
    bySeverity: { high: 0, medium: 1, low: 0, info: 2 },
    findings: [
      { status: 'PASS', rule: 'https-scheme', severity: 'info', detail: 'https', expected: 'https:', actual: 'https:' },
      { status: 'FAIL', rule: 'content-security-policy', severity: 'medium', detail: 'missing' },
      { status: 'WARNING', rule: 'csrf-indicator', severity: 'low', detail: 'no token' },
      { status: 'NOT_TESTED', rule: 'cookie-attributes', severity: 'info', detail: 'none' },
    ],
    disclaimer: SECURITY_DISCLAIMER,
    limitations: ['Forms are never submitted'],
  };
  const md = renderFindingsMarkdown(summary);
  assert.match(md, /\| PASS \|/);
  assert.match(md, /\| FAIL \|/);
  assert.match(md, /\| WARNING \|/);
  assert.match(md, /\| NOT_TESTED \|/);
  assert.match(md, /not a penetration test/i);
});
