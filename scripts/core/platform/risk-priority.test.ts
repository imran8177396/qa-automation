import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  executeByPriority,
  selectByPriority,
  summarizeDimensions,
  type PrioritizedTest,
} from './risk';

const FIXTURE: PrioritizedTest[] = [
  { testId: 'T-crit', priority: 'critical' },
  { testId: 'T-high', priority: 'high' },
  { testId: 'T-med', priority: 'medium' },
  { testId: 'T-low', priority: 'low', businessCritical: true },
];

describe('selectByPriority', () => {
  it('critical profile selects only critical; preserves input order', () => {
    const result = selectByPriority(FIXTURE, 'critical');
    assert.equal(result.profile, 'critical');
    assert.deepEqual(
      result.selected.map((t) => t.testId),
      ['T-crit'],
    );
    assert.deepEqual(
      result.skipped.map((t) => t.testId),
      ['T-high', 'T-med', 'T-low'],
    );
  });

  it('critical-high selects critical and high, not medium', () => {
    const result = selectByPriority(FIXTURE, 'critical-high');
    assert.deepEqual(
      result.selected.map((t) => t.testId),
      ['T-crit', 'T-high'],
    );
    assert.deepEqual(
      result.skipped.map((t) => t.testId),
      ['T-med', 'T-low'],
    );
  });

  it('full selects all four priorities in input order', () => {
    const result = selectByPriority(FIXTURE, 'full');
    assert.deepEqual(
      result.selected.map((t) => t.testId),
      ['T-crit', 'T-high', 'T-med', 'T-low'],
    );
    assert.deepEqual(result.skipped, []);
  });

  it('empty input yields empty selected and skipped — not a quality score', () => {
    const result = selectByPriority([], 'full');
    assert.deepEqual(result.selected, []);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.businessCritical, []);
  });

  it('businessCritical true on a low test does not put it in critical selection', () => {
    const result = selectByPriority(FIXTURE, 'critical');
    assert.ok(!result.selected.some((t) => t.testId === 'T-low'));
    assert.deepEqual(result.businessCritical, ['T-low']);
  });

  it('preserves input order even when priorities are interleaved', () => {
    const mixed: PrioritizedTest[] = [
      { testId: 'a-low', priority: 'low' },
      { testId: 'b-crit', priority: 'critical' },
      { testId: 'c-high', priority: 'high' },
      { testId: 'd-crit', priority: 'critical' },
    ];
    const result = selectByPriority(mixed, 'critical-high');
    assert.deepEqual(
      result.selected.map((t) => t.testId),
      ['b-crit', 'c-high', 'd-crit'],
    );
  });

  it('rejects unknown priority strings (does not coerce to low)', () => {
    assert.throws(
      () =>
        selectByPriority(
          [{ testId: 'x', priority: 'urgent' as PrioritizedTest['priority'] }],
          'full',
        ),
      /Unknown test priority/,
    );
  });
});

describe('executeByPriority', () => {
  it('critical profile: runOne only for critical; others NOT_TESTED not FAIL', async () => {
    const called: string[] = [];
    const result = await executeByPriority(FIXTURE, 'critical', async (test) => {
      called.push(test.testId);
      return { status: 'PASS' };
    });

    assert.deepEqual(called, ['T-crit']);
    assert.deepEqual(
      result.selected.map((t) => t.testId),
      ['T-crit'],
    );

    const byId = Object.fromEntries(result.results.map((r) => [r.testId, r]));
    assert.equal(byId['T-crit']?.status, 'PASS');
    assert.equal(byId['T-crit']?.executed, true);

    for (const id of ['T-high', 'T-med', 'T-low']) {
      assert.equal(byId[id]?.status, 'NOT_TESTED');
      assert.equal(byId[id]?.executed, false);
      assert.match(byId[id]?.reason ?? '', /not selected by risk profile critical/);
    }
  });

  it('critical-high does not call runOne for medium', async () => {
    const called: string[] = [];
    await executeByPriority(FIXTURE, 'critical-high', async (test) => {
      called.push(test.testId);
      return { status: 'PASS' };
    });
    assert.deepEqual(called, ['T-crit', 'T-high']);
    assert.ok(!called.includes('T-med'));
  });

  it('full selects and runs all four', async () => {
    const called: string[] = [];
    const result = await executeByPriority(FIXTURE, 'full', async (test) => {
      called.push(test.testId);
      return { status: 'PASS' };
    });
    assert.deepEqual(called, ['T-crit', 'T-high', 'T-med', 'T-low']);
    assert.equal(result.skipped.length, 0);
    assert.ok(result.results.every((r) => r.status === 'PASS' && r.executed));
  });

  it('does not rewrite FAIL from runOne to PASS', async () => {
    const result = await executeByPriority(
      [{ testId: 'T-crit', priority: 'critical' }],
      'critical',
      async () => ({ status: 'FAIL' }),
    );
    assert.equal(result.results[0]?.status, 'FAIL');
  });
});

describe('summarizeDimensions', () => {
  it('critical FAIL increments criticalFailures; high FAIL does not', () => {
    const dims = summarizeDimensions([
      { testId: 'c', priority: 'critical', status: 'FAIL' },
      { testId: 'h', priority: 'high', status: 'FAIL' },
      { testId: 'p', priority: 'medium', status: 'PASS' },
    ]);
    assert.equal(dims.testsExecuted, 3);
    assert.equal(dims.testsPassed, 1);
    assert.equal(dims.testsFailed, 2);
    assert.equal(dims.criticalFailures, 1);
  });

  it('extras omitted → coveragePct, performanceRegressions, securityFindings are null', () => {
    const dims = summarizeDimensions([{ testId: 'a', priority: 'low', status: 'PASS' }]);
    assert.equal(dims.coveragePct, null);
    assert.equal(dims.performanceRegressions, null);
    assert.equal(dims.securityFindings, null);
  });

  it('returned object has no qualityScore key', () => {
    const dims = summarizeDimensions([]);
    assert.equal(Object.hasOwn(dims, 'qualityScore'), false);
  });

  it('NOT_TESTED profile skips are not executed, passed, or failed', () => {
    const dims = summarizeDimensions([
      { testId: 'run', priority: 'critical', status: 'PASS' },
      { testId: 'skip', priority: 'low', status: 'NOT_TESTED' },
      { testId: 'flaky', priority: 'high', status: 'FLAKY' },
      { testId: 'blocked', priority: 'medium', status: 'BLOCKED' },
    ]);
    assert.equal(dims.testsExecuted, 3);
    assert.equal(dims.testsPassed, 1);
    assert.equal(dims.testsFailed, 0);
    assert.equal(dims.criticalFailures, 0);
  });

  it('extras are stored as supplied — never invent coverage or security', () => {
    const dims = summarizeDimensions([], {
      coveragePct: 42.5,
      performanceRegressions: 2,
      securityFindings: 1,
    });
    assert.equal(dims.coveragePct, 42.5);
    assert.equal(dims.performanceRegressions, 2);
    assert.equal(dims.securityFindings, 1);
  });
});

describe('committed risk.profile', () => {
  it('qa.config.json risk.profile is full', () => {
    const configPath = path.join(process.cwd(), 'qa.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      risk?: { profile?: string };
    };
    assert.equal(config.risk?.profile, 'full');
  });
});
