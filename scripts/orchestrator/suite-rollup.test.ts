import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSuiteRollup,
  formatSuiteRollupBanner,
  orchestratorProcessExitCode,
  resolveOverallStatus,
} from './suite-rollup';
import type { StageResult } from './types';

function stage(key: string, status: StageResult['status']): StageResult {
  const now = '2026-09-16T00:00:00.000Z';
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

describe('suite rollup', () => {
  it('prints the contract banner labels', () => {
    const banner = formatSuiteRollupBanner([
      { label: 'PLAYWRIGHT', status: 'PASS' },
      { label: 'POSTMAN', status: 'PASS' },
      { label: 'JMETER', status: 'RECORDED' },
      { label: 'ACCESSIBILITY', status: 'FAIL' },
      { label: 'VISUAL', status: 'NOT_EXECUTED' },
      { label: 'RESPONSIVE', status: 'PASS' },
      { label: 'SECURITY', status: 'FAIL' },
      { label: 'SEO', status: 'FAIL' },
      { label: 'COVERAGE', status: 'PASS', percent: 42 },
      { label: 'OVERALL', status: 'FAIL' },
    ]);
    assert.match(banner, /PLAYWRIGHT \/ POSTMAN \/ JMETER \/ ACCESSIBILITY \/ VISUAL \/ RESPONSIVE \/ SECURITY \/ SEO \/ COVERAGE \/ OVERALL/);
    assert.match(banner, /PLAYWRIGHT\s+PASS/);
    assert.match(banner, /JMETER\s+RECORDED/);
    assert.match(banner, /COVERAGE\s+42%/);
    assert.match(banner, /OVERALL\s+FAIL/);
  });

  it('does not claim OVERALL PASS when accessibility, security, or SEO failed', () => {
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
    assert.equal(rollup.overall, 'FAIL');
    assert.equal(rollup.lines.find((row) => row.label === 'ACCESSIBILITY')?.status, 'FAIL');
    assert.equal(rollup.lines.find((row) => row.label === 'SECURITY')?.status, 'FAIL');
    assert.equal(rollup.lines.find((row) => row.label === 'SEO')?.status, 'FAIL');
    assert.notEqual(rollup.lines.find((row) => row.label === 'OVERALL')?.status, 'PASS');
  });

  it('treats JMeter RECORDED as satisfied and visual NOT_EXECUTED as OVERALL BLOCKED', () => {
    const rollup = buildSuiteRollup(
      [
        stage('e2e', 'PASS'),
        stage('api', 'PASS'),
        stage('performance', 'PASS'),
        stage('accessibility', 'PASS'),
        stage('visual', 'NOT_EXECUTED'),
        stage('responsive', 'PASS'),
        stage('security', 'PASS'),
        stage('seo', 'PASS'),
        stage('coverage', 'PASS'),
      ],
      { jmeterStatus: 'RECORDED', coveragePercent: 55, uiStatus: 'RECORDED' }
    );
    assert.equal(rollup.lines.find((row) => row.label === 'JMETER')?.status, 'RECORDED');
    assert.equal(rollup.lines.find((row) => row.label === 'VISUAL')?.status, 'NOT_EXECUTED');
    assert.equal(rollup.overall, 'BLOCKED');
    assert.notEqual(rollup.overall, 'PASS');
  });

  it('maps security warnings to WARNING and not PASS', () => {
    const rollup = buildSuiteRollup([stage('security', 'PASS')], {
      security: { failCount: 0, warningCount: 2, blockedCount: 0, passCount: 3 },
    });
    assert.equal(rollup.lines.find((row) => row.label === 'SECURITY')?.status, 'WARNING');
  });

  it('resolveOverallStatus is FAIL before BLOCKED', () => {
    assert.equal(
      resolveOverallStatus([
        { label: 'PLAYWRIGHT', status: 'FAIL' },
        { label: 'VISUAL', status: 'NOT_EXECUTED' },
      ]),
      'FAIL'
    );
  });

  it('exits 1 when OVERALL is FAIL even if every child process exited 0', () => {
    const rollup = buildSuiteRollup([stage('e2e', 'PASS'), stage('security', 'PASS')], {
      security: { failCount: 2, warningCount: 0, blockedCount: 0, passCount: 1 },
    });
    assert.equal(rollup.overall, 'FAIL');
    assert.equal(orchestratorProcessExitCode(rollup.overall, 0), 1);
    assert.equal(orchestratorProcessExitCode('BLOCKED', 0), 0);
    assert.equal(orchestratorProcessExitCode('WARNING', 0), 0);
    assert.equal(orchestratorProcessExitCode('PASS', 1), 1);
  });
});
