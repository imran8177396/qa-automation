import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyQualityGateToRollup,
  collectQualityGateReasons,
  determineQualityGate,
  evaluateQualityGates,
  evaluateReleaseGate,
  formatQualityGateBanner,
} from './quality-gate';
import { buildSuiteRollup, resolveOverallStatus } from './suite-rollup';
import type { StageResult } from './types';

function stage(key: string, status: StageResult['status']): StageResult {
  const now = '2026-09-17T00:00:00.000Z';
  return {
    id: 1,
    key,
    name: key,
    status,
    exitCode: status === 'FAIL' ? 1 : 0,
    startedAt: now,
    finishedAt: now,
    completedAt: now,
    durationMs: 1,
  };
}

const passingRequired = [
  { label: 'PLAYWRIGHT' as const, status: 'PASS' as const },
  { label: 'POSTMAN' as const, status: 'PASS' as const },
  { label: 'JMETER' as const, status: 'RECORDED' as const, detail: 'liveness/smoke only — never PASS; no --authorize-heavy' },
  { label: 'ACCESSIBILITY' as const, status: 'PASS' as const },
  { label: 'VISUAL' as const, status: 'PASS' as const },
  { label: 'RESPONSIVE' as const, status: 'PASS' as const },
  { label: 'SECURITY' as const, status: 'PASS' as const },
  { label: 'SEO' as const, status: 'PASS' as const },
  { label: 'COVERAGE' as const, status: 'PASS' as const, percent: 40 },
];

describe('quality gate', () => {
  it('is FAIL when accessibility, security, or SEO failed — never PASS', () => {
    for (const label of ['ACCESSIBILITY', 'SECURITY', 'SEO'] as const) {
      const required = passingRequired.map((line) => (line.label === label ? { ...line, status: 'FAIL' as const } : line));
      const gate = determineQualityGate({ required, qualityChecks: [] });
      assert.equal(gate.status, 'FAIL');
      assert.notEqual(gate.status, 'PASS');
      assert.ok(gate.reasons.some((reason) => reason.detail.includes(label)));
    }
  });

  it('does not treat JMeter RECORDED as FAIL', () => {
    const gate = determineQualityGate({ required: passingRequired, qualityChecks: [] });
    assert.equal(gate.status, 'PASS');
    assert.ok(!gate.reasons.some((reason) => reason.code.startsWith('required-suite') && reason.detail.includes('JMETER')));
  });

  it('is BLOCKED when a required suite is NOT_EXECUTED', () => {
    const required = passingRequired.map((line) =>
      line.label === 'VISUAL' ? { ...line, status: 'NOT_EXECUTED' as const } : line
    );
    const gate = determineQualityGate({ required, qualityChecks: [] });
    assert.equal(gate.status, 'BLOCKED');
    assert.ok(gate.reasons.some((reason) => reason.code === 'required-suite-not-executed'));
  });

  it('is FAIL when a required suite is WARNING (not PASS; no invented SLA)', () => {
    const required = passingRequired.map((line) =>
      line.label === 'SECURITY' ? { ...line, status: 'WARNING' as const } : line
    );
    assert.equal(resolveOverallStatus(required), 'FAIL');
    const gate = determineQualityGate({ required, qualityChecks: [] });
    assert.equal(gate.status, 'FAIL');
    assert.ok(gate.reasons.some((reason) => reason.code === 'required-suite-warning'));
  });

  it('upgrades to FAIL when a blocking report quality-check failed', () => {
    const gate = determineQualityGate({
      required: passingRequired,
      qualityChecks: [{ id: 'zero-exec-pass', result: 'FAIL', detail: 'Suite visual rendered PASS with 0 executed items.' }],
    });
    assert.equal(gate.status, 'FAIL');
    assert.ok(gate.reasons.some((reason) => reason.code === 'quality-check-fail'));
  });

  it('records missing quality-checks as unavailable, not a fabricated FAIL', () => {
    const gate = determineQualityGate({ required: passingRequired, qualityChecks: null });
    assert.equal(gate.status, 'PASS');
    assert.equal(gate.qualityChecks.available, false);
    assert.ok(gate.reasons.some((reason) => reason.code === 'quality-checks-unavailable'));
  });

  it('does not let a non-blocking tautological quality-check fail the gate', () => {
    const gate = determineQualityGate({
      required: passingRequired,
      qualityChecks: [
        { id: 'tautological-assertions', result: 'FAIL', detail: '1 tautological assertion listed.' },
      ],
    });
    assert.equal(gate.status, 'PASS');
    assert.ok(!gate.reasons.some((reason) => reason.code === 'quality-check-fail'));
  });

  it('FAIL takes precedence over BLOCKED', () => {
    const required = [
      { label: 'PLAYWRIGHT' as const, status: 'FAIL' as const },
      { label: 'VISUAL' as const, status: 'NOT_EXECUTED' as const },
    ];
    assert.equal(resolveOverallStatus(required), 'FAIL');
    assert.ok(collectQualityGateReasons(required).some((reason) => reason.code === 'required-suite-fail'));
  });

  it('stamps OVERALL on the suite rollup and prints a gate banner', () => {
    const rollup = buildSuiteRollup(
      [
        stage('e2e', 'PASS'),
        stage('api', 'PASS'),
        stage('performance', 'PASS'),
        stage('accessibility', 'FAIL'),
        stage('visual', 'PASS'),
        stage('responsive', 'PASS'),
        stage('security', 'FAIL'),
        stage('seo', 'FAIL'),
        stage('coverage', 'PASS'),
      ],
      { jmeterStatus: 'RECORDED', coveragePercent: 40, uiStatus: 'RECORDED' }
    );
    const gate = determineQualityGate({ required: rollup.lines, qualityChecks: [] });
    const stamped = applyQualityGateToRollup(rollup, gate);
    assert.equal(stamped.overall, 'FAIL');
    assert.equal(stamped.lines.find((line) => line.label === 'OVERALL')?.status, 'FAIL');
    assert.match(formatQualityGateBanner(gate), /QUALITY GATE/);
    assert.match(formatQualityGateBanner(gate), /Status:\s+FAIL/);
  });

  it('evaluateReleaseGate default-open does not block; explicit blockRelease does', () => {
    const open = evaluateReleaseGate({ criticalFailures: 5, coveragePct: 10 });
    assert.equal(open.block, false);
    assert.deepEqual(open.reasons, []);

    const closed = evaluateReleaseGate(
      { coveragePct: 10 },
      { blockRelease: true, minCoveragePct: 80 }
    );
    assert.equal(closed.block, true);
    assert.ok(closed.reasons.some((r) => /coverage/.test(r)));
  });
});

