import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InMemoryTestDataProvider,
  runTestDataLifecycle,
  type TestData,
  type TestDataContext,
  type TestDataProvider,
  type TestDataValidateResult,
} from './test-data-lifecycle';

const baseContext: TestDataContext = {
  projectId: 'lifecycle-project',
  environment: 'local',
  runId: 'run-1',
};

describe('runTestDataLifecycle', () => {
  it('runs prepare, execute, validate, cleanup in order', async () => {
    const order: string[] = [];
    const provider: TestDataProvider = {
      async prepare(context) {
        order.push('prepare');
        return { projectId: context.projectId, runId: context.runId, items: [] };
      },
      async cleanup() {
        order.push('cleanup');
      },
    };

    const result = await runTestDataLifecycle({
      context: baseContext,
      provider,
      execute: async () => {
        order.push('execute');
        return { done: true };
      },
      validate: async () => {
        order.push('validate');
        return { ok: true };
      },
    });

    assert.deepEqual(order, ['prepare', 'execute', 'validate', 'cleanup']);
    assert.equal(result.cleanup, 'ran');
  });

  it('runs cleanup when execute throws and propagates the error', async () => {
    const order: string[] = [];
    const provider: TestDataProvider = {
      async prepare(context) {
        order.push('prepare');
        return { projectId: context.projectId, runId: context.runId, items: [] };
      },
      async cleanup() {
        order.push('cleanup');
      },
    };

    await assert.rejects(
      () =>
        runTestDataLifecycle({
          context: baseContext,
          provider,
          execute: async () => {
            order.push('execute');
            throw new Error('execute failed');
          },
          validate: async () => {
            order.push('validate');
            return { ok: true };
          },
        }),
      /execute failed/
    );

    assert.deepEqual(order, ['prepare', 'execute', 'cleanup']);
    assert.ok(!order.includes('validate'));
  });

  it('keeps validation FAIL as FAIL', async () => {
    const provider = new InMemoryTestDataProvider({ operations: ['generate'] });
    const result = await runTestDataLifecycle({
      context: baseContext,
      provider,
      execute: async () => ({}),
      validate: async (): Promise<TestDataValidateResult> => ({
        status: 'FAIL',
        reason: 'assertion mismatch',
      }),
    });

    assert.equal('status' in result.validation && result.validation.status, 'FAIL');
    assert.notEqual(
      'status' in result.validation ? result.validation.status : undefined,
      'PASS'
    );
  });
});

describe('InMemoryTestDataProvider', () => {
  it('generate payload has no demo host or product strings', async () => {
    const provider = new InMemoryTestDataProvider({
      operations: ['generate'],
      fields: { token: 'ephemeral', count: 1 },
    });
    const data = await provider.prepare(baseContext);
    const serialized = JSON.stringify(data);
    assert.match(serialized, /generate/);
    assert.doesNotMatch(serialized, /saucedemo|jsonplaceholder|swag labs/i);
    const generate = data.items.find((item) => item.kind === 'generate');
    assert.ok(generate);
    assert.equal(generate.status, 'PASS');
    assert.deepEqual(generate.payload, { token: 'ephemeral', count: 1 });
  });

  it('production seed without flags is BLOCKED and prepare still returns', async () => {
    const provider = new InMemoryTestDataProvider({
      operations: ['seed'],
    });
    const data = await provider.prepare({
      ...baseContext,
      environment: 'production',
    });
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0]?.kind, 'seed');
    assert.equal(data.items[0]?.status, 'BLOCKED');
  });

  it('fixture without a name is REQUIRES_CONFIGURATION', async () => {
    const provider = new InMemoryTestDataProvider({
      operations: ['fixture'],
      fixtureName: '',
    });
    const data = await provider.prepare(baseContext);
    assert.equal(data.items[0]?.status, 'REQUIRES_CONFIGURATION');
    assert.equal(data.items[0]?.reason, 'fixture name is required');
  });

  it('snapshot item is NOT_TESTED', async () => {
    const provider = new InMemoryTestDataProvider({
      operations: ['snapshot'],
    });
    const data = await provider.prepare(baseContext);
    assert.equal(data.items[0]?.kind, 'snapshot');
    assert.equal(data.items[0]?.status, 'NOT_TESTED');
    assert.equal(data.items[0]?.reason, 'snapshot capture is not executed');
  });

  it('cleanup on production without flags is BLOCKED and does not throw', async () => {
    const provider = new InMemoryTestDataProvider({
      operations: ['generate'],
    });
    const context: TestDataContext = {
      ...baseContext,
      environment: 'production',
    };
    const data: TestData = await provider.prepare(context);
    await assert.doesNotReject(() => provider.cleanup!(context, data));
    const cleanupItem = data.items.find((item) => item.kind === 'cleanup');
    assert.ok(cleanupItem);
    assert.equal(cleanupItem.status, 'BLOCKED');
    assert.equal(cleanupItem.reason, 'cleanup is not authorized');
  });
});
