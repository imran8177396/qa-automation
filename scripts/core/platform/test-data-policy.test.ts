import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InMemoryTestDataProvider,
  POLICY_ACCEPTED_REASON,
  PRODUCTION_DATA_MUTATION_REASON,
  READ_ONLY_CLEANUP_REASON,
  resolveTestDataPolicy,
  runTestDataLifecycle,
  type TestDataProvider,
} from './test-data-lifecycle';

describe('resolveTestDataPolicy', () => {
  it('production, no flags, requested isolated → effective read-only, BLOCKED', () => {
    const result = resolveTestDataPolicy({
      environment: 'production',
      requested: { mode: 'isolated' },
    });
    assert.equal(result.effective.mode, 'read-only');
    assert.equal(result.effective.cleanupRequired, false);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.reason, PRODUCTION_DATA_MUTATION_REASON);
    assert.deepEqual(result.requested, { mode: 'isolated' });
  });

  it('production, no flags, requested omitted → effective read-only, cleanupRequired false', () => {
    const result = resolveTestDataPolicy({
      environment: 'production',
    });
    assert.equal(result.effective.mode, 'read-only');
    assert.equal(result.effective.cleanupRequired, false);
    assert.equal(result.status, 'PASS');
    assert.equal(result.reason, POLICY_ACCEPTED_REASON);
  });

  it('production, both mutation flags, requested omitted → still read-only', () => {
    const result = resolveTestDataPolicy({
      environment: 'production',
      flags: { authorizeDataMutation: true, authorizeDestructive: true },
    });
    assert.equal(result.effective.mode, 'read-only');
    assert.equal(result.effective.cleanupRequired, false);
    assert.equal(result.status, 'PASS');
    assert.equal(result.reason, POLICY_ACCEPTED_REASON);
  });

  it('production, both flags, requested isolated → isolated accepted; no data store contacted', () => {
    const result = resolveTestDataPolicy({
      environment: 'production',
      requested: { mode: 'isolated' },
      flags: { authorizeDataMutation: true, authorizeDestructive: true },
    });
    assert.equal(result.effective.mode, 'isolated');
    assert.equal(result.effective.cleanupRequired, false);
    assert.equal(result.status, 'PASS');
    assert.match(result.reason, /no data store was contacted/i);
  });

  it('read-only + cleanupRequired true → BLOCKED', () => {
    const result = resolveTestDataPolicy({
      environment: 'development',
      requested: { mode: 'read-only', cleanupRequired: true },
    });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.reason, READ_ONLY_CLEANUP_REASON);
    assert.equal(result.effective.mode, 'read-only');
    assert.equal(result.effective.cleanupRequired, false);
  });

  it('development, omitted mode → isolated, cleanupRequired true', () => {
    const result = resolveTestDataPolicy({
      environment: 'development',
    });
    assert.equal(result.effective.mode, 'isolated');
    assert.equal(result.effective.cleanupRequired, true);
    assert.equal(result.status, 'PASS');
    assert.equal(result.reason, POLICY_ACCEPTED_REASON);
  });

  it('development, shared must be explicit (omitted is not shared)', () => {
    const omitted = resolveTestDataPolicy({ environment: 'development' });
    assert.notEqual(omitted.effective.mode, 'shared');
    assert.equal(omitted.effective.mode, 'isolated');

    const explicit = resolveTestDataPolicy({
      environment: 'development',
      requested: { mode: 'shared' },
    });
    assert.equal(explicit.effective.mode, 'shared');
    assert.equal(explicit.effective.cleanupRequired, false);
  });

  it('unknown mode → REQUIRES_CONFIGURATION', () => {
    const result = resolveTestDataPolicy({
      environment: 'local',
      requested: { mode: 'warehouse' as 'isolated' },
    });
    assert.equal(result.status, 'REQUIRES_CONFIGURATION');
    assert.match(result.reason, /Unknown test data policy mode/);
  });
});

