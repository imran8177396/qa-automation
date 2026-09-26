import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PATHS } from '../lib/paths';
import {
  A11Y_AUTOMATED_LIMIT,
  REAL_DEVICE_EMULATION_DISCLAIMER,
  RECORDED_OUTCOME_STATUSES,
  SAFETY_PROHIBITIONS,
  assertNoFullWcagClaim,
  assertNoRealDeviceClaim,
  assertRecordedOutcome,
  reasonRequired,
} from './safety-policy';
import { makeResult } from './engine-contract';

const REASON_REQUIRED = [
  'BLOCKED',
  'NOT_TESTED',
  'SKIPPED',
  'REQUIRES_CONFIGURATION',
  'TIMEOUT',
  'CANCELLED',
  'FLAKY',
] as const;

test('RECORDED_OUTCOME_STATUSES includes required statuses and NOT_APPLICABLE', () => {
  for (const status of [
    'PASS',
    'FAIL',
    'BLOCKED',
    'NOT_TESTED',
    'SKIPPED',
    'REQUIRES_CONFIGURATION',
    'NOT_APPLICABLE',
    'TIMEOUT',
    'CANCELLED',
    'FLAKY',
  ]) {
    assert.ok((RECORDED_OUTCOME_STATUSES as readonly string[]).includes(status), status);
  }
});

test('reasonRequired is true for BLOCKED / NOT_TESTED / SKIPPED / REQUIRES_CONFIGURATION / TIMEOUT / CANCELLED / FLAKY', () => {
  for (const status of REASON_REQUIRED) {
    assert.equal(reasonRequired(status), true);
    assert.notEqual(status, 'PASS');
  }
  assert.equal(reasonRequired('PASS'), false);
  assert.equal(reasonRequired('FAIL'), false);
  assert.equal(reasonRequired('NOT_APPLICABLE'), false);
});

test('assertRecordedOutcome throws when reason-required statuses lack a reason', () => {
  for (const status of REASON_REQUIRED) {
    assert.throws(
      () => assertRecordedOutcome({ status }),
      /requires a non-empty reason/
    );
    assert.throws(
      () => assertRecordedOutcome({ status, error: { message: '   ' }, metadata: { reason: '' } }),
      /requires a non-empty reason/
    );
  }
});

test('assertRecordedOutcome accepts reason-required statuses with a non-empty reason', () => {
  for (const status of REASON_REQUIRED) {
    assert.doesNotThrow(() =>
      assertRecordedOutcome({ status, error: { message: `${status} because dependency missing` } })
    );
    assert.doesNotThrow(() =>
      assertRecordedOutcome({ status, metadata: { reason: `${status}: gated` } })
    );
    assert.doesNotThrow(() => assertRecordedOutcome({ status, reason: `${status}: explicit` }));
  }
  assert.doesNotThrow(() => assertRecordedOutcome({ status: 'PASS' }));
  assert.doesNotThrow(() => assertRecordedOutcome({ status: 'FAIL' }));
});

test('makeResult enforces reason for reason-required statuses', () => {
  assert.throws(
    () =>
      makeResult({
        id: 'x',
        testType: 'unit',
        category: 'functional',
        name: 'blocked without reason',
        status: 'BLOCKED',
      }),
    /requires a non-empty reason/
  );
  assert.doesNotThrow(() =>
    makeResult({
      id: 'y',
      testType: 'unit',
      category: 'functional',
      name: 'blocked with reason',
      status: 'BLOCKED',
      error: { message: 'tool missing' },
      metadata: { reason: 'tool missing' },
    })
  );
  assert.doesNotThrow(() =>
    makeResult({
      id: 'z',
      testType: 'unit',
      category: 'functional',
      name: 'pass ok',
      status: 'PASS',
    })
  );
});

test('REAL_DEVICE_EMULATION_DISCLAIMER is the emulation sentence', () => {
  assert.equal(
    REAL_DEVICE_EMULATION_DISCLAIMER,
    'Results are desktop browser-engine emulation, not real-device testing.'
  );
  assert.doesNotThrow(() => assertNoRealDeviceClaim(REAL_DEVICE_EMULATION_DISCLAIMER, false));
  assert.throws(
    () => assertNoRealDeviceClaim('Suite has real device coverage on phones', false),
    /real-device coverage/
  );
});

test('assertNoFullWcagClaim rejects full WCAG compliance claims', () => {
  assert.throws(() => assertNoFullWcagClaim('This site has full WCAG compliance'), /full WCAG/);
  assert.throws(() => assertNoFullWcagClaim('Page is WCAG compliant'), /WCAG/);
  assert.throws(() => assertNoFullWcagClaim('WCAG AA certified product'), /WCAG/);
  assert.doesNotThrow(() => assertNoFullWcagClaim(A11Y_AUTOMATED_LIMIT));
  assert.equal(A11Y_AUTOMATED_LIMIT, 'Automated axe checks are not full WCAG compliance.');
});

test('.gitignore includes a .env line', () => {
  const gitignore = fs.readFileSync(path.join(PATHS.root, '.gitignore'), 'utf8');
  assert.ok(
    gitignore.split(/\r?\n/).some((line) => line.trim() === '.env'),
    '.gitignore must contain a line that is exactly .env'
  );
});

test('SAFETY_PROHIBITIONS lists the ten Never items', () => {
  assert.equal(SAFETY_PROHIBITIONS.length, 10);
  assert.ok(SAFETY_PROHIBITIONS.some((line) => /fabricate/i.test(line)));
  assert.ok(SAFETY_PROHIBITIONS.some((line) => /missing dependencies/i.test(line)));
  assert.ok(SAFETY_PROHIBITIONS.some((line) => /real-device/i.test(line)));
  assert.ok(SAFETY_PROHIBITIONS.some((line) => /WCAG/i.test(line)));
  assert.ok(SAFETY_PROHIBITIONS.some((line) => /heavy performance/i.test(line)));
  assert.ok(SAFETY_PROHIBITIONS.some((line) => /destructive resilience/i.test(line)));
  assert.ok(SAFETY_PROHIBITIONS.some((line) => /automatically delete production data/i.test(line)));
  assert.ok(SAFETY_PROHIBITIONS.some((line) => /secret/i.test(line)));
  assert.ok(SAFETY_PROHIBITIONS.some((line) => /\.env/i.test(line)));
  assert.ok(SAFETY_PROHIBITIONS.some((line) => /weaken assertions/i.test(line)));
});
