import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveUiTarget } from './ui-target';
import type { QaConfig } from '../types';

function config(baseURL: string): QaConfig {
  return {
    playwright: { enabled: true, baseURL, headless: true },
  } as unknown as QaConfig;
}

describe('resolveUiTarget', () => {
  it('uses config baseURL when env is unset', () => {
    const previous = process.env.QA_PLAYWRIGHT_BASE_URL;
    delete process.env.QA_PLAYWRIGHT_BASE_URL;
    try {
      const target = resolveUiTarget(config('https://example.com/'));
      assert.equal(target.url, 'https://example.com');
      assert.equal(target.origin, 'https://example.com');
      assert.equal(target.isLoopback, false);
      assert.equal(target.source, 'config');
    } finally {
      if (previous === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previous;
    }
  });

  it('does not invent a fixture origin for a live config URL', () => {
    const previous = process.env.QA_PLAYWRIGHT_BASE_URL;
    delete process.env.QA_PLAYWRIGHT_BASE_URL;
    try {
      const target = resolveUiTarget(config('https://example.com'));
      assert.equal(target.isLoopback, false);
      assert.doesNotMatch(target.url, /127\.0\.0\.1|localhost/);
    } finally {
      if (previous === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previous;
    }
  });

  it('honors QA_PLAYWRIGHT_BASE_URL over config', () => {
    const previous = process.env.QA_PLAYWRIGHT_BASE_URL;
    process.env.QA_PLAYWRIGHT_BASE_URL = 'https://example.test';
    try {
      const target = resolveUiTarget(config('https://example.com'));
      assert.equal(target.url, 'https://example.test');
      assert.equal(target.source, 'env');
    } finally {
      if (previous === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previous;
    }
  });
});
