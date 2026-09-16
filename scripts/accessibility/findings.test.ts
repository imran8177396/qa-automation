import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAxeViolations, formatFinding, renderFindingsMarkdown, slugFinding, wcagFromTags } from './findings';
import { A11Y_DISCLAIMER } from './types';
import type { AccessibilityFinding } from './types';

const finding: AccessibilityFinding = {
  status: 'FAIL',
  rule: 'form-label',
  impact: 'serious',
  page: 'login',
  pagePath: '/',
  expected: 'programmatic label',
  actual: 'placeholder-only',
};

test('formatFinding() includes status, rule, page, expected, actual', () => {
  const text = formatFinding(finding);
  assert.match(text, /Status: FAIL/);
  assert.match(text, /Rule: form-label/);
  assert.match(text, /Page: login \(\/\)/);
  assert.match(text, /Expected: programmatic label/);
  assert.match(text, /Actual: placeholder-only/);
});

test('slugFinding() is filesystem-safe', () => {
  assert.equal(slugFinding(finding), 'login-form-label');
});

test('wcagFromTags maps axe tags', () => {
  assert.equal(wcagFromTags(['wcag111']), '1.1.1');
  assert.equal(wcagFromTags(['best-practice']), 'NOT_AVAILABLE');
});

test('renderFindingsMarkdown includes the WCAG disclaimer and NOT_APPLICABLE rows', () => {
  const md = renderFindingsMarkdown({
    target: 'https://www.saucedemo.com',
    passed: false,
    pages: [
      {
        url: 'https://www.saucedemo.com/',
        path: '/',
        violations: [
          {
            id: 'label',
            impact: 'critical',
            help: 'Form elements must have labels',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/label',
            tags: ['wcag2a', 'wcag412'],
            nodes: [{ target: ['#user-name'], html: '<input id="user-name">' }],
          },
        ],
        incomplete: [],
      },
    ],
    findings: [
      finding,
      {
        status: 'NOT_APPLICABLE',
        rule: 'navigation',
        impact: 'info',
        page: 'login',
        pagePath: '/',
        actual: 'No <nav> or role=navigation observed',
      },
    ],
  });

  assert.match(md, new RegExp(A11Y_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(md, /QA-level automated accessibility/);
  assert.match(md, /not a WCAG 2\.x conformance certification/i);
  assert.match(md, /NOT_APPLICABLE \(not invented\)/);
  assert.match(md, /No <nav>/);
  assert.match(md, /label/);
  assert.equal(formatAxeViolations('/', []).includes('No axe violations'), true);
});
