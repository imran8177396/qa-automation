import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths';
import type { GenerationInventory } from '../discovery/generation-contract';
import {
  GENERATION_PIPELINE_STAGES,
  runGenerationPipeline,
} from './generation-pipeline';

const EXPECTED_STAGE_IDS = [
  'application',
  'discovery',
  'screen-inventory',
  'element-inventory',
  'behavior-inference',
  'constraint-extraction',
  'applicability',
  'positive',
  'negative',
  'boundary',
  'security',
  'accessibility',
  'visual',
  'workflow',
  'deduplication',
  'prioritization',
  'test-case-registry',
  'execution',
  'coverage',
] as const;

function oneScreenOneTextField(): GenerationInventory {
  return {
    version: '1',
    screens: [
      {
        screenId: 'SCREEN-001',
        url: '/form',
        title: 'Form',
        elements: [
          {
            elementId: 'ELEMENT-001',
            type: 'text-input',
            category: 'input',
            label: 'Name',
            screenId: 'SCREEN-001',
          },
        ],
      },
    ],
  };
}

test('GENERATION_PIPELINE_STAGES equals the 19-name list in order', () => {
  assert.deepEqual([...GENERATION_PIPELINE_STAGES], [...EXPECTED_STAGE_IDS]);
  assert.equal(GENERATION_PIPELINE_STAGES.length, 19);
});

test('one screen + one text field → checks, uniqueCases, matrix row; execution NOT_EXECUTED; no PASS', () => {
  const result = runGenerationPipeline({ inventory: oneScreenOneTextField() });

  assert.ok(result.checks.length > 0);
  assert.ok(result.uniqueCases.length > 0);
  assert.ok(result.uniqueCases.length <= result.checks.length);
  assert.equal(result.matrix.length, 1);
  assert.equal(result.matrix[0]?.screenId, 'SCREEN-001');

  const execution = result.stages.find((s) => s.id === 'execution');
  assert.equal(execution?.status, 'NOT_EXECUTED');

  assert.ok(result.traces.every((t) => t.execution === 'NOT_EXECUTED'));
  assert.ok(result.traces.every((t) => t.result === 'NOT_EXECUTED'));
  // No execution PASS claimed — planner expect notes may mention the word PASS.
  assert.ok(result.traces.every((t) => t.result !== 'PASS'));
  // Field scenarios stay non-critical; security/auth may be critical via assignTestPriority.
  assert.ok(
    result.uniqueCases
      .filter(
        (c) =>
          c.category === 'positive' ||
          c.category === 'negative' ||
          c.category === 'boundary'
      )
      .every((c) => c.priority !== 'critical')
  );

  const dedup = result.stages.find((s) => s.id === 'deduplication');
  assert.equal(dedup?.status, 'COMPLETED');
  assert.match(dedup?.note ?? '', /removed \d+/);
  assert.ok(result.uniqueCases.length <= result.checks.length);

  assert.equal(result.stages.map((s) => s.id).join(','), EXPECTED_STAGE_IDS.join(','));
  assert.doesNotMatch(JSON.stringify(result), /\/users\/create/);
});

test('missing inventory throws', () => {
  assert.throws(
    () => runGenerationPipeline({ inventory: null as unknown as GenerationInventory }),
    /generation pipeline requires a discovery inventory/
  );
  assert.throws(
    () => runGenerationPipeline({ inventory: undefined as unknown as GenerationInventory }),
    /generation pipeline requires a discovery inventory/
  );
});

test('executionResults for one id → that trace EXECUTED; others NOT_EXECUTED', () => {
  const inventory = oneScreenOneTextField();
  const planned = runGenerationPipeline({ inventory });
  assert.ok(planned.uniqueCases.length >= 1);
  const targetId = planned.uniqueCases[0]!.testCaseId;
  const suppliedResult = 'FAIL';

  const result = runGenerationPipeline({
    inventory,
    executionResults: [{ testCaseId: targetId, result: suppliedResult }],
  });

  const execution = result.stages.find((s) => s.id === 'execution');
  assert.notEqual(execution?.status, 'NOT_EXECUTED');

  const matched = result.traces.filter((t) => t.testCaseId === targetId);
  assert.ok(matched.length >= 1);
  for (const t of matched) {
    assert.equal(t.execution, 'EXECUTED');
    assert.equal(t.result, suppliedResult);
  }

  const others = result.traces.filter((t) => t.testCaseId !== targetId);
  for (const t of others) {
    assert.equal(t.execution, 'NOT_EXECUTED');
    assert.equal(t.result, 'NOT_EXECUTED');
  }

  assert.ok(result.traces.every((t) => t.result !== 'PASS'));
});

test('empty screens inventory is COMPLETED discovery, not EMPTY', () => {
  const result = runGenerationPipeline({
    inventory: { version: '1', screens: [] },
  });
  const discovery = result.stages.find((s) => s.id === 'discovery');
  assert.equal(discovery?.status, 'COMPLETED');
  assert.match(discovery?.note ?? '', /crawl not repeated/);
  assert.equal(result.matrix.length, 0);
  assert.equal(result.stages.find((s) => s.id === 'execution')?.status, 'NOT_EXECUTED');
  assert.equal(result.checks.length, 0);
  assert.equal(result.analystAnswers.length, 14);
  assert.equal(result.analystAnswers.find((a) => a.questionId === 'exists')?.status, 'NOT_TESTED');
  assert.ok(
    result.analystAnswers.every(
      (a) => a.status === 'NOT_TESTED' || a.status === 'REQUIRES_CONFIGURATION'
    )
  );
});

