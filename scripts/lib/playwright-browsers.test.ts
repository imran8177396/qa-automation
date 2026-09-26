import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL_PLAYWRIGHT_BROWSERS,
  MISSING_CHROMIUM_UNIT_REASON,
  missingPlaywrightEngineReason,
  playwrightProjectArgs,
  resolveCompulsoryPlaywrightBrowsers,
  resolveCrossBrowserEngines,
  resolvePlaywrightBrowsers,
} from './playwright-browsers';

describe('compulsory Playwright browsers', () => {
  it('always returns chromium, firefox, and webkit even when config lists chromium only', () => {
    assert.deepEqual(resolvePlaywrightBrowsers({
      enabled: true,
      baseURL: 'https://example.com',
      browsers: ['chromium'],
      headless: true,
    }), ['chromium', 'firefox', 'webkit']);
    assert.deepEqual(resolvePlaywrightBrowsers({
      enabled: true,
      baseURL: 'https://example.com',
      browser: 'chromium',
      headless: true,
    }), ['chromium', 'firefox', 'webkit']);
    assert.deepEqual(resolvePlaywrightBrowsers({
      enabled: true,
      baseURL: 'https://example.com',
      headless: true,
    }), [...ALL_PLAYWRIGHT_BROWSERS]);
  });

  it('keeps dedicated cross-browser engines identical to the compulsory default', () => {
    assert.deepEqual(resolveCrossBrowserEngines(), resolveCompulsoryPlaywrightBrowsers());
    assert.deepEqual(resolveCompulsoryPlaywrightBrowsers(), ['chromium', 'firefox', 'webkit']);
  });

  it('names a missing Chromium binary as BLOCKED / REQUIRES_CONFIGURATION, not a silent skip', () => {
    assert.match(MISSING_CHROMIUM_UNIT_REASON, /REQUIRES_CONFIGURATION|BLOCKED/);
    assert.match(MISSING_CHROMIUM_UNIT_REASON, /do not skip this silently/i);
  });

  it('missing dependency reason cannot be PASS', () => {
    for (const browser of ALL_PLAYWRIGHT_BROWSERS) {
      const reason = missingPlaywrightEngineReason(browser);
      assert.match(reason, /NOT_TESTED|BLOCKED/);
      assert.doesNotMatch(reason, /\bPASS\b/);
    }
  });

  it('builds --project args for every compulsory engine', () => {
    assert.deepEqual(playwrightProjectArgs(['chromium', 'firefox', 'webkit']), [
      '--project=chromium',
      '--project=firefox',
      '--project=webkit',
    ]);
  });
});