describe('runTestDataLifecycle with policy', () => {
  it('production, no flags, requested isolated → BLOCKED, prepare not called', async () => {
    let prepareCalls = 0;
    const provider: TestDataProvider = {
      async prepare(context) {
        prepareCalls += 1;
        return { projectId: context.projectId, runId: context.runId, items: [] };
      },
    };

    const result = await runTestDataLifecycle({
      context: {
        projectId: 'policy-project',
        environment: 'production',
        runId: 'run-blocked',
      },
      provider,
      policy: { mode: 'isolated' },
      execute: async () => {
        throw new Error('execute must not run');
      },
      validate: async () => {
        throw new Error('validate must not run');
      },
    });

    assert.equal(prepareCalls, 0);
    assert.equal(result.policy?.status, 'BLOCKED');
    assert.equal(result.policy?.effective.mode, 'read-only');
    assert.equal(result.cleanup, 'skipped');
    assert.equal(result.data.items.length, 0);
  });

  it('development omitted mode → isolated; fake provider prepare can run', async () => {
    let prepareCalls = 0;
    const provider: TestDataProvider = {
      async prepare(context) {
        prepareCalls += 1;
        return {
          projectId: context.projectId,
          runId: context.runId,
          items: [{ kind: 'generate', id: 'g-0', status: 'PASS', payload: { n: 1 } }],
        };
      },
    };

    const result = await runTestDataLifecycle({
      context: {
        projectId: 'policy-project',
        environment: 'development',
        runId: 'run-dev',
      },
      provider,
      policy: {},
      execute: async (data) => data.items.length,
      validate: async () => ({ ok: true }),
    });

    assert.equal(prepareCalls, 1);
    assert.equal(result.policy?.effective.mode, 'isolated');
    assert.equal(result.policy?.effective.cleanupRequired, true);
    assert.equal(result.policy?.status, 'PASS');
    assert.equal(result.cleanup, 'skipped');
    assert.equal(result.cleanupReason, 'provider has no cleanup');
  });

  it('read-only + cleanupRequired true → BLOCKED, no delete', async () => {
    let cleanupCalls = 0;
    const provider: TestDataProvider = {
      async prepare(context) {
        return { projectId: context.projectId, runId: context.runId, items: [] };
      },
      async cleanup() {
        cleanupCalls += 1;
      },
    };

    const result = await runTestDataLifecycle({
      context: {
        projectId: 'policy-project',
        environment: 'staging',
        runId: 'run-ro',
      },
      provider,
      policy: { mode: 'read-only', cleanupRequired: true },
      execute: async () => ({}),
      validate: async () => ({ ok: true }),
    });

    assert.equal(result.policy?.status, 'BLOCKED');
    assert.equal(result.policy?.reason, READ_ONLY_CLEANUP_REASON);
    assert.equal(cleanupCalls, 0);
    assert.equal(result.cleanup, 'skipped');
  });

  it('seed under read-only is BLOCKED and seed prepare path is not called', async () => {
    let prepareCalls = 0;
    const inner = new InMemoryTestDataProvider({ operations: ['seed'] });
    const provider: TestDataProvider = {
      plannedOperations: () => inner.plannedOperations(),
      async prepare(context) {
        prepareCalls += 1;
        return inner.prepare(context);
      },
    };

    const result = await runTestDataLifecycle({
      context: {
        projectId: 'policy-project',
        environment: 'development',
        runId: 'run-seed-ro',
      },
      provider,
      policy: { mode: 'read-only' },
      execute: async (data) => data,
      validate: async () => ({ ok: true }),
    });

    assert.equal(prepareCalls, 0);
    assert.equal(result.policy?.effective.mode, 'read-only');
    assert.equal(result.data.items.length, 1);
    assert.equal(result.data.items[0]?.kind, 'seed');
    assert.equal(result.data.items[0]?.status, 'BLOCKED');
    assert.match(String(result.data.items[0]?.reason), /read-only/i);
    assert.equal(result.cleanup, 'skipped');
  });

  it('JSON of payloads does not match demo product hosts', async () => {
    const provider = new InMemoryTestDataProvider({
      operations: ['generate'],
      fields: { token: 'ephemeral', count: 2 },
    });
    const result = await runTestDataLifecycle({
      context: {
        projectId: 'policy-project',
        environment: 'local',
        runId: 'run-json',
      },
      provider,
      policy: { mode: 'isolated' },
      execute: async (data) => data,
      validate: async () => ({ ok: true }),
    });

    const serialized = JSON.stringify({
      policy: result.policy,
      data: result.data,
      output: result.output,
      validation: result.validation,
    });
    assert.doesNotMatch(serialized, /saucedemo|jsonplaceholder|swag labs/i);
  });
});
