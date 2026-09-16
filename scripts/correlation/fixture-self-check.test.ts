import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startFixtureServer } from '../testing/serve-fixture-site';
import { runFixtureCorrelationSelfCheck } from './fixture-self-check';

describe('fixture correlation self-check', () => {
  it('serves GET /api/status as a documented local fixture API', async () => {
    const server = await startFixtureServer();
    try {
      const response = await fetch(`${server.url}/api/status`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { ok?: boolean; service?: string };
      assert.equal(body.ok, true);
      assert.equal(body.service, 'fixture-self-check');

      const denied = await fetch(`${server.url}/api/status`, { method: 'POST' });
      assert.equal(denied.status, 405);
    } finally {
      await server.close();
    }
  });

  it(
    'correlates UI click → GET /api/status → UI ok and labels it as framework self-check',
    { timeout: 120000 },
    async () => {
    const evidence = await runFixtureCorrelationSelfCheck();
    assert.equal(evidence.scope, 'framework-self-check');
    assert.equal(evidence.status, 'PASS');
    assert.equal(evidence.request?.method, 'GET');
    assert.equal(evidence.request?.status, 200);
    assert.match(evidence.request?.url ?? '', /\/api\/status/);
    assert.equal(evidence.uiAssertion?.actual, 'ok');
    assert.match(evidence.note ?? '', /not Sauce Demo coverage/i);
    }
  );
});
