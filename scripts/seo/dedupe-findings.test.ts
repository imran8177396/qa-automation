import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSeoFindings, seoFindingDedupeKey } from './dedupe-findings';
import { normalizeFindingUrl } from '../lib/normalize-finding-url';
import type { SeoFinding } from './types';

function finding(overrides: Partial<SeoFinding> = {}): SeoFinding {
  return {
    id: 'SEO-0001',
    rule: 'missing-title',
    severity: 'high',
    page: 'https://example.com/page',
    detail: 'Page has no <title>.',
    ...overrides,
  };
}

test('collectSeoFindings() merges the same finding from suite and discovery into one row', () => {
  const suite = finding({ id: 'SEO-0001', page: 'https://Example.com/page/' });
  const discovery = finding({ id: 'SEO-0099', page: 'https://example.com/page' });

  const result = collectSeoFindings([suite], [discovery]);

  assert.equal(result.rawFindingCount, 2);
  assert.equal(result.uniqueFindingCount, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].rule, 'missing-title');
  assert.equal(result.findings[0].severity, 'high');
  assert.equal(result.findings[0].detail, 'Page has no <title>.');
  assert.deepEqual(result.findings[0].sources, ['suite', 'discovery']);
  assert.equal(
    seoFindingDedupeKey(suite),
    seoFindingDedupeKey(discovery),
    'case and trailing-slash differences must share one key'
  );
});

test('collectSeoFindings() keeps distinct findings as separate rows', () => {
  const result = collectSeoFindings(
    [finding({ rule: 'missing-title', detail: 'Page has no <title>.' })],
    [finding({ id: 'SEO-0002', rule: 'missing-h1', detail: 'Page has no <h1>.' })]
  );

  assert.equal(result.rawFindingCount, 2);
  assert.equal(result.uniqueFindingCount, 2);
  assert.equal(result.findings.length, 2);
});

test('normalizeFindingUrl() lowercases and strips a trailing slash', () => {
  assert.equal(normalizeFindingUrl('https://Example.com/Page/'), 'https://example.com/page');
  assert.equal(normalizeFindingUrl('/'), '/');
});
