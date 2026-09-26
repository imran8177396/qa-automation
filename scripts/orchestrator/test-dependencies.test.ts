import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  scheduleDependentTests,
  type DependentTest,
} from '../core/platform/dependencies';
import { tallyEngineResults } from '../core/engine-contract';
import { executeDependentPlan } from './test-dependencies';

/** Diamond: A → B, A → C, B+C → D
 * B and C declare shared network so they may overlap when parallel is true.
 * Undeclared resources refuse to share a wave (see planResourceWaves).
 */
const DIAMOND: DependentTest[] = [
  { testId: 'A' },
  {
    testId: 'B',
    dependsOn: [{ testId: 'A' }],
    resources: [{ name: 'network', count: 1, mode: 'shared' }],
  },
  {
    testId: 'C',
    dependsOn: [{ testId: 'A' }],
    resources: [{ name: 'network', count: 1, mode: 'shared' }],
  },
  {
    testId: 'D',
    dependsOn: [{ testId: 'B' }, { testId: 'C' }],
  },
];

type Timing = { startedAt: number; finishedAt: number };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CHAIN: DependentTest[] = [
  { testId: 'AUTH-001', dependsOn: [] },
  { testId: 'USER-001', dependsOn: [{ testId: 'AUTH-001' }] },
  { testId: 'ORG-001', dependsOn: [{ testId: 'USER-001' }] },
  { testId: 'PROJECT-001', dependsOn: [{ testId: 'ORG-001' }] },
  { testId: 'WORKFLOW-001', dependsOn: [{ testId: 'PROJECT-001' }] },
];

const TITLE_CHAIN: DependentTest[] = [
  { testId: 'Authentication' },
  { testId: 'Create User', dependsOn: [{ testId: 'Authentication' }] },
  { testId: 'Create Organization', dependsOn: [{ testId: 'Create User' }] },
  { testId: 'Create Project', dependsOn: [{ testId: 'Create Organization' }] },
  { testId: 'Run Workflow', dependsOn: [{ testId: 'Create Project' }] },
];

describe('scheduleDependentTests', () => {
  it('orders Authentication → Create User → Create Organization → Create Project → Run Workflow', () => {
    const { order, runnable, blocked } = scheduleDependentTests(TITLE_CHAIN, {});
    assert.deepEqual(order, [
      'Authentication',
      'Create User',
      'Create Organization',
      'Create Project',
      'Run Workflow',
    ]);
    assert.deepEqual(runnable, ['Authentication']);
    assert.ok(blocked.every((row) => row.status === 'BLOCKED'));
    assert.ok(!blocked.some((row) => (row.status as string) === 'FAIL'));
  });

  it('orders AUTH-001 … WORKFLOW-001 when each depends on the previous', () => {
    const { order } = scheduleDependentTests(CHAIN, {});
    assert.deepEqual(order, [
      'AUTH-001',
      'USER-001',
      'ORG-001',
      'PROJECT-001',
      'WORKFLOW-001',
    ]);
  });

  it('throws on cycle A→B→A and does not produce FAIL results', () => {
    assert.throws(
      () =>
        scheduleDependentTests(
          [
            { testId: 'A', dependsOn: [{ testId: 'B' }] },
            { testId: 'B', dependsOn: [{ testId: 'A' }] },
          ],
          {}
        ),
      /cycle/i
    );
  });

  it('throws on missing dependency id', () => {
    assert.throws(
      () =>
        scheduleDependentTests(
          [{ testId: 'USER-001', dependsOn: [{ testId: 'AUTH-MISSING' }] }],
          {}
        ),
      /Missing dependency id: AUTH-MISSING/
    );
  });

  it('throws on unsupported requiredStatus', () => {
    assert.throws(
      () =>
        scheduleDependentTests(
          [
            { testId: 'AUTH-001' },
            {
              testId: 'USER-001',
              dependsOn: [
                {
                  testId: 'AUTH-001',
                  requiredStatus: 'FAIL' as unknown as 'PASS',
                },
              ],
            },
          ],
          {}
        ),
      /Unsupported requiredStatus/
    );
  });

  it('blocks transitive dependents when AUTH-001 is FAIL — status BLOCKED not FAIL', () => {
    const scheduled = scheduleDependentTests(CHAIN, {
      'AUTH-001': { status: 'FAIL' },
    });
    const byId = Object.fromEntries(scheduled.blocked.map((row) => [row.testId, row]));
    for (const id of ['USER-001', 'ORG-001', 'PROJECT-001', 'WORKFLOW-001']) {
      assert.equal(byId[id]?.status, 'BLOCKED', id);
      assert.notEqual(byId[id]?.status as string, 'FAIL', id);
      assert.match(byId[id]?.reason ?? '', /AUTH-001 did not PASS \(FAIL\)/);
    }
    assert.deepEqual(scheduled.runnable, []);
    assert.ok(!scheduled.order.includes('FAIL' as never));
  });

  it('PASS prerequisite does not block; already-executed ids are not runnable', () => {
    const scheduled = scheduleDependentTests(CHAIN, {
      'AUTH-001': { status: 'PASS' },
      'USER-001': { status: 'PASS' },
    });
    assert.ok(!scheduled.blocked.some((row) => row.testId === 'ORG-001'));
    assert.deepEqual(scheduled.runnable, ['ORG-001']);
    assert.ok(!scheduled.runnable.includes('AUTH-001'));
    assert.ok(!scheduled.runnable.includes('USER-001'));
  });

  it('a test with no dependencies still runs (is runnable)', () => {
    const scheduled = scheduleDependentTests(
      [
        { testId: 'SOLO-001' },
        { testId: 'OTHER-001', dependsOn: [{ testId: 'SOLO-001' }] },
      ],
      {}
    );
    assert.deepEqual(scheduled.runnable, ['SOLO-001']);
    assert.ok(scheduled.order.includes('SOLO-001'));
  });
});

