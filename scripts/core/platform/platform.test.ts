import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'path';
import { ORCHESTRATOR_PHASE_NAMES } from '../../orchestrator/phases';
import { evaluateReleaseGate } from '../../orchestrator/quality-gate';
import { PATHS } from '../../lib/paths';
import {
  DEFAULT_ORCHESTRATOR_DEPENDENCY_GRAPH,
  gateDependents,
  orderByDependencies,
  scheduleDependentTests,
} from './dependencies';
import {
  environmentAllowsDestructive,
  productionActionAllowed,
  resolveEnvironment,
} from './environment';
import {
  boundedRetries,
  classifyStability,
  quarantine,
  trackFailures,
} from './flaky';
import { compareRuns, summarizeTrends } from './history';
import { PLATFORM_CAPABILITIES } from './index';
import {
  correlationHeaders,
  createExecutionId,
  logEvent,
} from './observability';
import { planParallel, runWithConcurrency } from './parallel';
import {
  assertSafePluginModulePath,
  loadConfiguredPlugins,
  PluginRegistry,
} from './plugins';
import { projectPaths, projectStores, resolveProjectId } from './project';
import { prioritize } from './risk';
import {
  assertResourceBudget,
  environmentPermissions,
  redactSecrets,
} from './safety-budget';
import { planTestData, planTestDataFull } from './test-data';
import { compareVersions, versionTestCase } from './versioning';

describe('PLATFORM_CAPABILITIES', () => {
  it('lists platform capabilities with honest statuses', () => {
    assert.ok(PLATFORM_CAPABILITIES.length >= 13);
    const byId = Object.fromEntries(PLATFORM_CAPABILITIES.map((row) => [row.id, row.status]));
    assert.equal(byId['project-isolation'], 'PARTIAL');
    assert.equal(byId['test-dependencies'], 'IMPLEMENTED');
    assert.equal(byId['environment-management'], 'PARTIAL');
    assert.equal(byId['test-data-management'], 'PARTIAL');
    assert.equal(byId['parallel-execution'], 'PARTIAL');
    assert.equal(byId['flaky-detection'], 'PARTIAL');
    assert.equal(byId['risk-prioritization'], 'PARTIAL');
    assert.equal(byId['test-versioning'], 'PARTIAL');
    assert.equal(byId['execution-history'], 'PARTIAL');
    assert.equal(byId['plugin-architecture'], 'PARTIAL');
    assert.equal(byId['observability'], 'PARTIAL');
    assert.equal(byId['safety-budget'], 'PARTIAL');
    assert.equal(byId['quality-gate'], 'PARTIAL');
  });
});

describe('project isolation', () => {
  it('resolves cli over env over config over default', () => {
    assert.equal(resolveProjectId({}), 'default');
    assert.equal(resolveProjectId({ config: { id: 'from-config' } }), 'from-config');
    assert.equal(
      resolveProjectId({ env: 'from-env', config: { id: 'from-config' } }),
      'from-env'
    );
    assert.equal(
      resolveProjectId({
        cli: 'from-cli',
        env: 'from-env',
        config: { id: 'from-config' },
      }),
      'from-cli'
    );
  });

  it('rejects invalid ids without falling through', () => {
    assert.throws(() => resolveProjectId({ cli: '../evil' }), /Invalid project id/);
    assert.throws(() => resolveProjectId({ cli: '-leading-dash' }), /Invalid project id/);
    assert.equal(resolveProjectId({ cli: '   ' }), 'default');
    assert.throws(() => projectPaths('bad id'), /Invalid project id/);
  });

  it('keeps default reports root equal to PATHS.reports.root', () => {
    const def = projectPaths('default');
    assert.equal(def.reportsRoot, PATHS.reports.root);
    assert.equal(def.lastTarget, PATHS.lastTarget);
    const stores = projectStores('default');
    assert.equal(stores.reports, PATHS.reports.root);
    assert.equal(stores.history, PATHS.reports.history);
  });

  it('namespaces project A and B under different paths', () => {
    const a = projectPaths('project-a');
    const b = projectPaths('project-b');
    assert.notEqual(a.reportsRoot, b.reportsRoot);
    assert.ok(a.reportsRoot.includes(path.join('projects', 'project-a')));
    assert.ok(b.reportsRoot.includes(path.join('projects', 'project-b')));
    assert.ok(a.lastTarget.endsWith(path.join('project-a', 'last-target.json')));
    assert.notEqual(a.lastTarget, PATHS.lastTarget);
  });

  it('projectStores a and b do not share the six paths; default reports equals PATHS root', () => {
    const a = projectStores('a');
    const b = projectStores('b');
    const keys = [
      'configurationOverlay',
      'credentialReference',
      'testData',
      'artifacts',
      'history',
      'reports',
    ] as const;
    for (const key of keys) {
      assert.notEqual(a[key], b[key], key);
    }
    assert.equal(projectStores('default').reports, PATHS.reports.root);
    assert.ok(a.reports.includes(path.join('projects', 'a')));
    assert.ok(!a.credentialReference.includes('qa.last-target.json'));
  });
});

