import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PATHS } from './paths';
import {
  assertNoCliDeletionTargets,
  assertSafeCleanTarget,
  CLEAN_ALLOWLIST_RELATIVE,
  isAllowlistedCleanTarget,
  isHistoricalArtifactPath,
  listCleanAllowlistTargets,
  resolveCleanupRoot,
  shouldKeepArtifacts,
  toPosixRelative,
} from './clean-test-data';

function rel(target: string): string {
  return toPosixRelative(target);
}

describe('clean-test-data allowlist', () => {
  it('is allowlist-only and never targets the entire reports/ tree', () => {
    const relatives: string[] = listCleanAllowlistTargets().map(rel);
    assert.equal(relatives.includes('reports'), false);
    assert.equal(relatives.includes('reports/allure'), false);
    assert.equal(relatives.includes('reports/history'), false);
    assert.equal(relatives.includes('reports/allure/history'), false);
    assert.equal(relatives.includes('reports/allure/results'), true);
    assert.equal(relatives.includes('reports/allure/report'), true);
    assert.deepEqual(relatives, [...CLEAN_ALLOWLIST_RELATIVE]);
    for (const target of listCleanAllowlistTargets()) {
      assert.equal(isAllowlistedCleanTarget(target), true);
      assert.equal(isHistoricalArtifactPath(target), false);
    }
  });

  it('resolves allowlist paths from PATHS.root (same as process.cwd() in npm scripts)', () => {
    const root = resolveCleanupRoot();
    assert.equal(path.resolve(root), path.resolve(PATHS.root));
    for (const target of listCleanAllowlistTargets()) {
      assert.equal(toPosixRelative(target, root).includes('..'), false);
    }
  });

  it('only targets generated paths under the repo root', () => {
    const root = path.resolve(PATHS.root);
    for (const target of listCleanAllowlistTargets()) {
      const resolved = path.resolve(target);
      assert.ok(resolved.startsWith(root + path.sep), resolved);
      const relative = path.relative(root, resolved).replace(/\\/g, '/');
      assert.notEqual(relative, 'qa.config.json');
      assert.notEqual(relative, 'qa.last-target.json');
      assert.ok(!relative.startsWith('pages/'));
      assert.ok(!relative.startsWith('tests/e2e/'));
      assert.ok(!relative.startsWith('scripts/'));
      assert.ok(!relative.startsWith('visual-baselines/'));
    }
  });
});

describe('clean-test-data historical refusal', () => {
  it('refuses timestamped professional packs under docs/input|output/qa-test-results', () => {
    const stamp = path.join(PATHS.docsQaTestResultsOutput, '2026-09-17_18-17-10');
    assert.equal(isHistoricalArtifactPath(PATHS.docsQaTestResultsInput), true);
    assert.equal(isHistoricalArtifactPath(PATHS.docsQaTestResultsOutput), true);
    assert.equal(isHistoricalArtifactPath(PATHS.docsQaTestResultsLatest), true);
    assert.equal(isHistoricalArtifactPath(stamp), true);
    assert.throws(() => assertSafeCleanTarget(PATHS.docsQaTestResultsInput), /historical/i);
    assert.throws(() => assertSafeCleanTarget(PATHS.docsQaTestResultsOutput), /historical/i);
    assert.throws(() => assertSafeCleanTarget(stamp), /historical/i);
    assert.throws(
      () => assertSafeCleanTarget(path.join(PATHS.docsQaTestResultsInput, '2026-09-17_18-17-10')),
      /historical/i
    );
  });

  it('refuses reports/history and reports/allure/history', () => {
    assert.equal(isHistoricalArtifactPath(PATHS.reports.history), true);
    assert.equal(isHistoricalArtifactPath(PATHS.reportsHistory), true);
    assert.equal(isHistoricalArtifactPath(PATHS.allureHistory), true);
    assert.equal(
      isHistoricalArtifactPath(path.join(PATHS.reports.history, '2026-09-17_18-17-10.json')),
      true
    );
    assert.throws(() => assertSafeCleanTarget(PATHS.reports.history), /historical/i);
    assert.throws(() => assertSafeCleanTarget(PATHS.allureHistory), /historical/i);
    assert.throws(
      () => assertSafeCleanTarget(path.join(PATHS.allureHistory, '2026-09-17_18-01-50')),
      /historical/i
    );
  });

  it('refuses timestamped PKT execution folders under reports/history', () => {
    const pkt = path.join(PATHS.reports.history, 'QA-Automation_2026-09-17_19-12-03_PKT');
    const pktCollision = path.join(PATHS.reports.history, 'QA-Automation_2026-09-17_19-12-03_PKT_01');
    const metadata = path.join(pkt, 'execution-metadata.json');
    assert.equal((CLEAN_ALLOWLIST_RELATIVE as readonly string[]).includes('reports/history'), false);
    assert.equal(isHistoricalArtifactPath(pkt), true);
    assert.equal(isHistoricalArtifactPath(pktCollision), true);
    assert.equal(isHistoricalArtifactPath(metadata), true);
    assert.equal(isAllowlistedCleanTarget(pkt), false);
    assert.throws(() => assertSafeCleanTarget(pkt), /historical/i);
    assert.throws(() => assertSafeCleanTarget(pktCollision), /historical/i);
    assert.throws(() => assertSafeCleanTarget(metadata), /historical/i);
  });

  it('refuses PKT folders that contain MASTER-QA-REPORT.html / .json', () => {
    const pkt = path.join(PATHS.reports.history, 'QA-Automation_2026-09-17_19-30-26_PKT');
    const html = path.join(pkt, 'MASTER-QA-REPORT.html');
    const json = path.join(pkt, 'MASTER-QA-REPORT.json');
    const modules = path.join(pkt, 'modules', 'coverage', 'coverage.json');
    const evidence = path.join(pkt, 'evidence', 'screenshots', 'test-failed-1.png');
    for (const target of [pkt, html, json, modules, evidence]) {
      assert.equal(isHistoricalArtifactPath(target), true);
      assert.equal(isAllowlistedCleanTarget(target), false);
      assert.throws(() => assertSafeCleanTarget(target), /historical/i);
    }
  });
});

