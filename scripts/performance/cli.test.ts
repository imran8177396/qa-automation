import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolvePerformanceCli } from './cli';

describe('performance CLI', () => {
  it('defaults to liveness without --authorize-heavy', () => {
    const cli = resolvePerformanceCli([]);
    assert.equal(cli.profile, 'liveness');
    assert.equal(cli.authorizeHeavy, false);
  });

  it('treats smoke as the liveness alias and still does not authorize heavy', () => {
    const cli = resolvePerformanceCli(['--profile=smoke']);
    assert.equal(cli.profile, 'liveness');
    assert.equal(cli.authorizeHeavy, false);
  });

  it('requires an explicit flag for heavy authorization', () => {
    assert.equal(resolvePerformanceCli(['--profile=load']).authorizeHeavy, false);
    assert.equal(resolvePerformanceCli(['--profile=load', '--authorize-heavy']).authorizeHeavy, true);
  });
});
