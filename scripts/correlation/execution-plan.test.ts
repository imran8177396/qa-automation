import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildWorkflowExecutionPlan } from './execution-plan';
import { NO_DISCOVERED_XHR_AND_NO_PAIR } from './applicability';
import type { QaConfig } from '../types';

const emptyInventories = { apiInventory: null, workflowInventory: null } as const;

describe('workflow execution plan', () => {
  it('records empty correlated workflows as UNCOVERED instead of skipping the stage', () => {
    const plan = buildWorkflowExecutionPlan(
      { workflows: { correlated: [] } } as unknown as QaConfig,
      emptyInventories
    );
    const uncovered = plan.gated.find((row) => row.id === 'WF-CORRELATED');
    assert.equal(uncovered?.status, 'UNCOVERED');
    assert.match(uncovered?.reason ?? '', /empty/);
    assert.match(uncovered?.reason ?? '', new RegExp(NO_DISCOVERED_XHR_AND_NO_PAIR.replace(/[↔]/g, '.')));
    assert.match(plan.note, /UNCOVERED|no executable UI/);
  });

  it('records missing XHR as NOT_APPLICABLE and does not invent Sauce Demo REST', () => {
    const plan = buildWorkflowExecutionPlan(
      { workflows: { correlated: [] } } as unknown as QaConfig,
      emptyInventories
    );
    const network = plan.gated.find((row) => row.id === 'WF-DISCOVERED-NETWORK');
    assert.equal(network?.status, 'NOT_APPLICABLE');
    assert.match(network?.reason ?? '', /no discovered XHR/);
    assert.equal(plan.correlated.length, 0);
    assert.equal(plan.executable.filter((row) => row.kind === 'correlated').length, 0);
  });

  it('rejects an invented Sauce Demo /session pair that is not in postman.requests', () => {
    const plan = buildWorkflowExecutionPlan(
      {
        urls: { website: 'https://www.saucedemo.com/', api: 'https://jsonplaceholder.typicode.com' },
        playwright: { baseURL: 'https://www.saucedemo.com' },
        postman: { enabled: true, collectionName: 't', requests: [] },
        workflows: {
          correlated: [
            {
              id: 'login-session',
              name: 'Invented login session',
              uiPath: '/',
              apiMethod: 'POST',
              apiPath: '/session',
              expectedStatus: 200,
            },
          ],
        },
      } as unknown as QaConfig,
      emptyInventories
    );
    assert.equal(plan.correlated.length, 0);
    const rejected = plan.gated.find((row) => row.id === 'login-session');
    assert.equal(rejected?.status, 'UNCOVERED');
    assert.match(rejected?.reason ?? '', /not invented|postman\.requests/i);
  });

  it('does not force JSONPlaceholder GET /posts into Sauce Demo UI', () => {
    const plan = buildWorkflowExecutionPlan(
      {
        urls: { website: 'https://www.saucedemo.com/', api: 'https://jsonplaceholder.typicode.com' },
        playwright: { baseURL: 'https://www.saucedemo.com' },
        postman: {
          enabled: true,
          collectionName: 't',
          requests: [{ name: 'GET /posts', method: 'GET', path: '/posts', expectedStatus: 200 }],
        },
        workflows: {
          correlated: [
            {
              id: 'login-posts',
              name: 'Login then GET /posts',
              uiPath: '/',
              apiMethod: 'GET',
              apiPath: '/posts',
              expectedStatus: 200,
            },
          ],
        },
      } as unknown as QaConfig,
      emptyInventories
    );
    assert.equal(plan.correlated.length, 0);
    const rejected = plan.gated.find((row) => row.id === 'login-posts');
    assert.equal(rejected?.status, 'NOT_APPLICABLE');
    assert.match(rejected?.reason ?? '', /not forced|JSONPlaceholder/i);
  });
});
