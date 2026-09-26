import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolvePerformanceCli } from './cli';

describe('performance CLI', () => {
  it('defaults to liveness without --authorize-heavy', () => {
    const cli = resolvePerformanceCli([]);
    assert.equal(cli.profile, 'liveness');
    assert.equal(cli.authorizeHeavy, false);
  });

  it('treats smoke and baseline as the liveness alias and still does not authorize heavy', () => {
    assert.equal(resolvePerformanceCli(['--profile=smoke']).profile, 'liveness');
    assert.equal(resolvePerformanceCli(['--profile=baseline']).profile, 'liveness');
    assert.equal(resolvePerformanceCli(['--profile=smoke']).authorizeHeavy, false);
  });

  it('maps endurance to soak for CLI profile without authorizing heavy', () => {
    const cli = resolvePerformanceCli(['--profile=endurance']);
    assert.equal(cli.profile, 'soak');
    assert.equal(cli.rawProfile, 'endurance');
    assert.equal(cli.authorizeHeavy, false);
  });

  it('passes volume through without inventing a plan id', () => {
    const cli = resolvePerformanceCli(['--profile=volume']);
    assert.equal(cli.profile, 'volume');
    assert.equal(cli.authorizeHeavy, false);
  });

  it('requires an explicit flag for heavy authorization', () => {
    assert.equal(resolvePerformanceCli(['--profile=load']).authorizeHeavy, false);
    assert.equal(resolvePerformanceCli(['--profile=load', '--authorize-heavy']).authorizeHeavy, true);
  });
});
