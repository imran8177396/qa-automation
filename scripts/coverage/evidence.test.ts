import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PerformanceMetrics, PerformanceThresholdResult } from '../performance/types';
import { resolveSuiteStatus } from '../lib/suite-status';
import { jmeterEvidenceStatus, type JmeterEvidenceSource } from './evidence';

const fiveSampleMetrics: PerformanceMetrics = {
  requestCount: 5,
  failures: 0,
  successful: 5,
  errorRatePercent: 0,
  avgMs: 100,
  minMs: 80,
  maxMs: 140,
  p50Ms: 100,
  p90Ms: 140,
  p95Ms: 140,
  p99Ms: 140,
  ttfbMs: 40,
  throughputPerSec: 1,
  avgLatencyMs: 40,
  avgConnectMs: 10,
};

const recordedThresholds: PerformanceThresholdResult = {
  status: 'RECORDED',
  defined: false,
  note: 'Threshold keys are present or omitted without numeric SLAs.',
  comparisons: [
    { metric: 'errorRatePercent', limit: null, actual: 0, passed: null, status: 'NOT_AVAILABLE' },
    { metric: 'p95Ms', limit: null, actual: 140, passed: null, status: 'NOT_AVAILABLE' },
  ],
};

const metThresholds: PerformanceThresholdResult = {
  status: 'met',
  defined: true,
  note: 'Configured performance thresholds were met.',
  comparisons: [
    { metric: 'errorRatePercent', limit: 1, actual: 0, passed: true, status: 'met' },
    { metric: 'p95Ms', limit: 500, actual: 140, passed: true, status: 'met' },
  ],
};

const breachedThresholds: PerformanceThresholdResult = {
  status: 'breached',
  defined: true,
  note: 'Configured performance thresholds were breached.',
  comparisons: [
    { metric: 'errorRatePercent', limit: 1, actual: 0, passed: true, status: 'met' },
    { metric: 'p95Ms', limit: 50, actual: 140, passed: false, status: 'breached' },
  ],
};

function summary(partial: Partial<JmeterEvidenceSource> & Pick<JmeterEvidenceSource, 'profile'>): JmeterEvidenceSource {
  return {
    skipped: false,
    blocked: false,
    metrics: fiveSampleMetrics,
    thresholds: recordedThresholds,
    status: 'RECORDED',
    ...partial,
  };
}

describe('jmeterEvidenceStatus', () => {
  it('maps zero-failure liveness (5 samples) to RECORDED, never PASS', () => {
    const status = jmeterEvidenceStatus(
      summary({
        profile: 'liveness',
        status: 'RECORDED',
        thresholds: recordedThresholds,
      })
    );
    assert.equal(status, 'RECORDED');
    assert.notEqual(status, 'PASS');
  });

  it('maps zero-failure smoke (liveness alias) to RECORDED, never PASS', () => {
    const status = jmeterEvidenceStatus(
      summary({
        profile: 'smoke',
        status: 'RECORDED',
        thresholds: recordedThresholds,
      })
    );
    assert.equal(status, 'RECORDED');
    assert.notEqual(status, 'PASS');
  });

  it('does not treat liveness as PASS even when numeric thresholds would be met', () => {
    const status = jmeterEvidenceStatus(
      summary({
        profile: 'liveness',
        status: 'RECORDED',
        thresholds: metThresholds,
      })
    );
    assert.equal(status, 'RECORDED');
    assert.notEqual(status, 'PASS');
  });

  it('maps undefined-threshold heavy runs to RECORDED instead of inventing PASS', () => {
    const status = jmeterEvidenceStatus(
      summary({
        profile: 'load',
        status: 'RECORDED',
        thresholds: recordedThresholds,
      })
    );
    assert.equal(status, 'RECORDED');
    assert.notEqual(status, 'PASS');
  });

  it('maps NOT_AVAILABLE threshold status to RECORDED', () => {
    const status = jmeterEvidenceStatus(
      summary({
        profile: 'load',
        status: 'NOT_AVAILABLE',
        thresholds: {
          status: 'NOT_AVAILABLE',
          defined: false,
          note: 'No metrics were collected — thresholds were not evaluated.',
          comparisons: [],
        },
      })
    );
    assert.equal(status, 'RECORDED');
    assert.notEqual(status, 'PASS');
  });

  it('keeps sample-failure evidence as FAIL', () => {
    const status = jmeterEvidenceStatus(
      summary({
        profile: 'liveness',
        status: 'RECORDED',
        metrics: { ...fiveSampleMetrics, failures: 2, successful: 3, errorRatePercent: 40 },
      })
    );
    assert.equal(status, 'FAIL');
  });

  it('maps an authorized heavy profile with defined met thresholds to PASS', () => {
    const status = jmeterEvidenceStatus(
      summary({
        profile: 'load',
        status: 'met',
        thresholds: metThresholds,
      })
    );
    assert.equal(status, 'PASS');
  });

  it('maps a heavy profile with breached thresholds to FAIL', () => {
    const status = jmeterEvidenceStatus(
      summary({
        profile: 'load',
        status: 'breached',
        thresholds: breachedThresholds,
      })
    );
    assert.equal(status, 'FAIL');
  });

  it('maps skipped or blocked runs to SKIPPED', () => {
    assert.equal(
      jmeterEvidenceStatus(summary({ profile: 'liveness', skipped: true, metrics: null, status: 'NOT_EXECUTED' })),
      'SKIPPED'
    );
    assert.equal(
      jmeterEvidenceStatus(summary({ profile: 'load', blocked: true, metrics: null, status: 'BLOCKED' })),
      'SKIPPED'
    );
  });

  it('does not use resolveSuiteStatus for a completed zero-failure sample run', () => {
    const suiteWouldPass = resolveSuiteStatus({ executedCount: 5, passedCount: 5, failedCount: 0 });
    assert.equal(suiteWouldPass, 'PASS');
    const evidenceStatus = jmeterEvidenceStatus(summary({ profile: 'liveness' }));
    assert.equal(evidenceStatus, 'RECORDED');
    assert.notEqual(evidenceStatus, suiteWouldPass);
  });
});
