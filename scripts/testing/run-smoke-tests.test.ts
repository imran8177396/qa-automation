import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSmoke, SMOKE_CHECK_IDS } from './run-smoke-tests';

test('smoke disabled → NOT_TESTED', async () => {
  let fetchCalls = 0;
  const results = await runSmoke(
    { enabled: false },
    {},
    {
      writeSummary: false,
      lastTargetUrl: null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'NOT_TESTED');
  assert.match(results[0].error?.message ?? '', /smoke engine disabled/i);
  assert.equal(fetchCalls, 0);
});

test('smoke enabled with empty website/API and no auth/workflow/deps → six REQUIRES_CONFIGURATION rows', async () => {
  let fetchCalls = 0;
  const results = await runSmoke(
    {
      enabled: true,
      websiteUrl: '',
      apiUrl: '',
      jmeterPath: '',
      apiPath: '',
      authUrl: '',
      workflowUrl: '',
      dependencies: [],
    },
    {},
    {
      writeSummary: false,
      lastTargetUrl: null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  assert.equal(results.length, 6);
  const ids = results.map((r) => r.id);
  assert.deepEqual(ids, [
    SMOKE_CHECK_IDS.homepage,
    SMOKE_CHECK_IDS.criticalApi,
    SMOKE_CHECK_IDS.authentication,
    SMOKE_CHECK_IDS.criticalWorkflow,
    SMOKE_CHECK_IDS.criticalPage,
    SMOKE_CHECK_IDS.criticalDependency,
  ]);
  for (const row of results) {
    assert.equal(row.status, 'REQUIRES_CONFIGURATION', `${row.id} should not PASS`);
    assert.notEqual(row.status, 'PASS');
  }
  assert.equal(fetchCalls, 0);
});

test('smoke dependency with no url → REQUIRES_CONFIGURATION', async () => {
  let fetchCalls = 0;
  const results = await runSmoke(
    {
      enabled: true,
      websiteUrl: '',
      apiUrl: '',
      dependencies: [{ name: 'missing-dep' }],
    },
    {},
    {
      writeSummary: false,
      lastTargetUrl: null,
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true };
      },
    }
  );
  const dep = results.find((r) => r.id === 'smoke:dependency:missing-dep');
  assert.ok(dep);
  assert.equal(dep.status, 'REQUIRES_CONFIGURATION');
  assert.match(dep.error?.message ?? '', /no resolvable/i);
  assert.equal(fetchCalls, 0);
});
