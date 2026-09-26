import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NOT_AVAILABLE,
  applyCliWebsiteTarget,
  assertSuiteOriginMatchesBaseUrl,
  assertValidPlaywrightBaseUrl,
  compareSuiteOriginToBaseUrl,
  configFallbackPlaywrightBaseUrl,
  originOf,
  resolveConfiguredPlaywrightBaseUrl,
} from './suite-origin';
import { resolveApiUrl, resolveWebsiteTarget } from '../orchestrator/resolve-url';

describe('suite origin comparison', () => {
  it('returns VALID when origins match regardless of trailing slash', () => {
    assert.equal(originOf('https://example.com/'), 'https://example.com');
    assert.equal(
      compareSuiteOriginToBaseUrl('https://example.com/', 'https://example.com'),
      'VALID'
    );
  });

  it('returns INVALID when the suite origin differs from the configured website origin', () => {
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

  it('uses persisted last-target when QA_PLAYWRIGHT_BASE_URL is unset', () => {
    const previous = process.env.QA_PLAYWRIGHT_BASE_URL;
    const previousWebsite = process.env.QA_WEBSITE_URL;
    delete process.env.QA_PLAYWRIGHT_BASE_URL;
    delete process.env.QA_WEBSITE_URL;
    try {
      assert.equal(
        resolveConfiguredPlaywrightBaseUrl({
          lastTargetUrl: 'https://persisted.example/',
          configBaseUrl: 'https://www.saucedemo.com',
        }),
        'https://persisted.example'
      );
    } finally {
      if (previous === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previous;
      if (previousWebsite === undefined) delete process.env.QA_WEBSITE_URL;
      else process.env.QA_WEBSITE_URL = previousWebsite;
    }
  });

  it('uses QA_WEBSITE_URL when QA_PLAYWRIGHT_BASE_URL is unset', () => {
    const previousPlaywright = process.env.QA_PLAYWRIGHT_BASE_URL;
    const previousWebsite = process.env.QA_WEBSITE_URL;
    delete process.env.QA_PLAYWRIGHT_BASE_URL;
    process.env.QA_WEBSITE_URL = 'https://website-env.example/';
    try {
      assert.equal(
        resolveConfiguredPlaywrightBaseUrl({
          lastTargetUrl: 'https://persisted.example/',
          configBaseUrl: 'https://www.saucedemo.com',
        }),
        'https://website-env.example'
      );
    } finally {
      if (previousPlaywright === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previousPlaywright;
      if (previousWebsite === undefined) delete process.env.QA_WEBSITE_URL;
      else process.env.QA_WEBSITE_URL = previousWebsite;
    }
  });

  it('falls back to urls.website when playwright.baseURL is absent', () => {
    assert.equal(
      configFallbackPlaywrightBaseUrl({
        playwright: { baseURL: undefined },
        urls: { website: 'https://fallback.example/' },
      }),
      'https://fallback.example'
    );
    assert.equal(
      configFallbackPlaywrightBaseUrl({
        playwright: { baseURL: undefined },
        urls: { website: '' },
      }),
      ''
    );
  });

  it('uses loopback playwright.baseURL before urls.website', () => {
    assert.equal(
      configFallbackPlaywrightBaseUrl({
        playwright: { baseURL: 'http://127.0.0.1:4173' },
        urls: { website: 'https://fallback.example/' },
      }),
      'http://127.0.0.1:4173'
    );
  });

  it('ignores non-loopback playwright.baseURL and uses urls.website', () => {
    assert.equal(
      configFallbackPlaywrightBaseUrl({
        playwright: { baseURL: 'https://www.saucedemo.com' },
        urls: { website: 'https://fallback.example/' },
      }),
      'https://fallback.example'
    );
  });

  it('uses urls.website as the last resolveConfiguredPlaywrightBaseUrl step', () => {
    const previous = process.env.QA_PLAYWRIGHT_BASE_URL;
    const previousWebsite = process.env.QA_WEBSITE_URL;
    delete process.env.QA_PLAYWRIGHT_BASE_URL;
    delete process.env.QA_WEBSITE_URL;
    try {
      assert.equal(
        resolveConfiguredPlaywrightBaseUrl({
          lastTargetUrl: null,
          configBaseUrl: configFallbackPlaywrightBaseUrl({
            urls: { website: 'https://fallback.example/' },
          }),
        }),
        'https://fallback.example'
      );
    } finally {
      if (previous === undefined) delete process.env.QA_PLAYWRIGHT_BASE_URL;
      else process.env.QA_PLAYWRIGHT_BASE_URL = previous;
      if (previousWebsite === undefined) delete process.env.QA_WEBSITE_URL;
      else process.env.QA_WEBSITE_URL = previousWebsite;
    }
  });

  it('fails clearly when the resolved URL is not http(s)', () => {
    assert.throws(() => assertValidPlaywrightBaseUrl(''), /REQUIRES_CONFIGURATION/);
    assert.throws(() => assertValidPlaywrightBaseUrl('ftp://example.com'), /REQUIRES_CONFIGURATION/);
    assert.throws(() => applyCliWebsiteTarget(['--url=not-a-url']), /Invalid --url/);
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

describe('resolveWebsiteTarget', () => {
  it('follows CLI → Playwright env → website env → last-target → seed → loopback → website', () => {
    assert.equal(
      resolveWebsiteTarget({
        cliUrl: 'https://cli.example/',
        playwrightEnvUrl: 'https://pw.example/',
        websiteEnvUrl: 'https://web.example/',
        lastTargetUrl: 'https://last.example/',
        existingSeed: 'https://seed.example/',
        playwrightBaseUrl: 'http://127.0.0.1:4173',
        websiteUrl: 'https://www.saucedemo.com/',
      }),
      'https://cli.example/'
    );
    assert.equal(
      resolveWebsiteTarget({
        playwrightEnvUrl: 'https://pw.example/',
        websiteEnvUrl: 'https://web.example/',
        lastTargetUrl: 'https://last.example/',
        existingSeed: 'https://seed.example/',
        playwrightBaseUrl: 'http://127.0.0.1:4173',
        websiteUrl: 'https://www.saucedemo.com/',
      }),
      'https://pw.example/'
    );
    assert.equal(
      resolveWebsiteTarget({
        websiteEnvUrl: 'https://web.example/',
        lastTargetUrl: 'https://last.example/',
        existingSeed: 'https://seed.example/',
        playwrightBaseUrl: 'http://127.0.0.1:4173',
        websiteUrl: 'https://www.saucedemo.com/',
      }),
      'https://web.example/'
    );
    assert.equal(
      resolveWebsiteTarget({
        lastTargetUrl: 'https://last.example/',
        existingSeed: 'https://seed.example/',
        playwrightBaseUrl: 'http://127.0.0.1:4173',
        websiteUrl: 'https://www.saucedemo.com/',
      }),
      'https://last.example/'
    );
    assert.equal(
      resolveWebsiteTarget({
        existingSeed: 'https://seed.example/',
        playwrightBaseUrl: 'http://127.0.0.1:4173',
        websiteUrl: 'https://www.saucedemo.com/',
      }),
      'https://seed.example/'
    );
    assert.equal(
      resolveWebsiteTarget({
        playwrightBaseUrl: 'http://127.0.0.1:4173',
        websiteUrl: 'https://www.saucedemo.com/',
      }),
      'http://127.0.0.1:4173/'
    );
    assert.equal(
      resolveWebsiteTarget({
        playwrightBaseUrl: 'https://www.saucedemo.com',
        websiteUrl: 'https://www.saucedemo.com/',
      }),
      'https://www.saucedemo.com/'
    );
  });
});

describe('resolveApiUrl', () => {
  it('prefers QA_API_URL over urls.api and never invents a host', () => {
    const previous = process.env.QA_API_URL;
    process.env.QA_API_URL = 'https://api-env.example/';
    try {
      assert.equal(resolveApiUrl({ apiUrl: 'https://jsonplaceholder.typicode.com' }), 'https://api-env.example');
    } finally {
      if (previous === undefined) delete process.env.QA_API_URL;
      else process.env.QA_API_URL = previous;
    }
    assert.equal(
      resolveApiUrl({ envUrl: '', apiUrl: 'https://jsonplaceholder.typicode.com/' }),
      'https://jsonplaceholder.typicode.com'
    );
    assert.equal(resolveApiUrl({ envUrl: '', apiUrl: '' }), '');
  });
});
