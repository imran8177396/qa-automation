import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveUiTarget, isExampleWebsiteTarget } from './ui-target';
import type { QaConfig } from '../types';

function config(website: string): QaConfig {
  return {
    urls: { website, api: 'https://jsonplaceholder.typicode.com' },
    playwright: { enabled: true, headless: true },
  } as unknown as QaConfig;
}

describe('resolveUiTarget', () => {
  it('uses config urls.website when env is unset', () => {
    const previous = process.env.QA_PLAYWRIGHT_BASE_URL;
    const previousWebsite = process.env.QA_WEBSITE_URL;
    delete process.env.QA_PLAYWRIGHT_BASE_URL;
    delete process.env.QA_WEBSITE_URL;
    try {
      const target = resolveUiTarget(config('https://example.com/'), { lastTargetUrl: null });
      assert.equal(target.url, 'https://example.com');
      assert.equal(target.origin, 'https://example.com');
      assert.equal(target.isLoopback, false);
      assert.equal(target.source, 'config');
    } finally {
      if (previous === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previous;
      if (previousWebsite === undefined) delete process.env.QA_WEBSITE_URL;
      else process.env.QA_WEBSITE_URL = previousWebsite;
    }
  });

  it('does not invent a fixture origin for a live config URL', () => {
    const previous = process.env.QA_PLAYWRIGHT_BASE_URL;
    const previousWebsite = process.env.QA_WEBSITE_URL;
    delete process.env.QA_PLAYWRIGHT_BASE_URL;
    delete process.env.QA_WEBSITE_URL;
    try {
      const target = resolveUiTarget(config('https://example.com'), { lastTargetUrl: null });
      assert.equal(target.isLoopback, false);
      assert.doesNotMatch(target.url, /127\.0\.0\.1|localhost/);
    } finally {
      if (previous === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previous;
      if (previousWebsite === undefined) delete process.env.QA_WEBSITE_URL;
      else process.env.QA_WEBSITE_URL = previousWebsite;
    }
  });

  it('honors QA_PLAYWRIGHT_BASE_URL over config', () => {
    const previous = process.env.QA_PLAYWRIGHT_BASE_URL;
    process.env.QA_PLAYWRIGHT_BASE_URL = 'https://example.test';
    try {
      const target = resolveUiTarget(config('https://example.com'), { lastTargetUrl: null });
      assert.equal(target.url, 'https://example.test');
      assert.equal(target.source, 'env');
    } finally {
      if (previous === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previous;
    }
  });

  it('honors QA_WEBSITE_URL when Playwright env is unset', () => {
    const previousPlaywright = process.env.QA_PLAYWRIGHT_BASE_URL;
    const previousWebsite = process.env.QA_WEBSITE_URL;
    delete process.env.QA_PLAYWRIGHT_BASE_URL;
    process.env.QA_WEBSITE_URL = 'https://website-env.example/';
    try {
      const target = resolveUiTarget(config('https://example.com'), { lastTargetUrl: null });
      assert.equal(target.url, 'https://website-env.example');
      assert.equal(target.source, 'env');
    } finally {
      if (previousPlaywright === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previousPlaywright;
      if (previousWebsite === undefined) delete process.env.QA_WEBSITE_URL;
      else process.env.QA_WEBSITE_URL = previousWebsite;
    }
  });

  it('uses persisted last-target when env is unset', () => {
    const previous = process.env.QA_PLAYWRIGHT_BASE_URL;
    const previousWebsite = process.env.QA_WEBSITE_URL;
    delete process.env.QA_PLAYWRIGHT_BASE_URL;
    delete process.env.QA_WEBSITE_URL;
    try {
      const target = resolveUiTarget(config('https://example.com'), {
        lastTargetUrl: 'https://persisted.example/',
      });
      assert.equal(target.url, 'https://persisted.example');
      assert.equal(target.source, 'last-target');
    } finally {
      if (previous === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previous;
      if (previousWebsite === undefined) delete process.env.QA_WEBSITE_URL;
      else process.env.QA_WEBSITE_URL = previousWebsite;
    }
  });

  it('isExampleWebsiteTarget is true only for the Sauce Demo example origin the user targeted', () => {
    const previous = process.env.QA_PLAYWRIGHT_BASE_URL;
    const previousWebsite = process.env.QA_WEBSITE_URL;
    delete process.env.QA_PLAYWRIGHT_BASE_URL;
    delete process.env.QA_WEBSITE_URL;
    try {
      assert.equal(
        isExampleWebsiteTarget(config(''), { lastTargetUrl: null }),
        false,
        'empty urls.website is not an example fallback'
      );
      assert.equal(
        isExampleWebsiteTarget(config(''), {
          lastTargetUrl: null,
          resolvedUrl: 'https://www.saucedemo.com/',
        }),
        true
      );
      assert.equal(
        isExampleWebsiteTarget(config(''), {
          lastTargetUrl: null,
          resolvedUrl: 'https://other.example/',
        }),
        false
      );
    } finally {
      if (previous === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previous;
      if (previousWebsite === undefined) delete process.env.QA_WEBSITE_URL;
      else process.env.QA_WEBSITE_URL = previousWebsite;
    }
  });
});
