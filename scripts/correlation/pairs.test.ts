import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyDocumentedPair,
  documentedRequestFor,
  normalizeApiPath,
  responseMatchesPair,
  uiApiOriginsCompatible,
} from './pairs';
import { applicableTestTypes } from '../discovery/test-types';
import type { QaConfig } from '../types';

const sauceConfig = {
  urls: { website: 'https://www.saucedemo.com/', api: 'https://jsonplaceholder.typicode.com' },
  playwright: { baseURL: 'https://www.saucedemo.com' },
  postman: {
    enabled: true,
    collectionName: 't',
    requests: [{ name: 'GET /posts', method: 'GET', path: '/posts', expectedStatus: 200 }],
  },
} as unknown as QaConfig;

describe('correlation pair matching', () => {
  it('normalizes API paths without inventing hosts', () => {
    assert.equal(normalizeApiPath('/posts/'), '/posts');
    assert.equal(normalizeApiPath('https://jsonplaceholder.typicode.com/posts/1'), '/posts/1');
    assert.equal(normalizeApiPath('posts'), '/posts');
  });

  it('finds only documented Postman requests', () => {
    assert.ok(documentedRequestFor(sauceConfig, 'GET', '/posts'));
    assert.equal(documentedRequestFor(sauceConfig, 'POST', '/session'), undefined);
    assert.equal(documentedRequestFor(sauceConfig, 'GET', '/inventory'), undefined);
    assert.equal(documentedRequestFor(sauceConfig, 'GET', '/cart'), undefined);
  });

  it('treats Sauce Demo UI and JSONPlaceholder as incompatible origins', () => {
    assert.equal(uiApiOriginsCompatible(sauceConfig, '/'), false);
    assert.equal(uiApiOriginsCompatible(sauceConfig, 'https://www.saucedemo.com/'), false);
  });

  it('matches observed responses by method and path', () => {
    assert.equal(responseMatchesPair('https://127.0.0.1:4173/api/status', 'GET', 'GET', '/api/status'), true);
    assert.equal(responseMatchesPair('https://www.saucedemo.com/inventory.html', 'GET', 'GET', '/inventory'), false);
  });

  it('rejects invented Sauce Demo REST even when a pair is written in config', () => {
    const result = classifyDocumentedPair(
      sauceConfig,
      { id: 'x', apiMethod: 'POST', apiPath: '/session', uiPath: '/' },
      []
    );
    assert.equal(result.status, 'UNCOVERED');
    assert.equal(result.documented, false);
  });

  it('accepts a documented pair only when discovery observed the same call', () => {
    const result = classifyDocumentedPair(
      sauceConfig,
      { id: 'x', apiMethod: 'GET', apiPath: '/posts', uiPath: '/' },
      [
        {
          fromPage: 'https://www.saucedemo.com/',
          method: 'GET',
          url: 'https://jsonplaceholder.typicode.com/posts',
          status: 200,
          resourceType: 'fetch',
          contentType: 'application/json',
          sameOrigin: false,
          applicableTestTypes: applicableTestTypes('api'),
          potentialAction: 'observe',
          evidence: 'observed fetch',
        },
      ]
    );
    assert.equal(result.status, 'PLANNED');
    assert.equal(result.observed, true);
  });
});
