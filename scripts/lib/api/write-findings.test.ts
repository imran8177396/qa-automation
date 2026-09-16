import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderApiFindingsHtml, renderApiFindingsMarkdown } from './write-findings';
import type { ApiSection27Artifact } from './types';
import type { ApiDiscoveryProvenance } from './discovery-source';

const discovery: ApiDiscoveryProvenance = {
  inventoryPresent: true,
  inventoryPath: 'discovery/api-inventory.json',
  observedCallCount: 0,
  seedUrl: 'https://www.saucedemo.com/',
  websiteUrl: 'https://www.saucedemo.com/',
  note: 'Sauce Demo discovery found 0 xhr/fetch/websocket APIs. Executed Postman requests are documented in qa.config.json.',
};

function artifact(): ApiSection27Artifact {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    collection: 'QA Automation API',
    terminology: 'API automation via Postman CLI.',
    discoveryNote: discovery.note,
    auth: {
      authentication: 'NOT_EXECUTED',
      authorization: 'NOT_EXECUTED',
      reason: 'No documented contract.',
      tokenPresent: false,
      documentedContract: false,
    },
    requests: [
      {
        testId: 'TC-API-001',
        name: 'GET /posts — list resources',
        method: 'GET',
        endpoint: 'https://jsonplaceholder.typicode.com/posts',
        path: '/posts',
        source: 'config',
        statusCode: '200',
        expectedStatus: 200,
        collectionAssertedStatus: 200,
        collectionAssertionResult: 'PASS',
        responseTimeMs: 10,
        assertion: 'GET /posts returns HTTP 200',
        result: 'PASS',
        flags: [],
        expectedVsActual: { expected: '200', actual: '200' },
        includedInPassCount: true,
      },
    ],
    counts: {
      passed: 1,
      failed: 0,
      unverified: 0,
      notExecuted: 0,
      excludedFromPassCount: 0,
      includedInPassCount: 1,
    },
    flaggedAssertions: [],
  };
}

test('findings markdown states 0 discovered Sauce Demo APIs and config source', () => {
  const md = renderApiFindingsMarkdown(artifact(), discovery);
  assert.match(md, /Sauce Demo discovery found 0/);
  assert.match(md, /qa\.config\.json/);
  assert.match(md, /\| TC-API-001 \| config \| GET \| \/posts \| PASS \|/);
});

test('findings HTML is a standalone report with the same provenance', () => {
  const html = renderApiFindingsHtml(artifact(), discovery);
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /Sauce Demo discovery found 0/);
  assert.match(html, /qa\.config\.json/);
  assert.match(html, /TC-API-001/);
});
