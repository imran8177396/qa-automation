import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveCorrelatedWorkflows } from './resolve';
import type { QaConfig } from '../types';

describe('resolveCorrelatedWorkflows', () => {
  it('returns an empty list when workflows.correlated is omitted or empty', () => {
    assert.deepEqual(resolveCorrelatedWorkflows({} as QaConfig), []);
    assert.deepEqual(resolveCorrelatedWorkflows({ workflows: { correlated: [] } } as unknown as QaConfig), []);
  });

  it('maps documented pairs without inventing extra endpoints', () => {
    const rows = resolveCorrelatedWorkflows({
      workflows: {
        correlated: [
          {
            id: 'demo',
            name: 'Demo pair',
            uiPath: '/correlated.html',
            apiMethod: 'GET',
            apiPath: '/api/status',
            expectedStatus: 200,
            uiAction: '[data-qa="load-status"]',
            uiResult: '[data-qa="status-result"]',
          },
        ],
      },
    } as unknown as QaConfig);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.apiPath, '/api/status');
    assert.equal(rows[0]?.uiAction, '[data-qa="load-status"]');
  });
});