describe('executeDependentPlan', () => {
  it('AUTH-001 FAIL → USER/PROJECT/WORKFLOW are BLOCKED and runOne is not called for them', async () => {
    const called: string[] = [];
    const { results } = await executeDependentPlan(CHAIN, async (testId) => {
      called.push(testId);
      if (testId === 'AUTH-001') return { status: 'FAIL' };
      throw new Error(`runOne must not be called for ${testId}`);
    });

    assert.deepEqual(called, ['AUTH-001']);
    const byId = Object.fromEntries(results.map((row) => [row.id, row]));
    assert.equal(byId['AUTH-001']?.status, 'FAIL');
    for (const id of ['USER-001', 'ORG-001', 'PROJECT-001', 'WORKFLOW-001']) {
      assert.equal(byId[id]?.status, 'BLOCKED', id);
      assert.notEqual(byId[id]?.status as string, 'FAIL', id);
      assert.ok(
        (byId[id]?.metadata?.reason as string)?.length > 0 ||
          (byId[id]?.error?.message?.length ?? 0) > 0,
        `${id} needs a reason`
      );
    }
  });

  it('TIMEOUT prerequisite blocks dependents and does not call runOne for them', async () => {
    const called: string[] = [];
    const graph: DependentTest[] = [
      { testId: 'AUTH-001', timeoutMs: 30 },
      { testId: 'USER-001', dependsOn: [{ testId: 'AUTH-001' }] },
    ];
    const { results } = await executeDependentPlan(graph, async (testId) => {
      called.push(testId);
      if (testId === 'AUTH-001') {
        await new Promise(() => {
          /* hang until timeout */
        });
      }
      throw new Error(`runOne must not be called for ${testId}`);
    });

    assert.deepEqual(called, ['AUTH-001']);
    const byId = Object.fromEntries(results.map((row) => [row.id, row]));
    assert.equal(byId['AUTH-001']?.status, 'TIMEOUT');
    assert.notEqual(byId['AUTH-001']?.status, 'PASS');
    assert.notEqual(byId['AUTH-001']?.status as string, 'FAIL');
    assert.equal(byId['USER-001']?.status, 'BLOCKED');
  });

  it('AUTH-001 PASS and USER-001 PASS → later runOne is called', async () => {
    const called: string[] = [];
    const { results } = await executeDependentPlan(CHAIN, async (testId) => {
      called.push(testId);
      return { status: 'PASS' };
    });

    assert.deepEqual(called, [
      'AUTH-001',
      'USER-001',
      'ORG-001',
      'PROJECT-001',
      'WORKFLOW-001',
    ]);
    assert.ok(results.every((row) => row.status === 'PASS'));
  });

  it('a test with no dependencies still runs', async () => {
    const called: string[] = [];
    await executeDependentPlan([{ testId: 'SOLO-001' }], async (testId) => {
      called.push(testId);
      return { status: 'PASS' };
    });
    assert.deepEqual(called, ['SOLO-001']);
  });

  it('cycle throw is rethrown and does not produce FAIL results', async () => {
    await assert.rejects(
      () =>
        executeDependentPlan(
          [
            { testId: 'A', dependsOn: [{ testId: 'B' }] },
            { testId: 'B', dependsOn: [{ testId: 'A' }] },
          ],
          async () => {
            throw new Error('runOne must not be called on cycle');
          }
        ),
      /cycle/i
    );
  });

  it('retry enabled FAIL then PASS → FLAKY with attempts; not PASS; passCount unchanged', async () => {
    const calls: string[] = [];
    const statuses = ['FAIL', 'PASS'];
    const { results } = await executeDependentPlan(
      [{ testId: 'AUTH-001' }],
      async (testId) => {
        calls.push(testId);
        return { status: statuses[calls.length - 1]! };
      },
      { retry: { enabled: true, maxAttempts: 2 } }
    );

    assert.equal(calls.length, 2);
    const row = results[0]!;
    assert.equal(row.status, 'FLAKY');
    assert.notEqual(row.status, 'PASS');
    const attempts = row.metadata?.attempts as Array<{ attempt: number; status: string }>;
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0]?.status, 'FAIL');
    assert.equal(attempts[1]?.status, 'PASS');
    assert.match(String(row.metadata?.reason ?? row.error?.message ?? ''), /attempt 1 FAIL/);
    assert.match(String(row.metadata?.reason ?? row.error?.message ?? ''), /attempt 2 PASS/);
    const tallied = tallyEngineResults(results);
    assert.equal(tallied.passCount, 0);
    assert.equal(tallied.failCount, 0);
    assert.equal(tallied.flakyCount, 1);
    assert.notEqual(row.status, 'PASS');
    assert.notEqual(JSON.stringify({ status: row.status }), JSON.stringify({ status: 'PASS' }));
  });

  it('retry disabled: runOne once and FAIL stays FAIL', async () => {
    let calls = 0;
    const { results } = await executeDependentPlan(
      [{ testId: 'AUTH-001' }],
      async () => {
        calls += 1;
        return { status: 'FAIL' };
      },
      { retry: { enabled: false, maxAttempts: 2 } }
    );
    assert.equal(calls, 1);
    assert.equal(results[0]?.status, 'FAIL');
  });

  it('retry two FAILs with maxAttempts 2 → FAIL with both attempts, not PASS', async () => {
    const { results } = await executeDependentPlan(
      [{ testId: 'AUTH-001' }],
      async () => ({ status: 'FAIL' }),
      { retry: { enabled: true, maxAttempts: 2 } }
    );
    const row = results[0]!;
    assert.equal(row.status, 'FAIL');
    assert.notEqual(row.status, 'PASS');
    const attempts = row.metadata?.attempts as Array<{ attempt: number; status: string }>;
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every((a) => a.status === 'FAIL'));
  });

  it('retry enabled: attempt 1 PASS calls runOne once', async () => {
    let calls = 0;
    const { results } = await executeDependentPlan(
      [{ testId: 'AUTH-001' }],
      async () => {
        calls += 1;
        return { status: 'PASS' };
      },
      { retry: { enabled: true, maxAttempts: 2 } }
    );
    assert.equal(calls, 1);
    assert.equal(results[0]?.status, 'PASS');
  });

  it('FLAKY prerequisite blocks dependent and does not call dependent runOne', async () => {
    const called: string[] = [];
    const authStatuses = ['FAIL', 'PASS'];
    let authCalls = 0;
    const { results } = await executeDependentPlan(
      [
        { testId: 'AUTH-001' },
        { testId: 'USER-001', dependsOn: [{ testId: 'AUTH-001' }] },
      ],
      async (testId) => {
        called.push(testId);
        if (testId === 'AUTH-001') {
          authCalls += 1;
          return { status: authStatuses[authCalls - 1]! };
        }
        throw new Error(`runOne must not be called for ${testId}`);
      },
      { retry: { enabled: true, maxAttempts: 2 } }
    );

    assert.deepEqual(called, ['AUTH-001', 'AUTH-001']);
    const byId = Object.fromEntries(results.map((row) => [row.id, row]));
    assert.equal(byId['AUTH-001']?.status, 'FLAKY');
    assert.equal(byId['USER-001']?.status, 'BLOCKED');
    assert.match(String(byId['USER-001']?.metadata?.reason ?? ''), /AUTH-001 did not PASS \(FLAKY\)/);
  });
});

