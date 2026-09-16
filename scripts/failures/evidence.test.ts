import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import {
  buildEvidenceRefs,
  extractBrowserLogs,
  extractNetworkExcerpt,
  resolveExistingArtifact,
} from './evidence';
import type { FailureEvidence } from './types';

function evidence(partial: Partial<FailureEvidence>): FailureEvidence {
  return {
    id: 'EV-0001',
    source: 'e2e',
    title: 'synthetic',
    testId: 'synthetic',
    specFile: NOT_AVAILABLE,
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

describe('evidence collectors', () => {
  it('extracts Browser logs from error text and marks console present', () => {
    const logs = extractBrowserLogs('Timeout.\nBrowser logs:\n<launching> firefox.exe\n[GFX1-]: fail');
    assert.match(logs, /firefox\.exe/);
    const refs = buildEvidenceRefs(
      evidence({
        errorMessage: 'Timeout.\nBrowser logs:\n<launching> firefox.exe',
        consoleLog: logs,
        consolePresent: true,
      })
    );
    assert.equal(refs.availability.console, 'present');
    assert.equal(refs.availability.screenshot, 'unavailable');
  });

  it('extracts network excerpt and does not invent a screenshot', () => {
    const network = extractNetworkExcerpt('page.goto: net::ERR_CONNECTION_REFUSED at https://example.test');
    assert.match(network, /ERR_CONNECTION_REFUSED/);
    const refs = buildEvidenceRefs(
      evidence({
        errorMessage: 'page.goto: net::ERR_CONNECTION_REFUSED',
        networkLog: network,
        networkPresent: true,
        screenshotPath: null,
        screenshotPresent: false,
      })
    );
    assert.equal(refs.screenshot, NOT_AVAILABLE);
    assert.equal(refs.availability.screenshot, 'unavailable');
    assert.equal(refs.availability.network, 'present');
  });

  it('marks a missing recorded path as unavailable', () => {
    const resolved = resolveExistingArtifact('test-results/does-not-exist/trace.zip');
    assert.equal(resolved.present, false);
    assert.ok(resolved.recordedPath);
  });
});
