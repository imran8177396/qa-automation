import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOT_AVAILABLE, compareSuiteOriginToBaseUrl, originOf } from './suite-origin';
import { assertSuiteOriginMatchesBaseUrl } from './suite-origin';

describe('suite origin comparison', () => {
  it('returns VALID when origins match regardless of trailing slash', () => {
    assert.equal(originOf('https://example.com/'), 'https://example.com');
    assert.equal(
      compareSuiteOriginToBaseUrl('https://example.com/', 'https://example.com'),
      'VALID'
    );
  });

  it('returns INVALID when the suite origin differs from playwright.baseURL', () => {
    assert.equal(
      compareSuiteOriginToBaseUrl('http://127.0.0.1:4173', 'https://example.com'),
      'INVALID'
    );
  });

  it('returns INVALID when a value is NOT_AVAILABLE', () => {
    assert.equal(originOf('not a url'), NOT_AVAILABLE);
    assert.equal(compareSuiteOriginToBaseUrl(NOT_AVAILABLE, 'https://example.com'), 'INVALID');
  });

  it('fails product suites including visual on origin mismatch', () => {
    assert.throws(
      () =>
        assertSuiteOriginMatchesBaseUrl(
          'generated-check',
          'http://127.0.0.1:4173',
          'https://example.com'
        ),
      /wrong origin/
    );
    assert.throws(
      () => assertSuiteOriginMatchesBaseUrl('visual', 'http://127.0.0.1:4173', 'https://example.com'),
      /wrong origin/
    );
  });
});