describe('executeDependentPlan parallel', () => {
  it('parallel true maxConcurrency 4: B and C overlap; D waits for both', async () => {
    const timings: Record<string, Timing> = {};
    const called: string[] = [];

    const { results } = await executeDependentPlan(
      DIAMOND,
      async (testId) => {
        called.push(testId);
        const startedAt = Date.now();
        await delay(40);
        timings[testId] = { startedAt, finishedAt: Date.now() };
        return { status: 'PASS' };
      },
      { parallel: true, maxConcurrency: 4 }
    );

    assert.ok(results.every((row) => row.status === 'PASS'));
    assert.ok(called.includes('A'));
    assert.ok(called.includes('B'));
    assert.ok(called.includes('C'));
    assert.ok(called.includes('D'));

    const a = timings.A!;
    const b = timings.B!;
    const c = timings.C!;
    const d = timings.D!;

    assert.ok(a.finishedAt <= b.startedAt, 'B starts after A finishes');
    assert.ok(a.finishedAt <= c.startedAt, 'C starts after A finishes');
    assert.ok(b.startedAt < c.finishedAt, 'B overlaps C (B start before C finish)');
    assert.ok(c.startedAt < b.finishedAt, 'C overlaps B (C start before B finish)');
    assert.ok(
      d.startedAt >= Math.max(b.finishedAt, c.finishedAt),
      'D starts only after both B and C finish'
    );
  });

  it('A FAIL → B, C, D BLOCKED and runOne not called for them', async () => {
    const called: string[] = [];
    const { results } = await executeDependentPlan(
      DIAMOND,
      async (testId) => {
        called.push(testId);
        if (testId === 'A') return { status: 'FAIL' };
        throw new Error(`runOne must not be called for ${testId}`);
      },
      { parallel: true, maxConcurrency: 4 }
    );

    assert.deepEqual(called, ['A']);
    const byId = Object.fromEntries(results.map((row) => [row.id, row]));
    assert.equal(byId.A?.status, 'FAIL');
    for (const id of ['B', 'C', 'D']) {
      assert.equal(byId[id]?.status, 'BLOCKED', id);
      assert.notEqual(byId[id]?.status as string, 'FAIL', id);
    }
  });

  it('shared resource db without allowSharedMutableState does not overlap', async () => {
    const graph: DependentTest[] = [
      { testId: 'A' },
      {
        testId: 'B',
        dependsOn: [{ testId: 'A' }],
        resources: ['db'],
      },
      {
        testId: 'C',
        dependsOn: [{ testId: 'A' }],
        resources: ['db'],
      },
      {
        testId: 'D',
        dependsOn: [{ testId: 'B' }, { testId: 'C' }],
      },
    ];
    const timings: Record<string, Timing> = {};

    await executeDependentPlan(
      graph,
      async (testId) => {
        const startedAt = Date.now();
        await delay(30);
        timings[testId] = { startedAt, finishedAt: Date.now() };
        return { status: 'PASS' };
      },
      { parallel: true, maxConcurrency: 4 }
    );

    const b = timings.B!;
    const c = timings.C!;
    const serialized =
      b.finishedAt <= c.startedAt || c.finishedAt <= b.startedAt;
    assert.ok(serialized, 'B and C with shared db must not overlap');
  });

  it('shared resource with both allowSharedMutableState may overlap', async () => {
    const graph: DependentTest[] = [
      { testId: 'A' },
      {
        testId: 'B',
        dependsOn: [{ testId: 'A' }],
        resources: ['db'],
        allowSharedMutableState: true,
      },
      {
        testId: 'C',
        dependsOn: [{ testId: 'A' }],
        resources: ['db'],
        allowSharedMutableState: true,
      },
      {
        testId: 'D',
        dependsOn: [{ testId: 'B' }, { testId: 'C' }],
      },
    ];
    const timings: Record<string, Timing> = {};

    await executeDependentPlan(
      graph,
      async (testId) => {
        const startedAt = Date.now();
        await delay(40);
        timings[testId] = { startedAt, finishedAt: Date.now() };
        return { status: 'PASS' };
      },
      { parallel: true, maxConcurrency: 4 }
    );

    const b = timings.B!;
    const c = timings.C!;
    assert.ok(b.startedAt < c.finishedAt, 'B may overlap C');
    assert.ok(c.startedAt < b.finishedAt, 'C may overlap B');
  });

  it('parallel false → B finishes before C starts', async () => {
    const timings: Record<string, Timing> = {};

    await executeDependentPlan(
      DIAMOND,
      async (testId) => {
        const startedAt = Date.now();
        await delay(20);
        timings[testId] = { startedAt, finishedAt: Date.now() };
        return { status: 'PASS' };
      },
      { parallel: false, maxConcurrency: 1 }
    );

    const b = timings.B!;
    const c = timings.C!;
    assert.ok(
      b.finishedAt <= c.startedAt,
      'sequential: B must finish before C starts'
    );
  });
});
