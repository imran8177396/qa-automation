import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicableScenarios } from './scenarios';
import { applyEvidence } from './match';
import { classifyItem, ensureCoverageReason, isCoveredStatus, percent } from './status';
import { displayCoverageStatus } from './project-status';
import type { ExecutionEvidence, InventoryItem } from './types';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'kind' | 'name'>): InventoryItem {
  return {
    source: 'discovery',
    applicableScenarios: applicableScenarios({
      kind: partial.kind,
      pageStatus: 200,
      elementType: partial.elementType,
    }),
    ...partial,
  };
}

function evidence(partial: Partial<ExecutionEvidence> & Pick<ExecutionEvidence, 'id' | 'title'>): ExecutionEvidence {
  return {
    source: 'playwright',
    urlHints: [],
    locatorHints: [],
    status: 'PASS',
    executed: true,
    ...partial,
  };
}

function classify(target: InventoryItem, rows: ExecutionEvidence[]) {
  return classifyItem(applyEvidence([target], rows)[0], rows);
}

test('every required status can be classified and SKIPPED always has a reason', () => {
  const tested = classify(
    item({ id: 'PAGE-0001', kind: 'page', name: 'Home', page: 'https://example.com/', route: '/' }),
    [evidence({ id: 'PW-1', title: 'https://example.com/ loads', urlHints: ['https://example.com/'] })]
  );
  assert.equal(tested.status, 'TESTED');
  assert.ok(tested.reason.trim().length > 0);

  const failed = classify(
    item({ id: 'A11Y-scan', kind: 'accessibility', name: 'Accessibility scan', source: 'capability' }),
    [evidence({ id: 'A11Y-1', source: 'accessibility', title: 'axe scan', status: 'FAIL' })]
  );
  assert.equal(failed.status, 'FAILED');
  assert.equal(isCoveredStatus('FAILED'), true);
  assert.notEqual(failed.status, 'UNCOVERED');

  const blocked = classifyItem(
    item({
      id: 'WF-0001',
      kind: 'workflow',
      name: 'Submit',
      projectStatus: 'NOT_TESTED',
      applicableScenarios: [
        {
          id: 'form-submit',
          disposition: 'blocked-safety',
          reason: 'Submit is blocked by the safety policy',
          tested: false,
          evidenceIds: [],
        },
      ],
    }),
    []
  );
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(isCoveredStatus('BLOCKED'), false);

  const skipped = classifyItem(
    item({
      id: 'API-OFF',
      kind: 'api',
      name: 'GET /off',
      source: 'config',
      coverageHint: 'skipped',
      applicableScenarios: [
        {
          id: 'api-smoke',
          disposition: 'requires-configuration',
          reason: 'Disabled in qa.config.json.',
          tested: false,
          evidenceIds: [],
        },
      ],
    }),
    []
  );
  assert.equal(skipped.status, 'SKIPPED');
  assert.equal(displayCoverageStatus('SKIPPED'), 'SKIPPED WITH REASON');
  assert.ok(skipped.reason.trim().length > 0);

  const skippedEmpty = classifyItem(
    item({
      id: 'API-EMPTY',
      kind: 'api',
      name: 'GET /empty',
      source: 'config',
      coverageHint: 'skipped',
      applicableScenarios: [],
    }),
    []
  );
  assert.equal(skippedEmpty.status, 'SKIPPED');
  assert.ok(skippedEmpty.reason.trim().length > 0);

  const notApplicable = classifyItem(
    item({
      id: 'CAT-table',
      kind: 'table',
      name: 'Tables',
      coverageHint: 'not-applicable',
      applicableScenarios: [
        {
          id: 'visibility',
          disposition: 'not-implemented',
          reason: 'not observed in discovery',
          tested: false,
          evidenceIds: [],
        },
      ],
    }),
    []
  );
  assert.equal(notApplicable.status, 'NOT APPLICABLE');

  const untestable = classifyItem(
    item({
      id: 'UI-X',
      kind: 'ui-component',
      name: 'unknown',
      coverageHint: 'untestable',
      applicableScenarios: [
        {
          id: 'visibility',
          disposition: 'not-implemented',
          reason: 'No executable coverage mapping',
          tested: false,
          evidenceIds: [],
        },
      ],
    }),
    []
  );
  assert.equal(untestable.status, 'UNTESTABLE');

  const uncovered = classify(
    item({ id: 'PAGE-0002', kind: 'page', name: 'Other', page: 'https://example.com/other', route: '/other' }),
    []
  );
  assert.equal(uncovered.status, 'UNCOVERED');
});

test('security and SEO FAIL evidence classify as FAILED, not UNCOVERED', () => {
  const security = item({
    id: 'SEC-baseline',
    kind: 'security',
    name: 'QA-level security baseline',
    source: 'capability',
  });
  const seo = item({
    id: 'SEO-baseline',
    kind: 'seo',
    name: 'Technical SEO baseline',
    source: 'capability',
  });
  const rows = [
    evidence({
      id: 'SEC-0001',
      source: 'security',
      title: 'QA-level security baseline',
      status: 'FAIL',
    }),
    evidence({
      id: 'SEO-0001',
      source: 'seo',
      title: 'Technical SEO baseline',
      status: 'FAIL',
    }),
  ];
  assert.equal(classify(security, rows).status, 'FAILED');
  assert.equal(classify(seo, rows).status, 'FAILED');
});

test('RECORDED execution evidence counts as TESTED, not UNCOVERED', () => {
  const perf = item({
    id: 'PERF-liveness',
    kind: 'performance',
    name: 'liveness performance profile',
    source: 'capability',
  });
  const row = evidence({
    id: 'JMETER-liveness',
    source: 'jmeter',
    title: 'liveness performance profile against https://jsonplaceholder.typicode.com/posts',
    file: 'documented-api.jmx',
    status: 'RECORDED',
    executed: true,
  });
  assert.equal(classify(perf, [row]).status, 'TESTED');
});

test('ensureCoverageReason never returns an empty SKIPPED WITH REASON string', () => {
  assert.ok(ensureCoverageReason('SKIPPED', '').includes('SKIPPED WITH REASON'));
  assert.equal(ensureCoverageReason('FAILED', '  boom  '), 'boom');
});

test('percent never rounds a partial run up to 100', () => {
  assert.equal(percent(99, 100), 99);
  assert.equal(percent(1999, 2000), 99.9);
  assert.equal(percent(0, 0), 0);
  assert.equal(percent(2, 2), 100);
});
