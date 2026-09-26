import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runWithTimeout } from './cancellation';
import { executeDependentPlan } from '../../orchestrator/test-dependencies';
import type { DependentTest } from './dependencies';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('runWithTimeout', () => {
  it('never-resolving run with timeoutMs 30 returns TIMEOUT (not PASS/FAIL) and cleanup timeout', async () => {
    const cleanups: string[] = [];
    const result = await runWithTimeout({
      timeoutMs: 30,
      run: async () => {
        await new Promise(() => {
          /* never resolves */
        });
      },
      cleanup: async (reason) => {
        cleanups.push(reason);
      },
    });

    assert.equal(result.status, 'TIMEOUT');
    assert.notEqual(result.status, 'PASS');
    assert.notEqual(result.status as string, 'FAIL');
    assert.ok(result.status === 'TIMEOUT' && /timeout/i.test(result.reason));
    assert.ok(result.status === 'TIMEOUT' && result.reason.includes('30'));
    assert.deepEqual(cleanups, ['timeout']);
  });

  it('already-aborted signal returns CANCELLED (not PASS) and runs cleanup', async () => {
    const cleanups: string[] = [];
    const controller = new AbortController();
    controller.abort('abort');

    const result = await runWithTimeout({
      signal: controller.signal,
      run: async () => {
        throw new Error('run must not be called when already aborted');
      },
      cleanup: async (reason) => {
        cleanups.push(reason);
      },
    });

    assert.equal(result.status, 'CANCELLED');
    assert.notEqual(result.status, 'PASS');
    assert.notEqual(result.status as string, 'FAIL');
    assert.ok(result.status === 'CANCELLED' && /abort|cancel/i.test(result.reason));
    assert.ok(cleanups.length === 1);
    assert.ok(cleanups[0] === 'aborted' || cleanups[0] === 'cancelled');
  });

  it('fast run with timeoutMs 500 returns PASS and cleanup completed', async () => {
    const cleanups: string[] = [];
    const result = await runWithTimeout({
      timeoutMs: 500,
      run: async () => {
        await delay(5);
      },
      cleanup: async (reason) => {
        cleanups.push(reason);
      },
    });

    assert.equal(result.status, 'PASS');
    assert.deepEqual(cleanups, ['completed']);
  });

  it('rejects negative timeoutMs', async () => {
    await assert.rejects(
      () =>
        runWithTimeout({
          timeoutMs: -1,
          run: async () => undefined,
        }),
      /negative/i
    );
  });
});

describe('executeDependentPlan timeout blocks dependents', () => {
  it('TIMEOUT prerequisite causes dependent BLOCKED and runOne is not called for it', async () => {
    const graph: DependentTest[] = [
      { testId: 'A', timeoutMs: 30 },
      { testId: 'B', dependsOn: [{ testId: 'A' }] },
    ];
    const called: string[] = [];

    const { results } = await executeDependentPlan(graph, async (testId) => {
      called.push(testId);
      if (testId === 'A') {
        await new Promise(() => {
          /* never resolves — node timeoutMs should win */
        });
      }
      throw new Error(`runOne must not be called for ${testId}`);
    });

    assert.deepEqual(called, ['A']);
    const byId = Object.fromEntries(results.map((row) => [row.id, row]));
    assert.equal(byId.A?.status, 'TIMEOUT');
    assert.notEqual(byId.A?.status, 'PASS');
    assert.notEqual(byId.A?.status as string, 'FAIL');
    assert.match(String(byId.A?.error?.message ?? byId.A?.metadata?.reason ?? ''), /timeout/i);
    assert.equal(byId.B?.status, 'BLOCKED');
    assert.notEqual(byId.B?.status as string, 'FAIL');
    assert.notEqual(byId.B?.status, 'PASS');
  });
});
