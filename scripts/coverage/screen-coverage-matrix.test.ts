import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScreenCoverageMatrix,
  renderScreenCoverageMatrixMarkdown,
} from './screen-coverage-matrix';

test('two fixture screens: counts match; no extra Dashboard row', () => {
  const { rows, generatedFrom } = buildScreenCoverageMatrix({
    screens: [
      {
        screenId: 'SCREEN-001',
        title: 'Login',
        elements: [{ elementId: 'UI-0001', decorative: false }],
      },
      {
        screenId: 'SCREEN-002',
        url: '/settings',
        elements: [],
      },
    ],
    checks: [
      { screenId: 'SCREEN-001', scenarioKind: 'positive', status: 'PLANNED' },
      { screenId: 'SCREEN-001', category: 'positive', status: 'BLOCKED' },
      { screenId: 'SCREEN-002', scenarioKind: 'visual', status: 'NOT_TESTED' },
    ],
  });

  assert.equal(generatedFrom, 'discovered-screens');
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.screenId),
    ['SCREEN-001', 'SCREEN-002']
  );
  assert.ok(!rows.some((r) => r.screen === 'Dashboard' || r.screenId.includes('Dashboard')));

  assert.equal(rows[0]?.screen, 'Login');
  assert.equal(rows[0]?.elements, 1);
  assert.equal(rows[0]?.positive, 2);
  assert.equal(rows[0]?.negative, 0);
  assert.equal(rows[0]?.edge, 0);
  assert.equal(rows[0]?.security, 0);
  assert.equal(rows[0]?.a11y, 0);
  assert.equal(rows[0]?.visual, 0);

  assert.equal(rows[1]?.screen, '/settings');
  assert.equal(rows[1]?.elements, 0);
  assert.equal(rows[1]?.positive, 0);
  assert.equal(rows[1]?.visual, 1);
});

test('decorative element is not counted in elements', () => {
  const { rows } = buildScreenCoverageMatrix({
    screens: [
      {
        screenId: 'SCREEN-A',
        title: 'A',
        elements: [
          { elementId: 'UI-1', decorative: true },
          { elementId: 'UI-2' },
          { elementId: 'UI-3', decorative: false },
        ],
      },
    ],
    checks: [],
  });
  assert.equal(rows[0]?.elements, 2);
});

test('empty screens array yields empty rows', () => {
  const { rows } = buildScreenCoverageMatrix({
    screens: [],
    checks: [{ screenId: 'SCREEN-001', scenarioKind: 'positive' }],
  });
  assert.deepEqual(rows, []);
});

test('check without screenId does not increment any row', () => {
  const { rows } = buildScreenCoverageMatrix({
    screens: [{ screenId: 'SCREEN-001', title: 'Login', elements: [] }],
    checks: [
      { scenarioKind: 'positive', status: 'PLANNED' },
      { screenId: 'SCREEN-001', scenarioKind: 'negative', status: 'FAIL' },
    ],
  });
  assert.equal(rows[0]?.positive, 0);
  assert.equal(rows[0]?.negative, 1);
});

test('edge scenarioKind counts in the edge column', () => {
  const { rows } = buildScreenCoverageMatrix({
    screens: [{ screenId: 'SCREEN-001', url: '/x', elements: [] }],
    checks: [
      { screenId: 'SCREEN-001', scenarioKind: 'edge', status: 'PASS' },
      { screenId: 'SCREEN-001', category: 'boundary', status: 'NOT_APPLICABLE' },
    ],
  });
  assert.equal(rows[0]?.edge, 2);
});

test('markdown has header only when empty; never example counts 14/20/30', () => {
  const emptyMd = renderScreenCoverageMatrixMarkdown([]);
  assert.match(emptyMd, /\| Screen \| Elements \| Positive \| Negative \| Edge \| Security \| A11y \| Visual \|/);
  assert.equal(emptyMd.trim().split('\n').length, 2);
  assert.doesNotMatch(emptyMd, /\b14\b/);
  assert.doesNotMatch(emptyMd, /\b20\b/);
  assert.doesNotMatch(emptyMd, /\b30\b/);

  const { rows } = buildScreenCoverageMatrix({
    screens: [
      { screenId: 'SCREEN-001', title: 'Login', elements: [{ elementId: 'e1' }] },
      { screenId: 'SCREEN-002', url: '/settings', elements: [] },
    ],
    checks: [
      { screenId: 'SCREEN-001', scenarioKind: 'positive' },
      { screenId: 'SCREEN-001', category: 'positive' },
      { screenId: 'SCREEN-002', scenarioKind: 'visual' },
    ],
  });
  const md = renderScreenCoverageMatrixMarkdown(rows);
  assert.doesNotMatch(md, /\b14\b/);
  assert.doesNotMatch(md, /\b20\b/);
  assert.doesNotMatch(md, /\b30\b/);
  assert.match(md, /Login/);
  assert.match(md, /\/settings/);
});
