import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertionPassRate, uiExecutionPassRate } from '../pass-rate';
import { numberSections } from './section-manifest';
import {
  QualityCheckFailure,
  assertQualityChecksPass,
  countTautologicalAssertions,
  evaluateQualityChecks,
  readTautologicalArtifact,
  reportQualityWarnings,
} from './quality-checks';

const numbered = numberSections();

test('pass-rate conflict fails the quality check', () => {
  const checks = evaluateQualityChecks({
    plannedRefIds: [],
    numberedSections: numbered,
    passRates: [
      uiExecutionPassRate({ passed: 5, failed: 4, skipped: 1 }),
      uiExecutionPassRate({ passed: 5, failed: 5, skipped: 0 }),
    ],
    suites: [],
    productOriginMismatches: [],
    emptyTablesWithoutReason: 0,
    tautologicalArtifact: { present: false },
    crossSuiteArtifactMissing: true,
  });
  const conflict = checks.find((row) => row.id === 'pass-rate-conflict');
  assert.equal(conflict?.result, 'FAIL');
  assert.throws(() => assertQualityChecksPass(checks), (error: unknown) => {
    assert.ok(error instanceof QualityCheckFailure);
    return true;
  });
});

test('identical labelled rates and distinct scopes pass', () => {
  const checks = evaluateQualityChecks({
    plannedRefIds: ['accessibility'],
    numberedSections: numbered,
    passRates: [
      uiExecutionPassRate({ passed: 5, failed: 4, skipped: 1 }),
      assertionPassRate({ passed: 12, executed: 15 }),
    ],
    suites: [{ name: 'visual', status: 'NOT_EXECUTED', executedCount: 0 }],
    productOriginMismatches: [],
    emptyTablesWithoutReason: 0,
    tautologicalArtifact: { present: false },
    crossSuiteArtifactMissing: true,
  });
  assert.equal(checks.find((row) => row.id === 'pass-rate-conflict')?.result, 'PASS');
  assert.equal(checks.find((row) => row.id === 'zero-exec-pass')?.result, 'PASS');
  assert.equal(checks.find((row) => row.id === 'tautological-assertions')?.result, 'NOT_AVAILABLE');
  assert.doesNotThrow(() => assertQualityChecksPass(checks));
});

test('zero executed items rendered PASS fails', () => {
  const checks = evaluateQualityChecks({
    plannedRefIds: [],
    numberedSections: numbered,
    passRates: [],
    suites: [{ name: 'visual', status: 'PASS', executedCount: 0 }],
    productOriginMismatches: [],
    emptyTablesWithoutReason: 0,
    tautologicalArtifact: { present: true, count: 0, path: 'reports/quality/tautological-assertions.json' },
    crossSuiteArtifactMissing: true,
  });
  assert.equal(checks.find((row) => row.id === 'zero-exec-pass')?.result, 'FAIL');
});

test('empty table without reason fails', () => {
  const checks = evaluateQualityChecks({
    plannedRefIds: [],
    numberedSections: numbered,
    passRates: [],
    suites: [],
    productOriginMismatches: [],
    emptyTablesWithoutReason: 1,
    tautologicalArtifact: { present: false },
    crossSuiteArtifactMissing: true,
  });
  assert.equal(checks.find((row) => row.id === 'empty-tables')?.result, 'FAIL');
});

