import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gatePerformanceRun, isHeavyAuthorized } from './authorize';

describe('performance authorization', () => {
  it('allows liveness and smoke without --authorize-heavy', () => {
    assert.equal(isHeavyAuthorized('liveness', { authorizeHeavy: false }), true);
    assert.equal(isHeavyAuthorized('smoke', { authorizeHeavy: false }), true);
    const gate = gatePerformanceRun({
      profile: 'liveness',
      apiUrl: 'https://jsonplaceholder.typicode.com',
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
        apiUrl: 'https://jsonplaceholder.typicode.com',
        authorizeHeavy: false,
        allowHeavyAgainst: [],
      });
      assert.equal(gate.ok, false);
      assert.equal(gate.code, 'NOT_AUTHORIZED');
    }
  });

  it('refuses an authorized heavy run against a host that is not allowlisted', () => {
    const gate = gatePerformanceRun({
      profile: 'load',
      apiUrl: 'https://www.saucedemo.com/',
      authorizeHeavy: true,
      allowHeavyAgainst: ['jsonplaceholder.typicode.com'],
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.code, 'TARGET_NOT_ALLOWED');
  });
});
