import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QaConfig } from '../../types';
import { apiStagePassed, parsePostmanReportForSection27 } from './parse-postman-report';

function config(): QaConfig {
  const requests: QaConfig['postman']['requests'] = [
    {
      name: 'GET / — homepage HTML',
      method: 'GET',
      path: '/',
      reachableFromNavigation: true,
      expectedStatus: 200,
      assertions: { statusCode: 200, expectJson: false },
    },
    {
      name: 'GET /solutions — documented 404',
      method: 'GET',
      path: '/solutions',
      reachableFromNavigation: true,
      expectedStatus: 404,
      assertions: { statusCode: 404, expectJson: false },
      assertionFlags: [
        {
          assertion: 'statusCode',
          expected: 404,
          lastObserved: 404,
          flags: ['DOCUMENTED_INTENDED_STATUS', 'USER_CONFIRMED'],
          note: 'User confirmed: GET /solutions is intentionally HTTP 404.',
        },
      ],
    },
    {
      name: 'GET /contact — documented 404',
      method: 'GET',
      path: '/contact',
      reachableFromNavigation: true,
      expectedStatus: 404,
      assertions: { statusCode: 404, expectJson: false },
      assertionFlags: [
        {
          assertion: 'statusCode',
          expected: 404,
          lastObserved: 404,
          flags: ['DOCUMENTED_INTENDED_STATUS', 'USER_CONFIRMED'],
          note: 'User confirmed: GET /contact is intentionally HTTP 404.',
        },
      ],
    },
    {
      name: 'GET /api/ — public API root absent',
      method: 'GET',
      path: '/api/',
      expectedStatus: 'UNVERIFIED',
      assertions: { statusCode: 404, expectJson: false },
    },
  ];
  return {
    project: { name: 'QA Automation' },
    urls: { website: 'https://example.com/', api: 'https://example.com' },
    pipeline: { steps: ['api'], failFast: false },
    postman: {
      enabled: true,
      collectionName: 'QA Automation API',
      expectationPolicy: { navReachableDefault: 200, undocumented: 'UNVERIFIED' },
      auth: { type: 'none' },
      requests,
    },
    playwright: { enabled: false, baseURL: 'https://example.com', headless: true },
    jmeter: { enabled: false, path: '/', threads: 1, rampUpSeconds: 1, loopCount: 1 },
    github: { branches: ['main'], runOnPullRequest: true },
  };
}

const report = {
  run: {
    meta: { collectionName: 'QA Automation API' },
    executions: [
      {
        requestExecuted: {
          name: 'GET / — homepage HTML',
          method: 'GET',
          url: { protocol: 'https', host: ['example', 'com'], path: [''] },
        },
        response: { code: 200, responseTime: 100 },
        tests: [{ name: 'GET / returns HTTP 200', status: 'pass' }],
      },
      {
        requestExecuted: {
          name: 'GET /solutions — documented 404',
          method: 'GET',
          url: { protocol: 'https', host: ['example', 'com'], path: ['solutions'] },
        },
        response: { code: 404, responseTime: 80 },
        tests: [{ name: 'GET /solutions returns HTTP 404', status: 'pass' }],
      },
      {
        requestExecuted: {
          name: 'GET /contact — documented 404',
          method: 'GET',
          url: { protocol: 'https', host: ['example', 'com'], path: ['contact'] },
        },
        response: { code: 404, responseTime: 75 },
        tests: [{ name: 'GET /contact returns HTTP 404', status: 'pass' }],
      },
      {
        requestExecuted: {
          name: 'GET /api/ — public API root absent',
          method: 'GET',
          url: { protocol: 'https', host: ['example', 'com'], path: ['api', ''] },
        },
        response: { code: 404, responseTime: 70 },
        tests: [{ name: 'GET /api/ returns HTTP 404', status: 'pass' }],
      },
    ],
  },
};

test('expectedStatus 404 vs observed 404 is PASS with expected vs actual', () => {
  const artifact = parsePostmanReportForSection27({ report, config: config(), tokenPresent: false });
  const solutions = artifact.requests.find((row) => row.path === '/solutions');
  const contact = artifact.requests.find((row) => row.path === '/contact');
  assert.ok(solutions);
  assert.ok(contact);
  assert.equal(solutions.result, 'PASS');
  assert.equal(contact.result, 'PASS');
  assert.deepEqual(solutions.expectedVsActual, { expected: '404', actual: '404' });
  assert.deepEqual(contact.expectedVsActual, { expected: '404', actual: '404' });
  assert.equal(solutions.collectionAssertedStatus, 404);
  assert.equal(contact.collectionAssertedStatus, 404);
  assert.equal(solutions.includedInPassCount, true);
  assert.equal(contact.includedInPassCount, true);
});

