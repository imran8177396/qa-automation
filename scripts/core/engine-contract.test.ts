import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_RESULT_STATUSES,
  buildEngineSummary,
  isEngineResultStatus,
  makeResult,
  tallyEngineResults,
  type TestContext,
  type TestEngine,
  type TestItem,
  type TestPlan,
  type TestResult,
} from './engine-contract';
import { evaluateReleaseGate } from '../orchestrator/quality-gate';
import { loadConfig } from '../lib/load-config';

function emptyContext(overrides: Partial<TestContext> = {}): TestContext {
  return {
    websiteUrl: '',
    apiUrl: '',
    enabled: true,
    ...overrides,
  };
}

function createFakeEngine(): { engine: TestEngine; getExecuteCalls: () => number } {
  let executeCalls = 0;

  const engine: TestEngine = {
    id: 'unit',
    category: 'functional',
    name: 'Fake unit engine',
    description: 'In-memory TestEngine for contract unit tests (no network).',
    canRun(context: TestContext): boolean {
      if (!context.enabled) return false;
      return context.websiteUrl.trim().length > 0 || context.apiUrl.trim().length > 0;
    },
    async discover(_context: TestContext): Promise<TestItem[]> {
      return [{ id: 'item-1', name: 'Synthetic item' }];
    },
    async plan(context: TestContext): Promise<TestPlan> {
      const items = (await engine.discover?.(context)) ?? [];
      return { engineId: engine.id, items };
    },
    async execute(_context: TestContext, plan: TestPlan): Promise<TestResult[]> {
      executeCalls += 1;
      return plan.items.map((item) => ({
        id: item.id,
        testType: engine.id,
        category: engine.category,
        name: item.name,
        status: 'PASS',
        assertion: { expected: true, actual: true },
      }));
    },
  };

  return { engine, getExecuteCalls: () => executeCalls };
}

test('fake engine satisfies TestEngine and canRun is false when both URLs are empty', () => {
  const { engine, getExecuteCalls } = createFakeEngine();
  const context = emptyContext();

  assert.equal(engine.canRun(context), false);
  assert.equal(getExecuteCalls(), 0, 'execute must not be invoked when canRun is false');
});

test('result status must be one of ENGINE_RESULT_STATUSES including SKIPPED, TIMEOUT, CANCELLED, FLAKY', () => {
  const result: TestResult = {
    id: 'r1',
    testType: 'unit',
    category: 'functional',
    name: 'example',
    status: 'NOT_TESTED',
  };

  assert.equal(isEngineResultStatus(result.status), true);
  assert.ok((ENGINE_RESULT_STATUSES as readonly string[]).includes(result.status));
  assert.equal(isEngineResultStatus('SKIPPED'), true);
  assert.ok((ENGINE_RESULT_STATUSES as readonly string[]).includes('SKIPPED'));
  assert.ok((ENGINE_RESULT_STATUSES as readonly string[]).includes('NOT_APPLICABLE'));
  assert.ok((ENGINE_RESULT_STATUSES as readonly string[]).includes('TIMEOUT'));
  assert.ok((ENGINE_RESULT_STATUSES as readonly string[]).includes('CANCELLED'));
  assert.ok((ENGINE_RESULT_STATUSES as readonly string[]).includes('FLAKY'));
});