describe('test dependencies', () => {
  it('default graph order equals ORCHESTRATOR_PHASE_NAMES', () => {
    const ordered = orderByDependencies(DEFAULT_ORCHESTRATOR_DEPENDENCY_GRAPH);
    assert.deepEqual(ordered, [...ORCHESTRATOR_PHASE_NAMES]);
  });

  it('errors on missing dependency and on cycles', () => {
    assert.throws(
      () => orderByDependencies([{ id: 'a', dependsOn: ['missing'] }]),
      /Missing dependency id: missing/
    );
    assert.throws(
      () =>
        orderByDependencies([
          { id: 'a', dependsOn: ['b'] },
          { id: 'b', dependsOn: ['a'] },
        ]),
      /cycle/i
    );
  });

  it('gateDependents blocks transitive dependents when prerequisite FAIL/BLOCKED/NOT_TESTED', () => {
    const nodes = [
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
      { id: 'd', dependsOn: [] },
    ];
    const gated = gateDependents(nodes, { a: { status: 'FAIL' } });
    const byId = Object.fromEntries(gated.map((row) => [row.id, row]));
    assert.equal(byId.b?.status, 'BLOCKED');
    assert.match(byId.b?.reason ?? '', /prerequisite a is FAIL/);
    assert.equal(byId.c?.status, 'BLOCKED');
    assert.equal(byId.d, undefined);
    assert.ok(gated.every((row) => (row.status as string) !== 'PASS'));

    const passGate = gateDependents(nodes, { a: { status: 'PASS' } });
    assert.deepEqual(passGate, []);

    const alreadyRan = gateDependents(nodes, {
      a: { status: 'BLOCKED' },
      b: { status: 'FAIL' },
    });
    assert.ok(!alreadyRan.some((row) => row.id === 'b'));
    assert.ok(alreadyRan.some((row) => row.id === 'c'));
  });

  it('scheduleDependentTests keeps phase graph intact and blocks non-PASS prereqs as BLOCKED', () => {
    const phaseOrder = orderByDependencies(DEFAULT_ORCHESTRATOR_DEPENDENCY_GRAPH);
    assert.deepEqual(phaseOrder, [...ORCHESTRATOR_PHASE_NAMES]);

    const chain = [
      { testId: 'Authentication' },
      { testId: 'Create User', dependsOn: [{ testId: 'Authentication' }] },
      { testId: 'Create Organization', dependsOn: [{ testId: 'Create User' }] },
      { testId: 'Create Project', dependsOn: [{ testId: 'Create Organization' }] },
      { testId: 'Run Workflow', dependsOn: [{ testId: 'Create Project' }] },
    ];
    const ordered = scheduleDependentTests(chain, {});
    assert.deepEqual(ordered.order, [
      'Authentication',
      'Create User',
      'Create Organization',
      'Create Project',
      'Run Workflow',
    ]);

    const afterFail = scheduleDependentTests(
      [
        { testId: 'AUTH-001' },
        { testId: 'USER-001', dependsOn: [{ testId: 'AUTH-001' }] },
        { testId: 'PROJECT-001', dependsOn: [{ testId: 'USER-001' }] },
        { testId: 'WORKFLOW-001', dependsOn: [{ testId: 'PROJECT-001' }] },
      ],
      { 'AUTH-001': { status: 'FAIL' } }
    );
    for (const id of ['USER-001', 'PROJECT-001', 'WORKFLOW-001']) {
      const row = afterFail.blocked.find((b) => b.testId === id);
      assert.equal(row?.status, 'BLOCKED');
      assert.notEqual(row?.status as string, 'FAIL');
    }
  });
});

