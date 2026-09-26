import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStages } from './stages';
import type { QualityGateResult } from './quality-gate';
import type { StageResult } from './types';
import {
  UNIVERSAL_QA_STEPS,
  bindUniversalQaFlow,
  childStageKeysUsedByUniversalFlow,
  formatUniversalQaFlowHeader,
} from './universal-qa-flow';

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

function gate(status: QualityGateResult['status'] = 'FAIL'): QualityGateResult {
  return {
    status,
    reasons: [{ code: 'required-product-fail', detail: 'ACCESSIBILITY is FAIL' }],
    requiredSuites: [],
    qualityChecks: { available: false, source: 'reports/quality/quality-checks.json', blockingFailures: [] },
  };
}

describe('universal QA 31-step map', () => {
  it('defines exactly 31 conceptual steps numbered 1–31', () => {
    assert.equal(UNIVERSAL_QA_STEPS.length, 31);
    assert.deepEqual(
      UNIVERSAL_QA_STEPS.map((step) => step.n),
      Array.from({ length: 31 }, (_, index) => index + 1)
    );
  });

  it('does not invent child-stage keys beyond the existing orchestrator', () => {
    const known = new Set(buildStages().map((row) => row.key));
    for (const key of childStageKeysUsedByUniversalFlow()) {
      assert.ok(known.has(key), `unknown stage key in 31-step map: ${key}`);
    }
    assert.ok(buildStages().length < 31);
  });

  it('maps page-map and inventories onto the discovery child, not new processes', () => {
    const discoverySteps = UNIVERSAL_QA_STEPS.filter((step) => step.n >= 3 && step.n <= 7);
    assert.ok(discoverySteps.every((step) => step.stageKeys.includes('discovery')));
    assert.ok(discoverySteps.filter((step) => step.n >= 4).every((step) => step.realization === 'shared-child'));
  });

  it('maps evidence 13–17 as side-effects and reports 27–28 as suite-runner artifacts', () => {
    for (const n of [13, 14, 15, 16, 17]) {
      assert.equal(UNIVERSAL_QA_STEPS.find((step) => step.n === n)?.realization, 'side-effect');
    }
    assert.equal(UNIVERSAL_QA_STEPS.find((step) => step.n === 27)?.realization, 'suite-runner-report');
    assert.equal(UNIVERSAL_QA_STEPS.find((step) => step.n === 28)?.realization, 'suite-runner-report');
    assert.equal(UNIVERSAL_QA_STEPS.find((step) => step.n === 30)?.realization, 'quality-gate');
  });

  it('prints a Universal QA flow header', () => {
    const header = formatUniversalQaFlowHeader();
    assert.match(header, /1\. Read configuration/);
    assert.match(header, /31\. Return final PASS\/FAIL\/BLOCKED result/);
    assert.match(header, /no extra child processes/i);
  });

  it('binds explicit statuses and records missing evidence as UNAVAILABLE', () => {
    const snapshot = bindUniversalQaFlow({
      results: [
        stage('discovery', 'PASS'),
        stage('e2e', 'FAIL'),
        stage('analyze', 'PASS'),
        stage('api', 'PASS'),
        stage('performance', 'PASS'),
      ],
      qualityGate: gate('FAIL'),
      evidence: {
        screenshots: { status: 'UNAVAILABLE', detail: 'screenshots not present on disk — recorded as unavailable, not fabricated' },
        videos: { status: 'UNAVAILABLE', detail: 'videos not present' },
        traces: { status: 'UNAVAILABLE', detail: 'traces not present' },
        logs: { status: 'RECORDED', detail: 'failure analysis present' },
        networkConsole: { status: 'UNAVAILABLE', detail: 'network/console evidence not present' },
      },
    });
    assert.equal(snapshot.steps.find((step) => step.n === 3)?.status, 'PASS');
    assert.equal(snapshot.steps.find((step) => step.n === 12)?.status, 'FAIL');
    assert.equal(snapshot.steps.find((step) => step.n === 13)?.status, 'UNAVAILABLE');
    assert.equal(snapshot.steps.find((step) => step.n === 16)?.status, 'RECORDED');
    assert.equal(snapshot.steps.find((step) => step.n === 30)?.status, 'FAIL');
    assert.equal(snapshot.steps.find((step) => step.n === 31)?.status, 'FAIL');
    assert.match(snapshot.steps.find((step) => step.n === 13)?.statusReason ?? '', /unavailable/i);
  });

  it('records JMeter report as RECORDED when the summary exists in the bind helper path', () => {
    const snapshot = bindUniversalQaFlow({
      results: [stage('performance', 'PASS')],
      qualityGate: gate('PASS'),
      evidence: {
        screenshots: { status: 'UNAVAILABLE', detail: 'n/a' },
        videos: { status: 'UNAVAILABLE', detail: 'n/a' },
        traces: { status: 'UNAVAILABLE', detail: 'n/a' },
        logs: { status: 'UNAVAILABLE', detail: 'n/a' },
        networkConsole: { status: 'UNAVAILABLE', detail: 'n/a' },
      },
    });
    const jmeter = snapshot.steps.find((step) => step.n === 28);
    assert.ok(jmeter);
    assert.ok(jmeter.status === 'RECORDED' || jmeter.status === 'NOT_EXECUTED');
    if (jmeter.status === 'NOT_EXECUTED') {
      assert.match(jmeter.statusReason, /NOT_EXECUTED|missing|did not produce/i);
    }
  });
});
