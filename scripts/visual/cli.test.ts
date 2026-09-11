import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVisualCli } from './cli';

test('test:visual never enables baseline updates', () => {
  assert.deepEqual(resolveVisualCli(['node', 'run-visual.ts']), {
    updateBaselines: false,
    extraArgs: [],
  });
});

test('bare --update-snapshots is refused', () => {
  assert.throws(
    () => resolveVisualCli(['node', 'run-visual.ts', '--update-snapshots']),
    /not accepted as a new baseline/
  );
  assert.throws(() => resolveVisualCli(['node', 'run-visual.ts', '-u']), /not accepted as a new baseline/);
  assert.throws(
    () => resolveVisualCli(['node', 'run-visual.ts', '--update-snapshots=changed']),
    /not accepted as a new baseline/
  );
});

test('--approve-baseline-update is the only way to write baselines', () => {
  assert.deepEqual(resolveVisualCli(['node', 'run-visual.ts', '--approve-baseline-update']), {
    updateBaselines: true,
    extraArgs: [],
  });
});

test('approved update still strips Playwright update flags from passthrough args', () => {
  const resolved = resolveVisualCli([
    'node',
    'run-visual.ts',
    '--approve-baseline-update',
    '--update-snapshots',
    '--headed',
  ]);
  assert.equal(resolved.updateBaselines, true);
  assert.deepEqual(resolved.extraArgs, ['--headed']);
});
