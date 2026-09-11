import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateLighthouseThresholds } from './evaluate';
import { parseLighthouseJson } from './parse';
import { NOT_AVAILABLE } from './types';

describe('Lighthouse JSON parser', () => {
  it('extracts CWV and category scores without inventing missing INP', () => {
    const page = parseLighthouseJson(
      {
        requestedUrl: 'https://example.com/',
        finalUrl: 'https://example.com/',
        categories: {
          performance: { score: 0.81 },
          accessibility: { score: 0.9 },
          'best-practices': { score: 0.75 },
          seo: { score: 0.88 },
        },
        audits: {
          'largest-contentful-paint': { numericValue: 2100 },
          'cumulative-layout-shift': { numericValue: 0.04 },
          'total-blocking-time': { numericValue: 180 },
        },
      },
      'https://example.com/'
    );
    assert.equal(page.status, 'RECORDED');
    assert.equal(page.lcpMs, 2100);
    assert.equal(page.cls, 0.04);
    assert.equal(page.inpMs, NOT_AVAILABLE);
    assert.equal(page.tbtMs, 180);
    assert.equal(page.performanceScore, 81);
    assert.equal(page.accessibilityScore, 90);
    assert.equal(page.bestPracticesScore, 75);
    assert.equal(page.seoScore, 88);
  });
});

describe('Lighthouse threshold keys', () => {
  it('keeps status RECORDED when threshold keys are null', () => {
    const page = parseLighthouseJson(
      {
        finalUrl: 'https://example.com/',
        categories: { performance: { score: 0.5 } },
        audits: { 'largest-contentful-paint': { numericValue: 3000 } },
      },
      'https://example.com/'
    );
    const result = evaluateLighthouseThresholds([page], {
      lcpMs: null,
      cls: null,
      inpMs: null,
      tbtMs: null,
      performanceScore: null,
      accessibilityScore: null,
      bestPracticesScore: null,
      seoScore: null,
    });
    assert.equal(result.status, 'RECORDED');
    assert.equal(result.defined, false);
    assert.ok(result.comparisons.every((row) => row.status === 'NOT_AVAILABLE'));
  });
});
