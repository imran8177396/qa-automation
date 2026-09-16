import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateCorrelationApplicability,
  FIXTURE_SELF_CHECK_ID,
  NO_DISCOVERED_XHR_AND_NO_PAIR,
} from './applicability';
import { applicableTestTypes } from '../discovery/test-types';
import type { QaConfig } from '../types';

const liveConfig = {
  urls: { website: 'https://www.saucedemo.com/', api: 'https://jsonplaceholder.typicode.com' },
  playwright: { enabled: true, baseURL: 'https://www.saucedemo.com', browsers: ['chromium'], headless: true },
  postman: { enabled: true, collectionName: 't', requests: [{ name: 'GET /posts', method: 'GET', path: '/posts' }] },
  workflows: { correlated: [] },
} as unknown as QaConfig;

describe('correlation applicability', () => {
  it('marks Sauce Demo as NOT_APPLICABLE when there is no XHR and no documented pair', () => {
    const result = evaluateCorrelationApplicability(liveConfig, null);
    assert.equal(result.discoveredXhrCount, 0);
    assert.equal(result.documentedPairCount, 0);
    assert.equal(result.validPairs.length, 0);
    assert.equal(result.productCorrelation.status, 'NOT_APPLICABLE');
    assert.match(result.productCorrelation.reason, new RegExp(NO_DISCOVERED_XHR_AND_NO_PAIR.replace(/[↔]/g, '.')));
    assert.equal(result.discoveredNetwork.status, 'NOT_APPLICABLE');
    assert.equal(result.fixtureSelfCheck.status, 'NOT_APPLICABLE');
    assert.equal(result.fixtureSelfCheck.pair.id, FIXTURE_SELF_CHECK_ID);
    assert.match(result.fixtureSelfCheck.reason, /not Sauce Demo coverage/i);
  });

  it('marks observed XHR without a documented pair as REQUIRES_CONFIGURATION', () => {
    const result = evaluateCorrelationApplicability(liveConfig, {
      generatedAt: new Date().toISOString(),
      seedUrl: 'https://www.saucedemo.com/',
      pagesObserved: 1,
      calls: [
        {
          fromPage: 'https://www.saucedemo.com/',
          method: 'GET',
          url: 'https://www.saucedemo.com/observed',
          status: 200,
          resourceType: 'xhr',
          contentType: 'application/json',
          sameOrigin: true,
          applicableTestTypes: applicableTestTypes('api'),
          potentialAction: 'observe',
          evidence: 'observed xhr',
        },
      ],
      categoryStatus: [],
    });
    assert.equal(result.discoveredXhrCount, 1);
    assert.equal(result.productCorrelation.status, 'REQUIRES_CONFIGURATION');
    assert.equal(result.discoveredNetwork.status, 'REQUIRES_CONFIGURATION');
    assert.equal(result.validPairs.length, 0);
  });
});