describe('evaluateQualityGates', () => {
  it('enabled false with 10 critical failures → PASS; results still FAIL', () => {
    const results = Array.from({ length: 10 }, (_, i) => ({
      testId: `t-${i}`,
      status: 'FAIL',
      priority: 'critical',
    }));
    const gate = evaluateQualityGates({ results }, { enabled: false });
    assert.equal(gate.status, 'PASS');
    assert.ok(gate.reasons.some((r) => /disabled/i.test(r)));
    assert.equal(gate.results.length, 10);
    assert.ok(gate.results.every((row) => row.status === 'FAIL'));
    assert.equal(gate.results, results);
    assert.equal('qualityScore' in gate, false);
  });

  it('enabled true, criticalFailures 0, one critical FAIL → FAIL; result still FAIL', () => {
    const results = [{ testId: 'c1', status: 'FAIL', priority: 'critical' }];
    const gate = evaluateQualityGates({ results }, { enabled: true, criticalFailures: 0 });
    assert.equal(gate.status, 'FAIL');
    assert.ok(gate.reasons.some((r) => /critical failures 1 exceeds limit 0/.test(r)));
    assert.equal(gate.results[0]?.status, 'FAIL');
    assert.equal('qualityScore' in gate, false);
  });

  it('enabled true, minCoverage 80, coveragePct null → BLOCKED, not PASS', () => {
    const results = [{ testId: 'ok', status: 'PASS' }];
    const gate = evaluateQualityGates(
      { results, coveragePct: null },
      { enabled: true, minCoverage: 80 }
    );
    assert.equal(gate.status, 'BLOCKED');
    assert.ok(gate.reasons.includes('coverage not measured'));
    assert.notEqual(gate.status, 'PASS');
  });

  it('enabled true, minCoverage 80, coveragePct 90, no failures → PASS', () => {
    const results = [{ testId: 'ok', status: 'PASS' }];
    const gate = evaluateQualityGates(
      { results, coveragePct: 90 },
      { enabled: true, minCoverage: 80 }
    );
    assert.equal(gate.status, 'PASS');
    assert.ok(gate.reasons.includes('quality gates passed'));
  });

  it('enabled true, maxFailedTests 0, one FAIL → FAIL', () => {
    const results = [{ testId: 'f1', status: 'FAIL' }];
    const gate = evaluateQualityGates({ results }, { enabled: true, maxFailedTests: 0 });
    assert.equal(gate.status, 'FAIL');
    assert.ok(gate.reasons.some((r) => /failed tests 1 exceeds limit 0/.test(r)));
    assert.equal(gate.results[0]?.status, 'FAIL');
  });

  it('enabled true, maxHighSecurityFindings 0, findings omitted → BLOCKED', () => {
    const results = [{ testId: 'ok', status: 'PASS' }];
    const gate = evaluateQualityGates({ results }, { enabled: true, maxHighSecurityFindings: 0 });
    assert.equal(gate.status, 'BLOCKED');
    assert.ok(gate.reasons.includes('security findings not measured'));
  });

  it('BLOCKED takes precedence when coverage null and critical failure both present', () => {
    const results = [{ testId: 'c1', status: 'FAIL', priority: 'critical' }];
    const gate = evaluateQualityGates(
      { results, coveragePct: null },
      { enabled: true, minCoverage: 80, criticalFailures: 0 }
    );
    assert.equal(gate.status, 'BLOCKED');
    assert.ok(gate.reasons.includes('coverage not measured'));
    assert.ok(gate.reasons.some((r) => /critical failures 1 exceeds limit 0/.test(r)));
    assert.equal(gate.results[0]?.status, 'FAIL');
  });

  it('return value has no qualityScore', () => {
    const gate = evaluateQualityGates({ results: [] }, { enabled: true });
    assert.equal('qualityScore' in gate, false);
  });
});
