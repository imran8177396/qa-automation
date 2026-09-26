import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gatePerformanceRun, isHeavyAuthorized } from './authorize';

describe('performance authorization', () => {
  it('allows liveness, smoke, and baseline without --authorize-heavy', () => {
    assert.equal(isHeavyAuthorized('liveness', { authorizeHeavy: false }), true);
    assert.equal(isHeavyAuthorized('smoke', { authorizeHeavy: false }), true);
    assert.equal(isHeavyAuthorized('baseline', { authorizeHeavy: false }), true);
    const gate = gatePerformanceRun({
      profile: 'liveness',
      apiUrl: 'https://api.example.test',
      authorizeHeavy: false,
      allowHeavyAgainst: [],
    });
    assert.equal(gate.ok, true);
    assert.match(gate.message, /RECORDED/);
  });

  it('blocks heavy profiles without authorization', () => {
    for (const profile of ['load', 'stress', 'spike', 'soak'] as const) {
      const gate = gatePerformanceRun({
        profile,
        apiUrl: 'https://api.example.test',
        authorizeHeavy: false,
        allowHeavyAgainst: [],
      });
      assert.equal(gate.ok, false);
      assert.equal(gate.code, 'NOT_AUTHORIZED');
      // Unauthorized heavy must be refused — never treated as PASS.
      assert.notEqual(gate.ok, true);
      assert.notEqual(String(gate.code), 'PASS');
    }
  });

  it('refuses an authorized heavy run against a host that is not allowlisted', () => {
    const gate = gatePerformanceRun({
      profile: 'load',
      apiUrl: 'https://app.example.test/',
      authorizeHeavy: true,
      allowHeavyAgainst: ['api.allowed.test'],
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.code, 'TARGET_NOT_ALLOWED');
  });
});