test('expectedStatus 200 vs observed 404 is FAIL with expected vs actual', () => {
  const mismatched = config();
  const solutionsReq = mismatched.postman.requests.find((row) => row.path === '/solutions');
  assert.ok(solutionsReq);
  solutionsReq.expectedStatus = 200;
  const artifact = parsePostmanReportForSection27({ report, config: mismatched, tokenPresent: false });
  const solutions = artifact.requests.find((row) => row.path === '/solutions');
  assert.ok(solutions);
  assert.equal(solutions.result, 'FAIL');
  assert.deepEqual(solutions.expectedVsActual, { expected: '200', actual: '404' });
  assert.ok(solutions.flags.includes('EXPECTED_VS_ACTUAL_MISMATCH'));
});

test('UNVERIFIED requests are excluded from the pass count', () => {
  const artifact = parsePostmanReportForSection27({ report, config: config(), tokenPresent: false });
  const apiRoot = artifact.requests.find((row) => row.path === '/api');
  assert.ok(apiRoot);
  assert.equal(apiRoot.result, 'UNVERIFIED');
  assert.equal(apiRoot.includedInPassCount, false);
  assert.ok(artifact.counts.unverified >= 1);
  assert.equal(artifact.counts.passed, 3);
});

test('absent QA_API_TOKEN records authentication and authorization as NOT_EXECUTED', () => {
  const artifact = parsePostmanReportForSection27({ report, config: config(), tokenPresent: false });
  assert.equal(artifact.auth.authentication, 'NOT_EXECUTED');
  assert.equal(artifact.auth.authorization, 'NOT_EXECUTED');
  assert.equal(artifact.auth.documentedContract, false);
  const authRows = artifact.requests.filter((row) => row.result === 'NOT_EXECUTED');
  assert.equal(authRows.length, 2);
  assert.equal(authRows.every((row) => row.includedInPassCount === false), true);
  assert.equal(authRows.every((row) => row.source === 'capability'), true);
});

test('token present without a documented auth contract stays NOT_EXECUTED', () => {
  const artifact = parsePostmanReportForSection27({ report, config: config(), tokenPresent: true });
  assert.equal(artifact.auth.authentication, 'NOT_EXECUTED');
  assert.equal(artifact.auth.documentedContract, false);
  assert.match(artifact.auth.reason, /no authentication or authorization contract/i);
});

test('documented bearer contract without QA_API_TOKEN stays NOT_EXECUTED', () => {
  const documented = config();
  documented.postman.auth = { type: 'bearer', tokenEnv: 'apiToken' };
  const artifact = parsePostmanReportForSection27({ report, config: documented, tokenPresent: false });
  assert.equal(artifact.auth.authentication, 'NOT_EXECUTED');
  assert.equal(artifact.auth.documentedContract, true);
  assert.match(artifact.auth.reason, /QA_API_TOKEN/i);
});

test('documented bearer contract with QA_API_TOKEN is EXECUTED', () => {
  const documented = config();
  documented.postman.auth = { type: 'bearer', tokenEnv: 'apiToken' };
  const artifact = parsePostmanReportForSection27({ report, config: documented, tokenPresent: true });
  assert.equal(artifact.auth.authentication, 'EXECUTED');
  assert.equal(artifact.auth.authorization, 'EXECUTED');
  assert.equal(artifact.requests.filter((row) => row.result === 'NOT_EXECUTED').length, 0);
});

test('executed rows are sourced from config, not invented discovery paths', () => {
  const artifact = parsePostmanReportForSection27({
    report,
    config: config(),
    tokenPresent: false,
    discoveryNote: 'Sauce Demo discovery found 0 xhr/fetch/websocket APIs.',
  });
  const executed = artifact.requests.filter((row) => row.result !== 'NOT_EXECUTED');
  assert.ok(executed.every((row) => row.source === 'config'));
  assert.match(artifact.discoveryNote, /0 xhr\/fetch\/websocket/i);
  assert.match(artifact.terminology, /qa\.config\.json/i);
});

test('API stage passes when documented 404 matches observed 404', () => {
  const artifact = parsePostmanReportForSection27({ report, config: config(), tokenPresent: false });
  assert.equal(apiStagePassed(artifact), true);
});

test('API stage fails when expectedStatus contradicts the observed status', () => {
  const mismatched = config();
  const solutionsReq = mismatched.postman.requests.find((row) => row.path === '/solutions');
  assert.ok(solutionsReq);
  solutionsReq.expectedStatus = 200;
  const artifact = parsePostmanReportForSection27({ report, config: mismatched, tokenPresent: false });
  assert.equal(apiStagePassed(artifact), false);
});