describe('environment management', () => {
  it('resolves names and rejects unknown', () => {
    assert.equal(resolveEnvironment({}), 'development');
    assert.equal(resolveEnvironment({ cli: 'staging' }), 'staging');
    assert.equal(resolveEnvironment({ cli: 'local' }), 'local');
    assert.throws(() => resolveEnvironment({ cli: 'qa' }), /Unknown environment/);
    assert.throws(() => resolveEnvironment({ cli: 'prod' }), /Unknown environment/);
  });

  it('never implicitly authorizes production destructive', () => {
    assert.equal(environmentAllowsDestructive('production', {}), false);
    assert.equal(environmentAllowsDestructive('production', { allowDestructive: true }), false);
    assert.equal(environmentAllowsDestructive('production', { allowProduction: true }), true);
    assert.equal(environmentAllowsDestructive('development', {}), false);
    assert.equal(environmentAllowsDestructive('staging', { allowDestructive: true }), true);
  });

  it('productionActionAllowed blocks without flags and accepts local', () => {
    assert.equal(resolveEnvironment({ cli: 'local' }), 'local');
    const blocked = productionActionAllowed('heavy-performance', 'production', {});
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.status, 'BLOCKED');
    const localOk = productionActionAllowed('heavy-performance', 'local', {});
    assert.equal(localOk.allowed, true);
    assert.equal(localOk.reason, 'not production');
  });
});

describe('test data management', () => {
  it('plans generate; blocks unauthorized seed and production seed', () => {
    const unauthorized = planTestData({ environment: 'development' });
    assert.equal(unauthorized[0].action, 'generate');
    assert.equal(unauthorized[0].status, 'IMPLEMENTED');
    assert.equal(unauthorized[0].executes, false);
    assert.equal(unauthorized[1].action, 'seed');
    assert.equal(unauthorized[1].status, 'BLOCKED');
    assert.match(unauthorized[1].reason ?? '', /seed is not authorized/);

    const prod = planTestData({ environment: 'production', authorizeSeed: true });
    assert.equal(prod[1].status, 'BLOCKED');
    assert.match(prod[1].reason ?? '', /production/);
  });

  it('blocks application cleanup unless authorized and non-production', () => {
    const blocked = planTestData({ environment: 'staging' });
    assert.equal(blocked[2].action, 'cleanup');
    assert.equal(blocked[2].status, 'BLOCKED');

    const planned = planTestData({
      environment: 'staging',
      authorizeCleanup: true,
    });
    assert.equal(planned[2].status, 'NOT_TESTED');
    assert.equal(planned[2].executes, false);
    assert.match(planned[2].reason ?? '', /does not delete reports\/history/);
  });

  it('exposes factories, fixtures, and isolated paths that differ per project', () => {
    const full = planTestDataFull({
      environment: 'development',
      factories: [{ name: 'user', fields: ['email'] }],
      fixtures: ['login'],
      projectId: 'proj-a',
    });
    assert.equal(full.descriptors.factories[0].name, 'user');
    assert.deepEqual(full.descriptors.fixtures, ['login']);
    const other = planTestDataFull({
      environment: 'development',
      projectId: 'proj-b',
    });
    assert.notEqual(full.descriptors.isolated, other.descriptors.isolated);
  });
});

describe('parallel execution', () => {
  it('enabled false yields a single sequential wave and concurrency 1', () => {
    const plan = planParallel({
      nodes: [
        { id: 'a', dependsOn: [] },
        { id: 'b', dependsOn: ['a'] },
      ],
      enabled: false,
      concurrency: 4,
    });
    assert.equal(plan.enabled, false);
    assert.deepEqual(plan.waves, [['a', 'b']]);
    assert.equal(plan.concurrency, 1);
    assert.equal(plan.isolateWorkers, true);
  });

  it('enabled true groups independent nodes and defers dependents', () => {
    const plan = planParallel({
      nodes: [
        { id: 'a', dependsOn: [] },
        { id: 'b', dependsOn: [] },
        { id: 'c', dependsOn: ['a'] },
      ],
      enabled: true,
      concurrency: 2,
      maxWorkers: 2,
    });
    assert.equal(plan.waves.length, 2);
    assert.deepEqual(new Set(plan.waves[0]), new Set(['a', 'b']));
    assert.deepEqual(plan.waves[1], ['c']);
    assert.equal(plan.concurrency, 2);
  });

  it('runWithConcurrency limit 1 is sequential; aborted signal cancels remaining', async () => {
    const order: number[] = [];
    const sequential = await runWithConcurrency(
      [
        async () => {
          order.push(1);
          await new Promise((r) => setTimeout(r, 20));
          return 'a';
        },
        async () => {
          order.push(2);
          return 'b';
        },
      ],
      1
    );
    assert.deepEqual(order, [1, 2]);
    assert.equal(sequential[0].status, 'PASS');
    assert.equal(sequential[1].status, 'PASS');

    const controller = new AbortController();
    controller.abort();
    const cancelled = await runWithConcurrency(
      [
        async () => 'first',
        async () => 'second',
      ],
      1,
      controller.signal
    );
    assert.ok(cancelled.every((row) => row.status === 'cancelled'));
    assert.ok(cancelled.every((row) => (row.status as string) !== 'PASS'));
  });
});

