import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSeo } from './analyze-seo';
import { makeDiscoveredPage, makeDiscoveryResult } from '../testing/discovery-fixtures';
import type { DiscoveredPage } from '../discovery/types';

function makePage(overrides: Partial<DiscoveredPage> = {}): DiscoveredPage {
  return makeDiscoveredPage(overrides);
}

function makeDiscovery(pages: DiscoveredPage[]) {
  return makeDiscoveryResult(pages);
}

test('analyzeSeo() raises no findings for a fully clean page', () => {
  const findings = analyzeSeo(makeDiscovery([makePage()]));
  assert.deepEqual(findings, []);
});

test('analyzeSeo() flags a missing title as high severity', () => {
  const findings = analyzeSeo(makeDiscovery([makePage({ title: '' })]));
  const finding = findings.find((f) => f.rule === 'missing-title');
  assert.ok(finding);
  assert.equal(finding!.severity, 'high');
});

test('analyzeSeo() flags missing and multiple H1s', () => {
  const missing = analyzeSeo(makeDiscovery([makePage({ h1s: [] })]));
  assert.ok(missing.some((f) => f.rule === 'missing-h1' && f.severity === 'high'));

  const multiple = analyzeSeo(makeDiscovery([makePage({ h1s: ['One', 'Two'] })]));
  assert.ok(multiple.some((f) => f.rule === 'multiple-h1' && f.severity === 'low'));
});

test('analyzeSeo() flags a missing meta description and missing canonical', () => {
  const findings = analyzeSeo(makeDiscovery([makePage({ metaDescription: null, canonicalUrl: null })]));
  assert.ok(findings.some((f) => f.rule === 'missing-meta-description'));
  assert.ok(findings.some((f) => f.rule === 'missing-canonical'));
});

test('analyzeSeo() flags images missing alt text with the count in the detail', () => {
  const findings = analyzeSeo(makeDiscovery([makePage({ totalImages: 5, imagesWithoutAlt: 3 })]));
  const finding = findings.find((f) => f.rule === 'images-missing-alt');
  assert.ok(finding);
  assert.match(finding!.detail, /3 of 5/);
});

test('analyzeSeo() flags a robots noindex tag', () => {
  const findings = analyzeSeo(makeDiscovery([makePage({ robotsMeta: 'noindex, nofollow' })]));
  assert.ok(findings.some((f) => f.rule === 'robots-noindex' && f.severity === 'medium'));
});

test('analyzeSeo() flags missing Open Graph tags only when both title and description are absent', () => {
  const missing = analyzeSeo(makeDiscovery([makePage({ ogTitle: null, ogDescription: null })]));
  assert.ok(missing.some((f) => f.rule === 'missing-open-graph'));

  const partial = analyzeSeo(makeDiscovery([makePage({ ogTitle: 'Has one', ogDescription: null })]));
  assert.ok(!partial.some((f) => f.rule === 'missing-open-graph'));
});

test('analyzeSeo() flags a non-HTTPS page even when it failed to load', () => {
  const findings = analyzeSeo(
    makeDiscovery([makePage({ url: 'http://example.com/insecure', status: null, ok: false, error: 'timeout' })])
  );
  const finding = findings.find((f) => f.rule === 'non-https');
  assert.ok(finding, 'expected non-https to be flagged regardless of load success');
});

test('analyzeSeo() skips content-based rules for a page that failed to load', () => {
  const findings = analyzeSeo(
    makeDiscovery([makePage({ status: null, ok: false, error: 'timeout', title: '', h1s: [] })])
  );
  assert.ok(!findings.some((f) => f.rule === 'missing-title'));
  assert.ok(!findings.some((f) => f.rule === 'missing-h1'));
});

test('analyzeSeo() detects duplicate titles and duplicate meta descriptions across pages', () => {
  const findings = analyzeSeo(
    makeDiscovery([
      makePage({ url: 'https://example.com/a', title: 'Same Title', metaDescription: 'Same description.' }),
      makePage({ url: 'https://example.com/b', title: 'Same Title', metaDescription: 'Same description.' }),
      makePage({ url: 'https://example.com/c', title: 'Different Title', metaDescription: 'Different.' }),
    ])
  );

  const duplicateTitle = findings.find((f) => f.rule === 'duplicate-title');
  const duplicateDescription = findings.find((f) => f.rule === 'duplicate-meta-description');

  assert.ok(duplicateTitle);
  assert.equal(duplicateTitle!.page, 'site-wide');
  assert.match(duplicateTitle!.detail, /example\.com\/a/);
  assert.match(duplicateTitle!.detail, /example\.com\/b/);
  assert.ok(!duplicateTitle!.detail.includes('example.com/c'));

  assert.ok(duplicateDescription);
});

test('analyzeSeo() does not flag unique titles/descriptions as duplicates', () => {
  const findings = analyzeSeo(
    makeDiscovery([
      makePage({ url: 'https://example.com/a', title: 'Title A', metaDescription: 'Desc A' }),
      makePage({ url: 'https://example.com/b', title: 'Title B', metaDescription: 'Desc B' }),
    ])
  );
  assert.ok(!findings.some((f) => f.rule === 'duplicate-title' || f.rule === 'duplicate-meta-description'));
});

test('analyzeSeo() skips autoindex / directory-listing pages', () => {
  const findings = analyzeSeo(
    makeDiscovery([
      makePage({
        url: 'https://example.com/work',
        title: 'Index of /work',
        h1s: [],
        metaDescription: null,
        canonicalUrl: null,
        isAutoindex: true,
      }),
    ])
  );
  assert.equal(
    findings.length,
    0,
    'directory listings are a security finding, not an SEO finding'
  );
});

test('analyzeSeo() assigns a unique id to every finding', () => {
  const findings = analyzeSeo(
    makeDiscovery([
      makePage({ url: 'https://example.com/a', title: '', h1s: [] }),
      makePage({ url: 'https://example.com/b', title: '', h1s: [] }),
    ])
  );
  const ids = findings.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});
