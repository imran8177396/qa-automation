import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../lib/load-config';
import { JMETER_PROFILE_FOLDERS, relativeJmeterPlanPath, resolveJmeterPlanPath } from './plans';
import { resolvePerformanceProfile } from './profiles';

describe('JMeter plan folders', () => {
  it('maps liveness to the smoke folder and keeps heavy profiles in their own folders', () => {
    assert.equal(JMETER_PROFILE_FOLDERS.liveness, 'smoke');
    assert.equal(JMETER_PROFILE_FOLDERS.load, 'load');
    assert.equal(JMETER_PROFILE_FOLDERS.stress, 'stress');
    assert.equal(JMETER_PROFILE_FOLDERS.spike, 'spike');
    assert.equal(JMETER_PROFILE_FOLDERS.soak, 'soak');
  });

  it('resolves generated documented-api plans under tests/performance/jmeter/', () => {
    const config = loadConfig();
    const liveness = resolvePerformanceProfile(config, 'liveness');
    const load = resolvePerformanceProfile(config, 'load');
    assert.match(relativeJmeterPlanPath('liveness'), /tests\/performance\/jmeter\/smoke\/documented-api\.jmx$/);
    assert.match(relativeJmeterPlanPath('load'), /tests\/performance\/jmeter\/load\/documented-api\.jmx$/);
    assert.equal(liveness.planPath, resolveJmeterPlanPath('liveness'));
    assert.equal(load.planPath, resolveJmeterPlanPath('load'));
    assert.equal(liveness.heavy, false);
    assert.equal(load.heavy, true);
  });
});