describe('flaky detection', () => {
  it('classifies consistent, intermittent, and empty attempts', () => {
    assert.equal(
      classifyStability([
        { status: 'PASS', at: '1' },
        { status: 'PASS', at: '2' },
      ]).status,
      'consistent-pass'
    );
    assert.equal(
      classifyStability([
        { status: 'FAIL', at: '1' },
        { status: 'FAIL', at: '2' },
      ]).status,
      'consistent-fail'
    );
    assert.equal(
      classifyStability([
        { status: 'PASS', at: '1' },
        { status: 'FAIL', at: '2' },
      ]).status,
      'intermittent'
    );
    const empty = classifyStability([]);
    assert.equal(empty.status, 'NOT_TESTED');
    if (empty.status === 'NOT_TESTED') {
      assert.equal(empty.reason, 'no attempts recorded');
    }
  });

  it('boundedRetries never exceeds maxExtra; quarantine keeps FAIL; intermittent stays intermittent', () => {
    assert.equal(boundedRetries(5, 0), 1);
    assert.equal(boundedRetries(5, 2), 3);
    const list = quarantine('t1');
    assert.equal(list[0].status, 'FAIL');
    assert.equal(list[0].quarantined, true);
    assert.notEqual(list[0].status, 'PASS');
    assert.equal(
      classifyStability([
        { status: 'PASS', at: '1' },
        { status: 'FAIL', at: '2' },
      ]).status,
      'intermittent'
    );
    const counts = trackFailures([
      { id: 't1', status: 'FAIL' },
      { id: 't1', status: 'PASS' },
      { id: 't1', status: 'FAIL' },
    ]);
    assert.equal(counts.get('t1'), 2);
  });
});

describe('risk prioritization', () => {
  it('returns NOT_IMPLEMENTED without inventing selections', () => {
    const none = prioritize({});
    assert.equal(none.status, 'NOT_IMPLEMENTED');
    assert.deepEqual(none.selected, []);
    assert.match(none.reason, /change-impact analysis is not implemented/);
  });

  it('maps complete changed files to selected tests as PARTIAL', () => {
    const mapped = prioritize({
      changedFiles: ['src/a.ts'],
      mapping: [{ fileOrService: 'src/a.ts', testIds: ['t1', 't2'] }],
    });
    assert.equal(mapped.status, 'PARTIAL');
    assert.deepEqual(mapped.selected, ['t1', 't2']);
    assert.match(mapped.reason, /explicit mapping; no git diff was read/);
  });

  it('falls back to full regression when mappings are incomplete', () => {
    const fallback = prioritize({
      changedFiles: ['src/a.ts', 'src/b.ts'],
      mapping: [{ fileOrService: 'src/a.ts', testIds: ['t1'] }],
      allTestIds: ['t1', 't2', 't3'],
    });
    assert.equal(fallback.status, 'PARTIAL');
    assert.equal(fallback.fallback, 'full-regression');
    assert.deepEqual(fallback.selected, ['t1', 't2', 't3']);
    assert.match(fallback.reason, /mappings are incomplete/);
  });
});

describe('test versioning', () => {
  it('changes version when expected or baseline changes and reports changedFields', () => {
    const a = versionTestCase({
      id: 't1',
      title: 'Title',
      expected: { code: 200 },
      baseline: 'v1',
    });
    const b = versionTestCase({
      id: 't1',
      title: 'Title',
      expected: { code: 404 },
      baseline: 'v1',
    });
    assert.notEqual(a.version, b.version);
    assert.equal(compareVersions(null, a.version), 'new');
    assert.equal(compareVersions(a.version, a.version), 'unchanged');
    assert.equal(compareVersions(a.version, b.version), 'changed');

    const detail = compareVersions(
      { id: 't1', title: 'Title', expected: { code: 200 }, baseline: 'v1' },
      { id: 't1', title: 'Title', expected: { code: 404 }, baseline: 'v2' }
    );
    assert.equal(detail.result, 'changed');
    assert.ok(detail.changedFields.includes('expected'));
    assert.ok(detail.changedFields.includes('baseline'));
  });
});