test('tautological check PASSES when artifact count is zero', () => {
  const checks = evaluateQualityChecks({
    plannedRefIds: [],
    numberedSections: numbered,
    passRates: [],
    suites: [],
    productOriginMismatches: [],
    emptyTablesWithoutReason: 0,
    tautologicalArtifact: { present: true, count: 0, path: 'reports/quality/tautological-assertions.json' },
    crossSuiteArtifactMissing: true,
  });
  const row = checks.find((item) => item.id === 'tautological-assertions');
  assert.equal(row?.result, 'PASS');
  assert.match(row?.detail ?? '', /No assertion's expected value was derived from an observed value/);
});

test('tautological check FAILS when artifact lists derived expected values', () => {
  const checks = evaluateQualityChecks({
    plannedRefIds: [],
    numberedSections: numbered,
    passRates: [],
    suites: [],
    productOriginMismatches: [],
    emptyTablesWithoutReason: 0,
    tautologicalArtifact: { present: true, count: 3, path: 'reports/postman/section-2.7.json' },
    crossSuiteArtifactMissing: true,
  });
  assert.equal(checks.find((row) => row.id === 'tautological-assertions')?.result, 'FAIL');
  assert.doesNotThrow(() => assertQualityChecksPass(checks));
  const warnings = reportQualityWarnings(checks);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.id, 'tautological-assertions');
});

test('cross-suite check is rendered PASS when the artifact has no contradictions', () => {
  const checks = evaluateQualityChecks({
    plannedRefIds: [],
    numberedSections: numbered,
    passRates: [],
    suites: [],
    productOriginMismatches: [],
    emptyTablesWithoutReason: 0,
    tautologicalArtifact: { present: false },
    crossSuite: { generatedAt: '2026-09-09T00:00:00.000Z', findings: [], signals: [] },
    crossSuiteArtifactMissing: false,
  });
  const row = checks.find((item) => item.id === 'cross-suite');
  assert.equal(row?.result, 'PASS');
  assert.match(row?.detail ?? '', /No cross-suite contradictions outstanding/);
});

test('cross-suite check is NOT_AVAILABLE when the artifact is missing', () => {
  const checks = evaluateQualityChecks({
    plannedRefIds: [],
    numberedSections: numbered,
    passRates: [],
    suites: [],
    productOriginMismatches: [],
    emptyTablesWithoutReason: 0,
    tautologicalArtifact: { present: false },
    crossSuiteArtifactMissing: true,
  });
  assert.equal(checks.find((row) => row.id === 'cross-suite')?.result, 'NOT_AVAILABLE');
});

test('dangling planned ref fails cross-references check', () => {
  const checks = evaluateQualityChecks({
    plannedRefIds: ['not-a-real-section'],
    numberedSections: numbered,
    passRates: [],
    suites: [],
    productOriginMismatches: [],
    emptyTablesWithoutReason: 0,
    tautologicalArtifact: { present: false },
    crossSuiteArtifactMissing: true,
  });
  assert.equal(checks.find((row) => row.id === 'cross-references')?.result, 'FAIL');
});

test('countTautologicalAssertions reads TAUTOLOGICAL_ASSERTION from section-2.7 shape', () => {
  assert.equal(
    countTautologicalAssertions({
      flaggedAssertions: [
        { assertion: 'statusCode', flags: ['TAUTOLOGICAL_ASSERTION'] },
        { assertion: 'statusCode', flags: ['ROUTING_UNCONFIRMED'] },
      ],
      requests: [
        { flags: ['TAUTOLOGICAL_ASSERTION'] },
        { flags: ['TAUTOLOGICAL_ASSERTION', 'ROUTING_UNCONFIRMED'] },
        { flags: ['UNVERIFIED'] },
      ],
    }),
    2
  );
});

test('readTautologicalArtifact is absent when quality and section-2.7 files are missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-taut-'));
  try {
    assert.deepEqual(readTautologicalArtifact(root), { present: false });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readTautologicalArtifact consumes section-2.7 TAUTOLOGICAL_ASSERTION flags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-taut-'));
  try {
    const dest = path.join(root, 'reports', 'postman');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(dest, 'section-2.7.json'),
      JSON.stringify({
        flaggedAssertions: [{ flags: ['TAUTOLOGICAL_ASSERTION'] }],
        requests: [{ flags: ['TAUTOLOGICAL_ASSERTION'] }],
      }),
      'utf8'
    );
    const artifact = readTautologicalArtifact(root);
    assert.equal(artifact?.present, true);
    assert.equal(artifact?.count, 1);
    assert.equal(artifact?.path, 'reports/postman/section-2.7.json');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
