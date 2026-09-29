import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestCaseTraces, renderTestCaseTraceLine } from './traceability';

test('planned check without executionResult → NOT_EXECUTED; PASS string absent', () => {
  const { traces, gaps } = buildTestCaseTraces({
    projectId: 'default',
    screens: [
      {
        screenId: 'SCREEN-001',
        elements: [{ elementId: 'ELEMENT-001', type: 'text-input' }],
      },
    ],
    checks: [
      {
        id: 'chk-1',
        screenId: 'SCREEN-001',
        targetElementId: 'ELEMENT-001',
        scenarioKind: 'negative',
        subcaseId: 'negative-empty',
        status: 'PASS',
      },
    ],
  });

  assert.equal(gaps.length, 0);
  assert.equal(traces.length, 1);
  const t = traces[0]!;
  assert.equal(t.projectId, 'default');
  assert.equal(t.screenId, 'SCREEN-001');
  assert.equal(t.elementId, 'ELEMENT-001');
  assert.equal(t.elementType, 'text-input');
  assert.equal(t.testType, 'negative');
  assert.equal(t.testCaseId, 'negative-empty');
  assert.equal(t.execution, 'NOT_EXECUTED');
  assert.equal(t.result, 'NOT_EXECUTED');
  assert.equal(t.expected, null);
  assert.doesNotMatch(JSON.stringify(t), /\bPASS\b/);
  assert.doesNotMatch(renderTestCaseTraceLine(t), /\bPASS\b/);
});

test('executionResult PASS → EXECUTED and result PASS', () => {
  const { traces } = buildTestCaseTraces({
    screens: [{ screenId: 'SCREEN-001', elements: [{ elementId: 'ELEMENT-001', type: 'text-input' }] }],
    checks: [
      {
        screenId: 'SCREEN-001',
        targetElementId: 'ELEMENT-001',
        scenarioKind: 'negative',
        subcaseId: 'negative-empty',
        executionResult: 'PASS',
      },
    ],
  });

  assert.equal(traces[0]?.execution, 'EXECUTED');
  assert.equal(traces[0]?.result, 'PASS');
});

test('ELEMENT-002 with no check → gap element-without-case', () => {
  const { traces, gaps } = buildTestCaseTraces({
    screens: [
      {
        screenId: 'SCREEN-001',
        elements: [
          { elementId: 'ELEMENT-001', type: 'text-input' },
          { elementId: 'ELEMENT-002', type: 'button' },
        ],
      },
    ],
    checks: [
      {
        screenId: 'SCREEN-001',
        targetElementId: 'ELEMENT-001',
        scenarioKind: 'positive',
        id: 'pos-1',
      },
    ],
  });

  assert.equal(traces.length, 1);
  const gap = gaps.find((g) => g.testCaseId === 'element-without-case');
  assert.ok(gap);
  assert.equal(gap!.elementId, 'ELEMENT-002');
  assert.equal(gap!.elementType, 'button');
  assert.equal(gap!.behavior, 'untested-element');
  assert.equal(gap!.testType, 'gap');
  assert.equal(gap!.execution, 'NOT_EXECUTED');
  assert.equal(gap!.result, 'NOT_EXECUTED');
  assert.equal(gap!.expected, null);
});

test('both arrays empty → traces [] and gaps []', () => {
  const { traces, gaps } = buildTestCaseTraces({ screens: [], checks: [] });
  assert.deepEqual(traces, []);
  assert.deepEqual(gaps, []);
});

test('decorative element does not create a gap', () => {
  const { traces, gaps } = buildTestCaseTraces({
    screens: [
      {
        screenId: 'SCREEN-001',
        elements: [
          { elementId: 'ELEMENT-001', type: 'text-input' },
          { elementId: 'ELEMENT-DECOR', type: 'decorative', decorative: true },
        ],
      },
    ],
    checks: [
      {
        screenId: 'SCREEN-001',
        targetElementId: 'ELEMENT-001',
        scenarioKind: 'positive',
        id: 'pos-1',
      },
    ],
  });

  assert.equal(traces.length, 1);
  assert.equal(gaps.length, 0);
  assert.ok(!gaps.some((g) => g.elementId === 'ELEMENT-DECOR'));
});

test('render does not contain ELEMENT-007 unless the fixture used it', () => {
  const { traces } = buildTestCaseTraces({
    screens: [
      {
        screenId: 'SCREEN-001',
        elements: [{ elementId: 'ELEMENT-001', type: 'text-input' }],
      },
    ],
    checks: [
      {
        screenId: 'SCREEN-001',
        targetElementId: 'ELEMENT-001',
        scenarioKind: 'negative',
        subcaseId: 'negative-empty',
      },
    ],
  });

  const rendered = renderTestCaseTraceLine(traces[0]!);
  assert.equal(
    rendered,
    ['SCREEN-001', 'ELEMENT-001', 'TYPE=text-input', 'TEST=negative-empty', 'RESULT=NOT_EXECUTED'].join(
      '\n'
    )
  );
  assert.doesNotMatch(rendered, /ELEMENT-007/);
  assert.doesNotMatch(rendered, /email-input/);
  assert.doesNotMatch(rendered, /validation-error/);
  assert.doesNotMatch(JSON.stringify(traces), /demo\.|example\.com|localhost/i);
});

test('screen with zero elements and zero checks → screen-without-case gap', () => {
  const { traces, gaps } = buildTestCaseTraces({
    screens: [{ screenId: 'SCREEN-EMPTY', elements: [] }],
    checks: [],
  });
  assert.equal(traces.length, 0);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]?.testCaseId, 'screen-without-case');
  assert.equal(gaps[0]?.screenId, 'SCREEN-EMPTY');
  assert.equal(gaps[0]?.result, 'NOT_EXECUTED');
});

test('check without screenId → UNSCOPED gap', () => {
  const { traces, gaps } = buildTestCaseTraces({
    screens: [],
    checks: [{ id: 'orphan', scenarioKind: 'positive' }],
  });
  assert.equal(traces.length, 0);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]?.screenId, 'UNSCOPED');
  assert.equal(gaps[0]?.testCaseId, 'orphan');
  assert.equal(gaps[0]?.result, 'NOT_EXECUTED');
});

test('empty projectId falls back to default; expected from expect.note only', () => {
  const { traces } = buildTestCaseTraces({
    projectId: '  ',
    screens: [{ screenId: 'SCREEN-001', elements: [] }],
    checks: [
      {
        screenId: 'SCREEN-001',
        id: 'chk',
        category: 'negative',
        expect: { note: 'shows-error' },
      },
    ],
  });
  assert.equal(traces[0]?.projectId, 'default');
  assert.equal(traces[0]?.behavior, 'negative');
  assert.equal(traces[0]?.testType, 'negative');
  assert.equal(traces[0]?.expected, 'shows-error');
  const rendered = renderTestCaseTraceLine(traces[0]!);
  assert.match(rendered, /EXPECTED=shows-error/);
  assert.doesNotMatch(rendered, /^ELEMENT-/m);
  assert.doesNotMatch(rendered, /^TYPE=/m);
});