describe('execution history', () => {
  it('detects regressed vs improved', () => {
    const rows = compareRuns(
      [
        { id: 'a', status: 'PASS' },
        { id: 'b', status: 'FAIL' },
      ],
      [
        { id: 'a', status: 'FAIL' },
        { id: 'b', status: 'PASS' },
      ]
    );
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.kind]));
    assert.equal(byId.a, 'regressed');
    assert.equal(byId.b, 'improved');
  });

  it('summarizeTrends counts passes/fails and recurring defects without inventing coverage', () => {
    const trends = summarizeTrends([
      [
        { id: 'a', status: 'FAIL', durationMs: 10 },
        { id: 'b', status: 'PASS', durationMs: 5 },
      ],
      [
        { id: 'a', status: 'FAIL', durationMs: 20, coveragePct: 40 },
        { id: 'b', status: 'FAIL', durationMs: 5, coveragePct: 40 },
      ],
    ]);
    assert.equal(trends.perRun[0].passCount, 1);
    assert.equal(trends.perRun[0].failCount, 1);
    assert.equal(trends.durationDeltaMs, 10);
    assert.equal(trends.coverageDeltaPct, null);
    assert.deepEqual(trends.recurringDefects, ['a']);

    const single = summarizeTrends([[{ id: 'x', status: 'PASS' }]]);
    assert.equal(single.coverageDeltaPct, null);
    assert.deepEqual(single.recurringDefects, []);
  });
});

describe('plugin architecture', () => {
  it('rejects duplicate registration and unsafe paths', () => {
    const registry = new PluginRegistry();
    registry.register({ id: 'x', run: () => undefined });
    assert.throws(() => registry.register({ id: 'x', run: () => undefined }), /Duplicate/);
    assert.throws(() => assertSafePluginModulePath('https://evil.example/p.js'), /URL/);
    assert.throws(() => assertSafePluginModulePath('scripts/plugins/../secrets.js'), /\.\./);
    assert.throws(() => assertSafePluginModulePath('scripts/other/p.js'), /scripts\/plugins/);
  });

  it('default empty load does nothing; missing module is NOT_IMPLEMENTED', async () => {
    const empty = await loadConfiguredPlugins([]);
    assert.deepEqual(empty.results, []);
    assert.deepEqual(empty.registry.ids(), []);

    const missing = await loadConfiguredPlugins([
      { id: 'missing', modulePath: 'scripts/plugins/does-not-exist.js' },
    ]);
    assert.equal(missing.results[0].status, 'NOT_IMPLEMENTED');
    assert.match(missing.results[0].reason ?? '', /not found/);
  });
});

describe('observability', () => {
  it('redacts password fields and keeps execution id stable on the event', () => {
    const executionId = createExecutionId();
    const event = logEvent({
      executionId,
      engine: 'platform',
      message: 'hello',
      fields: { password: 's3cret', ok: 1 },
    });
    assert.equal(event.executionId, executionId);
    assert.equal(event.fields?.password, '[REDACTED]');
    assert.notEqual(event.fields?.password, 's3cret');
    assert.equal(event.fields?.ok, 1);
    assert.deepEqual(correlationHeaders(executionId), {
      'x-qa-execution-id': executionId,
    });
  });
});

describe('safety budget', () => {
  it('production without approval is read-only; over-budget concurrency is not allowed; redaction removes token', () => {
    const perms = environmentPermissions('production');
    assert.equal(perms.mode, 'read-only');
    assert.equal(perms.destructive, false);
    assert.throws(
      () => assertResourceBudget({ concurrency: 2, maxConcurrency: 1 }),
      /exceeds maxConcurrency/
    );
    const redacted = redactSecrets({ token: 'abc', name: 'x' });
    assert.equal(redacted.token, '[REDACTED]');
    assert.equal(redacted.name, 'x');
  });
});

describe('release gate', () => {
  it('default does not block; explicit blockRelease enforces configured thresholds', () => {
    const open = evaluateReleaseGate({ criticalFailures: 99, coveragePct: 1 }, {});
    assert.equal(open.block, false);
    assert.deepEqual(open.reasons, []);

    const blocked = evaluateReleaseGate(
      { criticalFailures: 2 },
      { blockRelease: true, maxCriticalFailures: 0 }
    );
    assert.equal(blocked.block, true);
    assert.ok(blocked.reasons.some((r) => /critical failures/.test(r)));

    const missingCoverage = evaluateReleaseGate(
      {},
      { blockRelease: true, minCoveragePct: 80 }
    );
    assert.equal(missingCoverage.block, true);
    assert.ok(missingCoverage.reasons.includes('coverage not measured'));
  });
});
