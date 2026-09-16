import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import { classifyFailure } from './classify';
import { classifyOwner } from './owner';
import type { FailureClass, FailureEvidence } from './types';

const FIXTURES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'synthetic-errors.json'), 'utf8')
) as Record<string, { errorMessage: string; stackTrace: string }>;

function evidence(partial: Partial<FailureEvidence>): FailureEvidence {
  return {
    id: 'FIX-0001',
    source: 'e2e',
    title: 'synthetic',
    testId: 'tests/e2e/synthetic.spec.ts::synthetic::chromium',
    specFile: 'tests/e2e/synthetic.spec.ts',
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

function fromFixture(name: keyof typeof FIXTURES, extra: Partial<FailureEvidence> = {}): FailureEvidence {
  const fixture = FIXTURES[name];
  return evidence({
    errorMessage: fixture.errorMessage,
    stackTrace: fixture.stackTrace,
    ...extra,
  });
}

function ownerOf(name: keyof typeof FIXTURES, extra?: Partial<FailureEvidence>, mechanism?: FailureClass) {
  const row = fromFixture(name, extra);
  if (mechanism) return classifyOwner(row, mechanism);
  return classifyFailure(row);
}

describe('owner classification fixtures', () => {
  it('classifies axe / heading failures as APPLICATION', () => {
    const row = classifyFailure(fromFixture('applicationAxe', { source: 'accessibility' }));
    assert.equal(row.ownerClassification, 'APPLICATION');
    assert.equal(row.originalStatus, 'FAIL');
    assert.notEqual(row.ownerClassification, 'UNKNOWN');
  });

  it('classifies SEO missing-h1 fixture as APPLICATION', () => {
    const row = classifyFailure(fromFixture('applicationSeo', { source: 'seo', title: 'missing-h1' }));
    assert.equal(row.ownerClassification, 'APPLICATION');
    assert.equal(row.classification, 'ASSERTION_FAILURE');
  });

  it('classifies missing security header fixture as APPLICATION', () => {
    const row = classifyFailure(
      fromFixture('applicationSecurityHeader', { source: 'security', title: 'content-security-policy' })
    );
    assert.equal(row.ownerClassification, 'APPLICATION');
  });

  it('classifies locator timeout as AUTOMATION (mechanism ELEMENT_TIMEOUT)', () => {
    const row = classifyFailure(
      fromFixture('automationLocatorTimeout', { durationMs: 15_200 })
    );
    assert.equal(row.classification, 'ELEMENT_TIMEOUT');
    assert.equal(row.ownerClassification, 'AUTOMATION');
  });

  it('classifies assertion mismatch as APPLICATION and does not convert to PASS', () => {
    const row = classifyFailure(fromFixture('assertionMismatch', { durationMs: 800 }));
    assert.equal(row.classification, 'ASSERTION_FAILURE');
    assert.equal(row.ownerClassification, 'APPLICATION');
    assert.equal(row.originalStatus, 'FAIL');
  });

  it('classifies missing browser binary as ENVIRONMENT', () => {
    const row = classifyFailure(fromFixture('environmentBrowserMissing', { durationMs: 20 }));
    assert.equal(row.classification, 'ENVIRONMENT');
    assert.equal(row.ownerClassification, 'ENVIRONMENT');
  });

  it('classifies fixture/seed data text as TEST_DATA', () => {
    const row = classifyFailure(fromFixture('testDataFixture', { durationMs: 400 }));
    assert.equal(row.ownerClassification, 'TEST_DATA');
  });

  it('classifies missing credentials as CONFIGURATION', () => {
    const row = classifyFailure(fromFixture('configurationMissing'));
    assert.equal(row.ownerClassification, 'CONFIGURATION');
  });

  it('classifies connection refused as NETWORK', () => {
    const row = classifyFailure(fromFixture('networkRefused', { durationMs: 80 }));
    assert.equal(row.classification, 'NETWORK_ERROR');
    assert.equal(row.ownerClassification, 'NETWORK');
  });

  it('classifies Firefox teardown + Browser logs as BROWSER', () => {
    const row = classifyFailure(
      fromFixture('browserFirefoxTeardown', { projectName: 'firefox', durationMs: 60_100 })
    );
    assert.equal(row.ownerClassification, 'BROWSER');
  });

  it('classifies missing module as DEPENDENCY', () => {
    const row = classifyFailure(fromFixture('dependencyMissingModule', { source: 'dependencies' }));
    assert.equal(row.ownerClassification, 'DEPENDENCY');
  });

  it('records UNKNOWN with reason when evidence is insufficient', () => {
    const row = ownerOf('insufficient');
    assert.equal(row.ownerClassification, 'UNKNOWN');
    assert.match(row.ownerRationale ?? '', /Insufficient evidence/i);
  });
});