describe('clean-test-data safety', () => {
  it('does not accept an arbitrary CLI path for deletion', () => {
    assert.doesNotThrow(() => assertNoCliDeletionTargets([]));
    assert.throws(() => assertNoCliDeletionTargets(['reports/history']), /does not accept deletion paths/i);
    assert.throws(
      () => assertNoCliDeletionTargets(['docs/output/qa-test-results/2026-09-17_18-17-10']),
      /does not accept deletion paths/i
    );
    assert.throws(() => assertNoCliDeletionTargets(['C:\\Windows\\Temp']), /does not accept deletion paths/i);
    assert.throws(() => assertNoCliDeletionTargets(['--path=reports/playwright']), /does not accept deletion paths/i);
  });

  it('fails safely on unexpected or protected paths', () => {
    assert.throws(() => assertSafeCleanTarget(PATHS.reports.root), /would wipe archived report history/i);
    assert.throws(() => assertSafeCleanTarget(PATHS.reports.allure), /would wipe archived report history/i);
    assert.throws(() => assertSafeCleanTarget(path.join(PATHS.root, 'package-lock.json')), /protected/i);
    assert.throws(() => assertSafeCleanTarget(PATHS.visualBaselinesDir), /protected/i);
    assert.throws(() => assertSafeCleanTarget(PATHS.jenkinsDir), /protected/i);
    assert.throws(() => assertSafeCleanTarget(path.join(PATHS.root, '.cursor', 'rules')), /protected/i);
    assert.throws(() => assertSafeCleanTarget(path.join(PATHS.root, '.git')), /protected/i);
    assert.throws(
      () => assertSafeCleanTarget(path.join(PATHS.root, '.github', 'workflows')),
      /protected/i
    );
    assert.throws(
      () => assertSafeCleanTarget(path.join(PATHS.root, 'not-an-allowlisted-artifact')),
      /not on allowlist/i
    );
    assert.equal((CLEAN_ALLOWLIST_RELATIVE as readonly string[]).includes('qa.last-target.json'), false);
    assert.equal(isAllowlistedCleanTarget(PATHS.lastTarget), false);
    assert.throws(() => assertSafeCleanTarget(PATHS.lastTarget), /protected/i);
  });

  it('honors --keep-artifacts for orchestrators only (qa:clean itself takes no args)', () => {
    assert.equal(shouldKeepArtifacts(['--url=https://example.com/']), false);
    assert.equal(shouldKeepArtifacts(['--keep-artifacts']), true);
  });

  it('preserves discovery/test-case-identities.json (not allowlisted temp discovery JSON)', () => {
    const identityFile = PATHS.testCaseIdentitiesFile;
    assert.equal(rel(identityFile), 'discovery/test-case-identities.json');
    assert.equal(isAllowlistedCleanTarget(identityFile), false);
    assert.equal(
      (CLEAN_ALLOWLIST_RELATIVE as readonly string[]).includes('discovery/test-case-identities.json'),
      false
    );
    assert.throws(() => assertSafeCleanTarget(identityFile), /protected|not on allowlist/i);
  });
});
