import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml } from '../lib/html-snapshot';
import { analyzeContentPage, analyzeDuplicateContent, analyzeExpectedValues } from './analyze';

test('analyzeContentPage() PASSes a page with title, headings, and real copy', () => {
  const parsed = parseHtml(
    '<html><head><title>Swag Labs</title></head><body><h4>Accepted usernames are:</h4><p>standard_user</p></body></html>'
  );
  const findings = analyzeContentPage({
    url: 'https://www.saucedemo.com/',
    title: 'Swag Labs',
    h1s: [],
    headings: [{ level: 'h4', text: 'Accepted usernames are:' }],
    parsed,
  });
  assert.equal(findings.find((row) => row.rule === 'missing-title')?.status, 'PASS');
  assert.equal(findings.find((row) => row.rule === 'placeholder-text')?.status, 'PASS');
  assert.equal(findings.find((row) => row.rule === 'missing-content')?.status, 'PASS');
  assert.equal(findings.find((row) => row.rule === 'heading-structure')?.status, 'WARNING');
});

test('analyzeContentPage() FAILs empty headings and placeholder copy', () => {
  const parsed = parseHtml('<html><head><title>X</title></head><body><h1></h1><p>lorem ipsum dolor</p></body></html>');
  const findings = analyzeContentPage({
    url: 'https://example.com/',
    title: 'X',
    h1s: [''],
    headings: [{ level: 'h1', text: '' }],
    parsed,
  });
  assert.equal(findings.find((row) => row.rule === 'empty-heading')?.status, 'FAIL');
  assert.equal(findings.find((row) => row.rule === 'placeholder-text')?.status, 'FAIL');
});

test('analyzeDuplicateContent() is NOT_TESTED for a single page', () => {
  const [row] = analyzeDuplicateContent([
    { url: 'https://www.saucedemo.com/', title: 'Swag Labs', h1s: [], headings: [], parsed: parseHtml('<p>hello world content here</p>') },
  ]);
  assert.equal(row?.status, 'NOT_TESTED');
});

test('analyzeExpectedValues() is NOTE when nothing is configured', () => {
  const [row] = analyzeExpectedValues([], []);
  assert.equal(row?.status, 'NOTE');
  assert.match(row?.detail ?? '', /not judged/);
});
