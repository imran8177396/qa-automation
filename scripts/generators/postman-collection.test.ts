import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QaConfig } from '../types';
import {
  buildCollectionAuth,
  buildPostmanCollection,
  buildPostmanEnvironment,
  isSupportedHttpMethod,
} from './postman-collection';

function config(): QaConfig {
  return {
    project: { name: 'QA Automation' },
    urls: { website: 'https://www.saucedemo.com/', api: 'https://jsonplaceholder.typicode.com' },
    pipeline: { steps: ['api'], failFast: false },
    postman: {
      enabled: true,
      collectionName: 'QA Automation API',
      auth: { type: 'none' },
      assertions: { expectJson: true, maxResponseTimeMs: 15000 },
      requests: [
        {
          name: 'POST /posts — create resource',
          method: 'POST',
          path: '/posts',
          kind: 'valid',
          expectedStatus: 201,
          body: { title: 't', body: 'b', userId: 1 },
          assertions: { statusCode: 201, expectJson: true, requiredFields: ['id'] },
        },
        {
          name: 'GET /cart — invented sauce path',
          method: 'GET',
          path: '/cart',
          enabled: false,
        },
      ],
    },
    playwright: { enabled: false, baseURL: 'https://www.saucedemo.com', headless: true },
    jmeter: { enabled: false, path: '/', threads: 1, rampUpSeconds: 1, loopCount: 1 },
    github: { branches: ['main'], runOnPullRequest: true },
  };
}

test('only GET/POST/PUT/PATCH/DELETE are supported collection methods', () => {
  assert.equal(isSupportedHttpMethod('POST'), true);
  assert.equal(isSupportedHttpMethod('OPTIONS'), false);
});

test('collection items come from config, never embed secrets, and skip disabled invented paths', () => {
  const collection = buildPostmanCollection(config()) as {
    info: { description: string };
    item: Array<{ name: string; request: { header: Array<{ key: string; value: string }>; body?: { raw: string } } }>;
  };
  assert.match(collection.info.description, /qa\.config\.json/);
  assert.match(collection.info.description, /0 xhr\/fetch\/websocket/);
  assert.equal(collection.item.length, 1);
  assert.equal(collection.item[0]?.name, 'POST /posts — create resource');
  assert.ok(collection.item[0]?.request.header.some((header) => header.key === 'Content-Type'));
  const serialized = JSON.stringify(collection);
  assert.doesNotMatch(serialized, /Bearer [A-Za-z0-9._-]{8,}/);
  assert.doesNotMatch(serialized, /\/cart/);
});

test('environment keeps token placeholders empty', () => {
  const environment = buildPostmanEnvironment(config()) as {
    values: Array<{ key: string; value: string }>;
  };
  const token = environment.values.find((value) => value.key === 'apiToken');
  assert.ok(token);
  assert.equal(token.value, '');
});

test('documented bearer auth uses {{apiToken}} and never a literal secret', () => {
  const auth = buildCollectionAuth({ type: 'bearer', tokenEnv: 'apiToken' }) as {
    type: string;
    bearer: Array<{ value: string }>;
  };
  assert.equal(auth.type, 'bearer');
  assert.equal(auth.bearer[0]?.value, '{{apiToken}}');
});