test('pipeline module source does not import playwright, crawler, or run-discover', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'generation-pipeline.ts'), 'utf8');
  const importLines = src
    .split(/\r?\n/)
    .filter((line) => /^\s*import\b/.test(line) || /^\s*from\s+['"]/.test(line))
    .join('\n');
  assert.doesNotMatch(importLines, /discovery\/crawler|['"]\.\/crawler['"]/);
  assert.doesNotMatch(importLines, /@playwright\/test|['"]playwright['"]/);
  assert.doesNotMatch(importLines, /run-discover/);
  assert.doesNotMatch(src, /\/users\/create/);
  assert.doesNotMatch(src, /saucedemo|jsonplaceholder/i);
  assert.match(src, /does not replace scripts\/run-all\.ts/);
  assert.match(src, /does not start from a predefined test list/);
  assert.match(src, /generateFromInventory/);
  assert.match(src, /answerAnalystQuestions/);
});

test('run-coverage is not wired to runGenerationPipeline (would double-write)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'coverage', 'run-coverage.ts'), 'utf8');
  assert.doesNotMatch(src, /runGenerationPipeline|generation-pipeline/);
});

test('human exclude override → case remains excluded; trace NOT_EXECUTED; not PASS', () => {
  const inventory = oneScreenOneTextField();
  const planned = runGenerationPipeline({ inventory });
  assert.ok(planned.uniqueCases.length >= 1);
  const targetId = planned.uniqueCases[0]!.testCaseId;

  const result = runGenerationPipeline({
    inventory,
    overrides: {
      version: '1',
      overrides: [
        {
          testCaseId: targetId,
          action: 'exclude',
          reason: 'duplicate of another case',
        },
      ],
    },
  });

  const excluded = result.uniqueCases.find((c) => c.testCaseId === targetId);
  assert.ok(excluded);
  assert.equal(excluded?.excluded, true);
  assert.equal(excluded?.exclusionReason, 'duplicate of another case');
  assert.equal(result.uniqueCases.length, planned.uniqueCases.length);
  assert.equal(result.humanOverrides?.excluded.length, 1);

  const matched = result.traces.filter((t) => t.testCaseId === targetId);
  assert.ok(matched.length >= 1);
  for (const t of matched) {
    assert.equal(t.result, 'NOT_EXECUTED');
    assert.equal(t.execution, 'NOT_EXECUTED');
    assert.match(t.expected ?? '', /excluded by human override/);
  }
  assert.ok(result.traces.every((t) => t.result !== 'PASS'));
});

test('null overrides leave cases unchanged', () => {
  const inventory = oneScreenOneTextField();
  const without = runGenerationPipeline({ inventory });
  const withNull = runGenerationPipeline({ inventory, overrides: null });
  assert.equal(withNull.uniqueCases.length, without.uniqueCases.length);
  assert.equal(withNull.humanOverrides, undefined);
  assert.ok(withNull.uniqueCases.every((c) => c.excluded !== true));
});

test('previousIdentities null → stable TC- ids; second run keeps id (updated)', () => {
  const inventory = oneScreenOneTextField();
  const now = '2026-09-26T12:00:00.000Z';
  const later = '2026-09-26T18:00:00.000Z';
  const first = runGenerationPipeline({
    inventory,
    previousIdentities: null,
    identityNow: now,
    projectId: 'demo-proj',
  });
  assert.ok(first.uniqueCases.length > 0);
  assert.ok(first.uniqueCases.every((c) => /^TC-[0-9a-f]{12}$/.test(c.testCaseId)));
  assert.ok(first.persistedIdentities);
  assert.equal(first.deprecatedIdentities?.length, 0);
  assert.ok(first.persistedIdentities!.every((p) => p.lifecycle === 'new'));
  assert.ok(first.traces.every((t) => t.result !== 'PASS'));

  const second = runGenerationPipeline({
    inventory,
    previousIdentities: first.persistedIdentities!,
    identityNow: later,
    projectId: 'demo-proj',
  });
  const firstByKey = new Map(first.persistedIdentities!.map((p) => [p.identityKey, p.testCaseId]));
  for (const row of second.persistedIdentities ?? []) {
    if (row.lifecycle === 'deprecated') continue;
    assert.equal(row.lifecycle, 'updated');
    assert.equal(row.testCaseId, firstByKey.get(row.identityKey));
    assert.equal(row.lastSeen, later);
  }
  assert.equal(second.uniqueCases[0]!.testCaseId, first.uniqueCases[0]!.testCaseId);
  assert.doesNotMatch(JSON.stringify(second.deprecatedIdentities ?? []), /"PASS"/);
});

test('human exclude still reconciles when previousIdentities provided', () => {
  const inventory = oneScreenOneTextField();
  // Overrides match planner ids (pre-identity); identity runs after overrides.
  const withoutIdentity = runGenerationPipeline({ inventory });
  const plannerId = withoutIdentity.uniqueCases[0]!.testCaseId;
  const excludedRun = runGenerationPipeline({
    inventory,
    previousIdentities: null,
    identityNow: '2026-09-26T14:00:00.000Z',
    overrides: {
      version: '1',
      overrides: [{ testCaseId: plannerId, action: 'exclude', reason: 'keep identity' }],
    },
  });
  const excluded = excludedRun.uniqueCases.find((c) => c.excluded === true);
  assert.ok(excluded);
  assert.equal(excluded?.exclusionReason, 'keep identity');
  assert.match(excluded!.testCaseId, /^TC-[0-9a-f]{12}$/);
  assert.ok(excludedRun.persistedIdentities?.some((p) => p.testCaseId === excluded!.testCaseId));
  assert.ok(excludedRun.traces.every((t) => t.result !== 'PASS'));
});
