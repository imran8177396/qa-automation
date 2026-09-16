import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildWorkflowEvidenceReport, renderWorkflowFindingsMarkdown } from './evidence';
import { buildWorkflowExecutionPlan } from './execution-plan';
import { NO_DISCOVERED_XHR_AND_NO_PAIR } from './applicability';
import type { QaConfig } from '../types';

describe('correlation evidence', () => {
  it('records the explicit N/A reason when correlation is not used', () => {
    const plan = buildWorkflowExecutionPlan(
      { workflows: { correlated: [] } } as unknown as QaConfig,
      { apiInventory: null, workflowInventory: null }
    );
    const report = buildWorkflowEvidenceReport({
      target: 'https://www.saucedemo.com/',
      plan,
      applicability: plan.applicability,
      runtime: [],
    });
    assert.equal(report.correlationUsed, false);
    assert.equal(report.discoveredXhrCount, 0);
    assert.equal(report.validPairCount, 0);
    assert.match(report.reason, new RegExp(NO_DISCOVERED_XHR_AND_NO_PAIR.replace(/[↔]/g, '.')));
    assert.equal(report.suitesRemainSeparate.ui, 'test:e2e / test:ui');
    assert.equal(report.suitesRemainSeparate.api, 'test:api');
    assert.equal(report.suitesRemainSeparate.combined, 'test:workflows');
    const markdown = renderWorkflowFindingsMarkdown(report);
    assert.match(markdown, /Product UI↔API correlation was not used/);
    assert.match(markdown, /WF-CORRELATED/);
  });

  it('keeps request URL/method/status and the UI assertion when correlation is used', () => {
    const plan = buildWorkflowExecutionPlan(
      { workflows: { correlated: [] } } as unknown as QaConfig,
      { apiInventory: null, workflowInventory: null }
    );
    const report = buildWorkflowEvidenceReport({
      target: 'http://127.0.0.1:4173',
      plan,
      applicability: plan.applicability,
      runtime: [
        {
          id: 'WF-FIXTURE-SELF-CHECK',
          name: 'Fixture UI↔API self-check',
          scope: 'framework-self-check',
          status: 'PASS',
          request: { url: 'http://127.0.0.1:4173/api/status', method: 'GET', status: 200 },
          uiAssertion: { locator: '[data-qa="status-result"]', expected: 'ok', actual: 'ok' },
          note: 'Framework self-check. Not Sauce Demo coverage.',
        },
      ],
    });
    assert.equal(report.correlationUsed, false, 'fixture self-check must not count as Sauce Demo correlation');
    assert.match(report.reason, /not Sauce Demo coverage/i);
    const fixture = report.items.find((row) => row.id === 'WF-FIXTURE-SELF-CHECK');
    assert.equal(fixture?.request?.method, 'GET');
    assert.equal(fixture?.request?.status, 200);
    assert.match(fixture?.request?.url ?? '', /\/api\/status/);
    assert.equal(fixture?.uiAssertion?.actual, 'ok');
    assert.equal(fixture?.scope, 'framework-self-check');
  });
});
