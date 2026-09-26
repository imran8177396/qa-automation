import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QaConfig } from '../types';
import {
  mapPerformanceProfileAlias,
  resolvePerformanceProfile,
} from './profiles';

function baseConfig(overrides: Partial<QaConfig> & { urls?: QaConfig['urls']; jmeter?: QaConfig['jmeter']; tests?: QaConfig['tests'] } = {}): QaConfig {
  return {
    project: { name: 'QA Automation' },
    urls: { website: '', api: 'https://api.example.test', ...(overrides.urls ?? {}) },
    pipeline: { steps: ['sync', 'api', 'e2e', 'load'], failFast: false },
    postman: { enabled: true, collectionName: 'QA Automation API', requests: [] },
    playwright: { enabled: true, browsers: ['chromium'], headless: true },
    jmeter: {
      enabled: true,
      path: '/posts',
      threads: 10,
      rampUpSeconds: 5,
      loopCount: 1,
      defaultProfile: 'liveness',
      allowHeavyAgainst: [],
      profiles: {
        liveness: { threads: 10, rampUpSeconds: 5, loopCount: 1 },
        load: { threads: 20, rampUpSeconds: 20, loopCount: 5 },
        stress: { threads: 50, rampUpSeconds: 10, loopCount: 10 },
        spike: { threads: 40, rampUpSeconds: 1, loopCount: 3 },
        soak: { threads: 10, rampUpSeconds: 30, loopCount: -1, durationSeconds: 300 },
      },
      ...(overrides.jmeter ?? {}),
    },
    github: { branches: ['main'], runOnPullRequest: true },
    tests: {
      unit: { enabled: true },
      integration: { enabled: false, checks: [] },
      contract: { enabled: false, contracts: [], usePostmanRequests: false, executeNegative: false },
      database: { enabled: false, urlEnv: 'DATABASE_URL' },
      smoke: { enabled: true },
      sanity: { enabled: false, checks: [] },
      regression: { enabled: true, mode: 'selective' },
      performance: {
        enabled: true,
        load: { enabled: false },
        stress: { enabled: false },
        spike: { enabled: false },
        endurance: { enabled: false },
      },
      reliability: { enabled: false },
      resilience: { enabled: false },
      localization: { enabled: false },
      ai: { enabled: false },
      ...(overrides.tests ?? {}),
    },
  };
}