test('tallyEngineResults does not count SKIPPED, TIMEOUT, CANCELLED, FLAKY, or FAIL as PASS', () => {
  const tallied = tallyEngineResults([
    {
      id: 'pass-1',
      testType: 'unit',
      category: 'functional',
      name: 'ok',
      status: 'PASS',
    },
    {
      id: 'skip-1',
      testType: 'unit',
      category: 'functional',
      name: 'skipped with reason',
      status: 'SKIPPED',
      error: { message: 'gated by safety policy' },
      metadata: { reason: 'gated by safety policy' },
    },
    {
      id: 'fail-1',
      testType: 'unit',
      category: 'functional',
      name: 'broken',
      status: 'FAIL',
      assertion: { expected: 1, actual: 0 },
    },
    {
      id: 'timeout-1',
      testType: 'unit',
      category: 'functional',
      name: 'timed out',
      status: 'TIMEOUT',
      error: { message: 'timeout after 30ms' },
      metadata: { reason: 'timeout after 30ms' },
    },
    {
      id: 'cancel-1',
      testType: 'unit',
      category: 'functional',
      name: 'cancelled',
      status: 'CANCELLED',
      error: { message: 'cancelled' },
      metadata: { reason: 'cancelled' },
    },
    {
      id: 'flaky-1',
      testType: 'unit',
      category: 'functional',
      name: 'flaky',
      status: 'FLAKY',
      error: { message: 'attempt 1 FAIL; attempt 2 PASS' },
      metadata: {
        reason: 'attempt 1 FAIL; attempt 2 PASS',
        attempts: [
          { attempt: 1, status: 'FAIL' },
          { attempt: 2, status: 'PASS' },
        ],
      },
    },
  ]);

  assert.equal(tallied.passCount, 1);
  assert.equal(tallied.skippedCount, 1);
  assert.equal(tallied.failCount, 1);
  assert.equal(tallied.timeoutCount, 1);
  assert.equal(tallied.cancelledCount, 1);
  assert.equal(tallied.flakyCount, 1);
  assert.equal(tallied.status, 'FAIL');
  assert.equal(tallied.passed, false);
});

test('buildEngineSummary exposes timeoutCount, cancelledCount, and flakyCount without counting FLAKY as pass or fail', () => {
  const summary = buildEngineSummary({
    engine: 'fake',
    testType: 'unit',
    results: [
      {
        id: 't1',
        testType: 'unit',
        category: 'functional',
        name: 'timed out',
        status: 'TIMEOUT',
        metadata: { reason: 'timeout after 30ms' },
      },
      {
        id: 'c1',
        testType: 'unit',
        category: 'functional',
        name: 'cancelled',
        status: 'CANCELLED',
        metadata: { reason: 'cancelled' },
      },
      {
        id: 'f1',
        testType: 'unit',
        category: 'functional',
        name: 'flaky',
        status: 'FLAKY',
        metadata: { reason: 'attempt 1 FAIL; attempt 2 PASS' },
      },
    ],
  });

  assert.equal(summary.timeoutCount, 1);
  assert.equal(summary.cancelledCount, 1);
  assert.equal(summary.flakyCount, 1);
  assert.equal(summary.passCount, 0);
  assert.equal(summary.failCount, 0);
  assert.equal(summary.passed, true);
  assert.equal(summary.status, 'TIMEOUT');
  assert.notEqual(summary.status, 'PASS');
  assert.notEqual(summary.status, 'FAIL');
});

test('makeResult rejects TIMEOUT, CANCELLED, and FLAKY without a reason', () => {
  assert.throws(
    () =>
      makeResult({
        id: 't-no-reason',
        testType: 'unit',
        category: 'functional',
        name: 'timeout',
        status: 'TIMEOUT',
      }),
    /requires a non-empty reason/
  );
  assert.throws(
    () =>
      makeResult({
        id: 'c-no-reason',
        testType: 'unit',
        category: 'functional',
        name: 'cancel',
        status: 'CANCELLED',
      }),
    /requires a non-empty reason/
  );
  assert.throws(
    () =>
      makeResult({
        id: 'flaky-no-reason',
        testType: 'unit',
        category: 'functional',
        name: 'flaky',
        status: 'FLAKY',
      }),
    /requires a non-empty reason/
  );
  assert.doesNotThrow(() =>
    makeResult({
      id: 't-ok',
      testType: 'unit',
      category: 'functional',
      name: 'timeout',
      status: 'TIMEOUT',
      metadata: { reason: 'timeout after 30ms' },
    })
  );
  assert.doesNotThrow(() =>
    makeResult({
      id: 'flaky-ok',
      testType: 'unit',
      category: 'functional',
      name: 'flaky',
      status: 'FLAKY',
      metadata: {
        reason: 'attempt 1 FAIL; attempt 2 PASS',
        attempts: [
          { attempt: 1, status: 'FAIL' },
          { attempt: 2, status: 'PASS' },
        ],
      },
    })
  );
});

