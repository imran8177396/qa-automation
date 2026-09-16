import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NOT_AVAILABLE,
  assertSuiteOriginMatchesBaseUrl,
  compareSuiteOriginToBaseUrl,
  originOf,
  resolveConfiguredPlaywrightBaseUrl,
} from './suite-origin';

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

  it('accepts orchestrator --url / QA_PLAYWRIGHT_BASE_URL as the resolved origin', () => {
    const previous = process.env.QA_PLAYWRIGHT_BASE_URL;
    process.env.QA_PLAYWRIGHT_BASE_URL = 'https://example.com';
    try {
      assert.equal(originOf(resolveConfiguredPlaywrightBaseUrl()), 'https://example.com');
      assert.doesNotThrow(() =>
        assertSuiteOriginMatchesBaseUrl(
          'e2e',
          'https://example.com',
          resolveConfiguredPlaywrightBaseUrl()
        )
      );
    } finally {
      if (previous === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previous;
    }
  });
});
