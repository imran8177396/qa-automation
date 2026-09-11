import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PATHS } from './paths';
import {
  isHistoricalQaReportPath,
  listRunArtifactTargets,
  shouldKeepArtifacts,
} from './clean-run-artifacts';

describe('clean-run-artifacts', () => {
  it('only targets generated paths under the repo root', () => {
    const root = path.resolve(PATHS.root);
    for (const target of listRunArtifactTargets()) {
      const resolved = path.resolve(target);
      assert.ok(resolved.startsWith(root + path.sep), resolved);
      const relative = path.relative(root, resolved).replace(/\\/g, '/');
      assert.notEqual(relative, 'qa.config.json');
      assert.ok(!relative.startsWith('pages/'));
      assert.ok(!relative.startsWith('tests/e2e/'));
      assert.ok(!relative.startsWith('scripts/'));
      assert.ok(!relative.startsWith('visual-baselines/'));
    }
  });

  it('does not wipe historical professional QA report packs', () => {
    const relatives = listRunArtifactTargets().map((target) =>
      path.relative(PATHS.root, target).replace(/\\/g, '/')
    );
    assert.ok(!relatives.includes('docs/input/qa-test-results'));
    assert.ok(!relatives.includes('docs/output/qa-test-results'));
    assert.ok(!relatives.some((entry) => entry.startsWith('docs/input/qa-test-results/')));
    assert.ok(!relatives.some((entry) => entry.startsWith('docs/output/qa-test-results/')));
    for (const target of listRunArtifactTargets()) {
      assert.equal(isHistoricalQaReportPath(target), false);
    }
    assert.equal(isHistoricalQaReportPath(PATHS.docsQaTestResultsInput), true);
    assert.equal(isHistoricalQaReportPath(PATHS.docsQaTestResultsOutput), true);
    assert.equal(isHistoricalQaReportPath(PATHS.docsQaTestResultsLatest), true);
    assert.equal(
      isHistoricalQaReportPath(path.join(PATHS.docsQaTestResultsOutput, '2026-09-10_19-12-03')),
      true
    );
  });

  it('honors --keep-artifacts', () => {
    assert.equal(shouldKeepArtifacts(['--url=https://example.com/']), false);
    assert.equal(shouldKeepArtifacts(['--keep-artifacts']), true);
  });
});