test('buildEngineSummary exposes skippedCount and keeps FAIL from counting as passed', () => {
  const summary = buildEngineSummary({
    engine: 'fake',
    testType: 'unit',
    results: [
      {
        id: 's1',
        testType: 'unit',
        category: 'functional',
        name: 'skipped',
        status: 'SKIPPED',
        metadata: { reason: 'explicit skip with reason' },
      },
      {
        id: 'f1',
        testType: 'unit',
        category: 'functional',
        name: 'failed',
        status: 'FAIL',
      },
    ],
  });

  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.failCount, 1);
  assert.equal(summary.passCount, 0);
  assert.equal(summary.passed, false);
  assert.equal(summary.status, 'FAIL');
  assert.equal(summary.safety?.mode, 'read-only');
});

test('canRun is true when at least one URL is set and enabled', () => {
  const { engine } = createFakeEngine();
  assert.equal(engine.canRun(emptyContext({ websiteUrl: 'https://example.test' })), true);
  assert.equal(engine.canRun(emptyContext({ apiUrl: 'https://api.example.test' })), true);
  assert.equal(
    engine.canRun(emptyContext({ websiteUrl: 'https://example.test', enabled: false })),
    false
  );
});

test('makeResult PASS includes executionId and defaults project/environment', () => {
  const result = makeResult({
    id: 'pass-1',
    testType: 'unit',
    category: 'functional',
    name: 'ok',
    status: 'PASS',
  });
  assert.equal(result.status, 'PASS');
  assert.equal(typeof result.metadata?.executionId, 'string');
  assert.ok(String(result.metadata?.executionId).length > 0);
  assert.equal(result.metadata?.projectId, 'default');
  assert.equal(result.metadata?.environment, 'development');
});

test('makeResult redacts secret in error.message', () => {
  const result = makeResult({
    id: 'fail-secret',
    testType: 'unit',
    category: 'functional',
    name: 'secret fail',
    status: 'FAIL',
    error: { message: 'auth failed password=s3cret' },
  });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.error?.message);
  assert.doesNotMatch(result.error!.message, /s3cret/);
  assert.match(result.error!.message, /password=\[REDACTED\]/);
});

test('makeResult NOT_TESTED with secret-only reason becomes redacted placeholder', () => {
  const result = makeResult({
    id: 'nt-secret',
    testType: 'unit',
    category: 'functional',
    name: 'gated',
    status: 'NOT_TESTED',
    metadata: { reason: 'password=s3cret' },
  });
  assert.equal(result.status, 'NOT_TESTED');
  assert.equal(result.metadata?.reason, 'redacted');
  assert.doesNotMatch(String(result.metadata?.reason), /s3cret/);
});

test('makeResult quarantine FAIL stays FAIL', () => {
  const result = makeResult({
    id: 'flaky-1',
    testType: 'unit',
    category: 'functional',
    name: 'flaky',
    status: 'FAIL',
    metadata: { quarantine: true },
    assertion: { expected: 1, actual: 0 },
  });
  assert.equal(result.status, 'FAIL');
  assert.notEqual(result.status, 'PASS');
  assert.equal(result.metadata?.quarantine, true);
  assert.equal(typeof result.metadata?.testVersion, 'string');
});

test('evaluateReleaseGate default config does not block even with high fail counts', () => {
  const config = loadConfig();
  const gate = evaluateReleaseGate(
    { criticalFailures: 99, coveragePct: 0 },
    config.qualityGate ?? {}
  );
  assert.equal(config.qualityGate?.blockRelease ?? false, false);
  assert.equal(gate.block, false);
  assert.deepEqual(gate.reasons, []);
});