describe('performance profile resolution', () => {
  it('maps baseline to the same liveness plan numbers (never a fake PASS)', () => {
    const config = baseConfig();
    const baseline = resolvePerformanceProfile('baseline', config, { authorizeHeavy: false });
    const liveness = resolvePerformanceProfile('liveness', config, { authorizeHeavy: false });
    assert.equal(baseline.ok, true);
    assert.equal(liveness.ok, true);
    if (!baseline.ok || !liveness.ok) return;
    assert.equal(baseline.resolved.id, 'liveness');
    assert.equal(baseline.resolved.heavy, false);
    assert.equal(baseline.resolved.threads, liveness.resolved.threads);
    assert.equal(baseline.resolved.rampUpSeconds, liveness.resolved.rampUpSeconds);
    assert.equal(baseline.resolved.loopCount, liveness.resolved.loopCount);
    assert.equal(baseline.resolved.planPath, liveness.resolved.planPath);
    const alias = mapPerformanceProfileAlias('baseline');
    assert.equal(alias.mapped, true);
    if (alias.mapped) assert.equal(alias.id, 'liveness');
  });

  it('maps endurance to the soak plan', () => {
    const config = baseConfig({
      tests: {
        unit: { enabled: true },
        integration: { enabled: false, checks: [] },
        contract: { enabled: false, contracts: [], usePostmanRequests: false, executeNegative: false },
        database: { enabled: false, urlEnv: 'DATABASE_URL' },
        smoke: { enabled: true },
        sanity: { enabled: false, checks: [] },
        regression: { enabled: true, mode: 'selective' },
        performance: {
          enabled: true,
          load: { enabled: false },
          stress: { enabled: false },
          spike: { enabled: false },
          endurance: { enabled: true },
        },
        reliability: { enabled: false },
        resilience: { enabled: false },
        localization: { enabled: false },
        ai: { enabled: false },
      },
    });
    const endurance = resolvePerformanceProfile('endurance', config, { authorizeHeavy: true });
    const soak = resolvePerformanceProfile(config, 'soak');
    assert.equal(endurance.ok, true);
    if (!endurance.ok) return;
    assert.equal(endurance.resolved.id, 'soak');
    assert.equal(endurance.resolved.heavy, true);
    assert.equal(endurance.resolved.threads, soak.threads);
    assert.equal(endurance.resolved.rampUpSeconds, soak.rampUpSeconds);
    assert.equal(endurance.resolved.loopCount, soak.loopCount);
    assert.equal(endurance.resolved.durationSeconds, soak.durationSeconds);
    assert.equal(endurance.resolved.planPath, soak.planPath);
  });

  it('returns NOT_TESTED for load when tests.performance.load is disabled (does not launch JMeter)', () => {
    const config = baseConfig();
    const decision = resolvePerformanceProfile('load', config, { authorizeHeavy: false });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.status, 'NOT_TESTED');
    assert.match(decision.reason, /profile disabled in tests\.performance/);
    assert.equal(decision.id, 'load');
  });

  it('returns BLOCKED for load when enabled but not authorized', () => {
    const config = baseConfig({
      tests: {
        unit: { enabled: true },
        integration: { enabled: false, checks: [] },
        contract: { enabled: false, contracts: [], usePostmanRequests: false, executeNegative: false },
        database: { enabled: false, urlEnv: 'DATABASE_URL' },
        smoke: { enabled: true },
        sanity: { enabled: false, checks: [] },
        regression: { enabled: true, mode: 'selective' },
        performance: {
          enabled: true,
          load: { enabled: true },
          stress: { enabled: false },
          spike: { enabled: false },
          endurance: { enabled: false },
        },
        reliability: { enabled: false },
        resilience: { enabled: false },
        localization: { enabled: false },
        ai: { enabled: false },
      },
    });
    const decision = resolvePerformanceProfile('load', config, { authorizeHeavy: false });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.status, 'BLOCKED');
    assert.match(decision.reason, /authorize-heavy|QA_PERF_AUTHORIZE/);
  });

  it('returns NOT_TESTED for volume with no fabricated metrics', () => {
    const decision = resolvePerformanceProfile('volume', baseConfig(), { authorizeHeavy: true });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.status, 'NOT_TESTED');
    assert.match(decision.reason, /volume\/scalability profile is not implemented/);
    assert.equal(decision.resolved, null);
    assert.equal(decision.id, null);
  });

  it('returns NOT_TESTED for scalability', () => {
    const decision = resolvePerformanceProfile('scalability', baseConfig(), { authorizeHeavy: true });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.status, 'NOT_TESTED');
    assert.match(decision.reason, /volume\/scalability profile is not implemented/);
  });

  it('returns REQUIRES_CONFIGURATION when the API URL is empty', () => {
    const config = baseConfig({ urls: { website: '', api: '' } });
    const decision = resolvePerformanceProfile('baseline', config, { authorizeHeavy: false });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.status, 'REQUIRES_CONFIGURATION');
    assert.match(decision.reason, /REQUIRES_CONFIGURATION/);
    assert.doesNotMatch(decision.reason, /jsonplaceholder|saucedemo/i);
  });

  it('returns NOT_TESTED for endurance when tests.performance.endurance is disabled', () => {
    const decision = resolvePerformanceProfile('endurance', baseConfig(), { authorizeHeavy: true });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.status, 'NOT_TESTED');
    assert.match(decision.reason, /profile disabled in tests\.performance/);
    assert.equal(decision.id, 'soak');
  });
});
