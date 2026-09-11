import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import { classifyFailure, isDurationNearTimeout, TIMEOUT_PROXIMITY_RATIO } from './classify';
import { DEFAULT_CLASSIFICATION_TIMEOUTS_MS } from './timeouts';
import type { FailureEvidence } from './types';

function evidence(partial: Partial<FailureEvidence>): FailureEvidence {
  return {
    id: 'PW-0001',
    source: 'e2e',
    title: 'example',
    testId: 'tests/e2e/example.spec.ts::example::chromium',
    specFile: 'tests/e2e/example.spec.ts',
    projectName: 'chromium',
    errorMessage: NOT_AVAILABLE,
    stackTrace: NOT_AVAILABLE,
    durationMs: NOT_AVAILABLE,
    retryCount: 0,
    attemptStatuses: ['failed'],
    screenshotPath: null,
    screenshotPresent: false,
    tracePath: null,
    videoPath: null,
    ...partial,
  };
}

describe('timeout proximity', () => {
  it('treats a duration within 5% of a configured timeout as near', () => {
    const nav = DEFAULT_CLASSIFICATION_TIMEOUTS_MS.navigationTimeoutMs;
    assert.equal(isDurationNearTimeout(nav, nav), true);
    assert.equal(isDurationNearTimeout(nav * (1 - TIMEOUT_PROXIMITY_RATIO), nav), true);
    assert.equal(isDurationNearTimeout(nav * (1 + TIMEOUT_PROXIMITY_RATIO), nav), true);
    assert.equal(isDurationNearTimeout(nav * (1 - TIMEOUT_PROXIMITY_RATIO - 0.01), nav), false);
  });
});

describe('classifyFailure', () => {
  it('classifies duration near navigation timeout as NAVIGATION_TIMEOUT, not assertion', () => {
    const row = classifyFailure(
      evidence({
        errorMessage: 'expect(page).toHaveURL("https://example.com/")',
        durationMs: 34_200,
      })
    );
    assert.equal(row.classification, 'NAVIGATION_TIMEOUT');
    assert.equal(row.ruleFired, 'TIMEOUT_NEAR_DURATION_NAVIGATION');
    assert.match(row.rationale, /not an assertion failure/);
  });

  it('classifies duration near test timeout as NAVIGATION_TIMEOUT', () => {
    const row = classifyFailure(
      evidence({
        errorMessage: '\u001b[31mTest timeout of 60000ms exceeded.\u001b[39m',
        durationMs: 60_123,
      })
    );
    assert.equal(row.classification, 'NAVIGATION_TIMEOUT');
    assert.equal(row.ruleFired, 'TIMEOUT_NEAR_DURATION_NAVIGATION');
  });

  it('classifies duration near expect/action timeout as ELEMENT_TIMEOUT, not assertion', () => {
    const row = classifyFailure(
      evidence({
        errorMessage: 'expect(locator).toBeVisible() Expected: visible',
        durationMs: 9_800,
      })
    );
    assert.equal(row.classification, 'ELEMENT_TIMEOUT');
    assert.equal(row.ruleFired, 'TIMEOUT_NEAR_DURATION_ELEMENT');
  });

  it('classifies duration near action timeout with locator text as ELEMENT_TIMEOUT', () => {
    const row = classifyFailure(
      evidence({
        errorMessage: 'locator.click: Timeout 15000ms exceeded. waiting for locator("button")',
        durationMs: 15_200,
      })
    );
    assert.equal(row.classification, 'ELEMENT_TIMEOUT');
    assert.equal(row.ruleFired, 'TIMEOUT_NEAR_DURATION_ELEMENT');
  });

  it('classifies assertion mismatch far from any timeout as ASSERTION_FAILURE', () => {
    const row = classifyFailure(
      evidence({
        errorMessage: 'expect(received).toBe(expected)\nExpected: true\nReceived: false',
        durationMs: 1_200,
      })
    );
    assert.equal(row.classification, 'ASSERTION_FAILURE');
    assert.equal(row.ruleFired, 'ERROR_TEXT_ASSERTION');
  });

  it('classifies connection refusal as NETWORK_ERROR', () => {
    const row = classifyFailure(
      evidence({
        errorMessage: 'page.goto: net::ERR_CONNECTION_REFUSED at https://example.com',
        durationMs: 80,
      })
    );
    assert.equal(row.classification, 'NETWORK_ERROR');
    assert.equal(row.ruleFired, 'ERROR_TEXT_NETWORK');
  });

  it('classifies page console errors as CONSOLE_ERROR', () => {
    const row = classifyFailure(
      evidence({
        errorMessage: 'pageerror: Uncaught exception in page: TypeError: x is undefined',
        durationMs: 400,
      })
    );
    assert.equal(row.classification, 'CONSOLE_ERROR');
    assert.equal(row.ruleFired, 'ERROR_TEXT_CONSOLE');
  });

  it('classifies missing browser binary as ENVIRONMENT', () => {
    const row = classifyFailure(
      evidence({
        errorMessage: "browserType.launch: Executable doesn't exist. Run npx playwright install",
        durationMs: 20,
      })
    );
    assert.equal(row.classification, 'ENVIRONMENT');
    assert.equal(row.ruleFired, 'ERROR_TEXT_ENVIRONMENT');
  });

  it('classifies mixed pass/fail attempts as FLAKY', () => {
    const row = classifyFailure(
      evidence({
        errorMessage: 'expect(received).toBe(expected)\nExpected: 1\nReceived: 0',
        durationMs: 900,
        attemptStatuses: ['failed', 'passed', 'failed'],
      })
    );
    assert.equal(row.classification, 'FLAKY');
    assert.equal(row.ruleFired, 'MIXED_RETRY_OUTCOMES');
  });

  it('falls back to error-text navigation timeout when duration is NOT_AVAILABLE', () => {
    const row = classifyFailure(
      evidence({
        errorMessage: 'page.goto: Timeout 35000ms exceeded. waiting for navigation',
        durationMs: NOT_AVAILABLE,
      })
    );
    assert.equal(row.classification, 'NAVIGATION_TIMEOUT');
    assert.equal(row.ruleFired, 'ERROR_TEXT_NAVIGATION_TIMEOUT');
  });

  it('records UNKNOWN and NOT_AVAILABLE excerpt when no error text exists', () => {
    const row = classifyFailure(evidence({ errorMessage: NOT_AVAILABLE, stackTrace: NOT_AVAILABLE }));
    assert.equal(row.classification, 'UNKNOWN');
    assert.equal(row.ruleFired, 'INSUFFICIENT_EVIDENCE');
    assert.equal(row.evidenceExcerpt, NOT_AVAILABLE);
  });
});
