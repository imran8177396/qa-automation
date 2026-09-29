import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { A11Y_AUTOMATED_LIMIT } from '../core/safety-policy';
import type { GenerationInventory } from '../discovery/generation-contract';
import { ROOT } from '../lib/paths';
import {
  ANALYST_QUESTIONS,
  answerAnalystQuestions,
  type AnalystAnswer,
} from './analyst-questions';
import { runGenerationPipeline } from './generation-pipeline';

const EXPECTED_IDS = [
  'exists',
  'interact',
  'enter',
  'go-wrong',
  'valid-inputs',
  'invalid-inputs',
  'boundaries',
  'states',
  'workflows',
  'permissions',
  'security',
  'accessibility',
  'dependency-failure',
  'unexpected-behavior',
] as const;

function byId(answers: AnalystAnswer[]): Map<string, AnalystAnswer> {
  return new Map(answers.map((a) => [a.questionId, a]));
}

function emailRequiredInventory(): GenerationInventory {
  return {
    version: '1',
    screens: [
      {
        screenId: 'SCREEN-001',
        url: '/profile',
        title: 'Profile',
        elements: [
          {
            elementId: 'ELEMENT-001',
            type: 'email-input',
            category: 'input',
            label: 'Email',
            required: true,
            screenId: 'SCREEN-001',
          },
        ],
      },
    ],
  };
}

test('ANALYST_QUESTIONS has exactly 14 questions and excludes predefined-tests', () => {
  assert.equal(ANALYST_QUESTIONS.length, 14);
  assert.deepEqual(
    ANALYST_QUESTIONS.map((q) => q.id),
    [...EXPECTED_IDS]
  );
  const blob = JSON.stringify(ANALYST_QUESTIONS);
  assert.doesNotMatch(blob, /What predefined tests were configured/i);
  assert.doesNotMatch(blob, /predefined tests/i);
  assert.doesNotMatch(blob, /saucedemo|jsonplaceholder|\/users\/create/i);
});

test('empty inventory → exists NOT_TESTED; pipeline checks empty; no username invented; no PASS', () => {
  const inventory: GenerationInventory = { version: '1', screens: [] };
  const answers = answerAnalystQuestions(inventory);
  assert.equal(answers.length, 14);
  const map = byId(answers);
  assert.equal(map.get('exists')?.status, 'NOT_TESTED');
  assert.match(map.get('exists')?.summary ?? '', /no screens in the discovery inventory/);
  assert.equal(map.get('enter')?.status, 'NOT_TESTED');
  assert.equal(map.get('permissions')?.status, 'REQUIRES_CONFIGURATION');
  assert.equal(map.get('dependency-failure')?.status, 'NOT_TESTED');

  const result = runGenerationPipeline({ inventory });
  assert.equal(result.checks.length, 0);
  assert.equal(result.uniqueCases.length, 0);
  assert.ok(result.analystAnswers);
  assert.equal(result.analystAnswers.length, 14);
  assert.equal(result.analystAnswers.find((a) => a.questionId === 'exists')?.status, 'NOT_TESTED');
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /username/i);
  assert.doesNotMatch(serialized, /\/users\/create/);
  assert.ok(result.traces.every((t) => t.result !== 'PASS'));
  assert.ok(!result.checks.some((c) => c.status === 'PASS'));
});

test('email required + label Email → enter/invalid-inputs/accessibility ANSWERED; permissions REQUIRES_CONFIGURATION; dependency-failure NOT_TESTED', () => {
  const inventory = emailRequiredInventory();
  const answers = answerAnalystQuestions(inventory);
  assert.equal(answers.length, 14);
  const map = byId(answers);

  assert.equal(map.get('exists')?.status, 'ANSWERED');
  assert.equal(map.get('interact')?.status, 'ANSWERED');
  assert.equal(map.get('enter')?.status, 'ANSWERED');
  assert.equal(map.get('invalid-inputs')?.status, 'ANSWERED');
  assert.match(
    map.get('invalid-inputs')?.summary ?? '',
    /invalid cases are generated from field type and recorded constraints/
  );
  assert.equal(map.get('go-wrong')?.status, 'ANSWERED');
  assert.match(map.get('go-wrong')?.summary ?? '', /required fields were discovered/);
  assert.equal(map.get('valid-inputs')?.status, 'ANSWERED');
  assert.match(map.get('valid-inputs')?.summary ?? '', /1 enterable field/);

  assert.equal(map.get('accessibility')?.status, 'ANSWERED');
  const a11ySummary = map.get('accessibility')?.summary ?? '';
  assert.ok(
    /not full WCAG/i.test(a11ySummary) || a11ySummary.includes(A11Y_AUTOMATED_LIMIT),
    `accessibility summary must mention WCAG limit: ${a11ySummary}`
  );
  assert.doesNotMatch(a11ySummary, /\bcompliant\b/i);

  assert.equal(map.get('permissions')?.status, 'REQUIRES_CONFIGURATION');
  assert.match(map.get('permissions')?.summary ?? '', /permission rules were not configured/);
  assert.equal(map.get('dependency-failure')?.status, 'NOT_TESTED');
  assert.match(map.get('dependency-failure')?.summary ?? '', /dependency failure was not observed/);

  assert.equal(map.get('boundaries')?.status, 'NOT_TESTED');
  assert.equal(map.get('states')?.status, 'NOT_TESTED');
  assert.equal(map.get('workflows')?.status, 'NOT_TESTED');
  assert.equal(map.get('unexpected-behavior')?.status, 'ANSWERED');

  const result = runGenerationPipeline({ inventory });
  assert.ok(result.checks.length > 0);
  assert.equal(result.analystAnswers?.find((a) => a.questionId === 'enter')?.status, 'ANSWERED');
  assert.ok(result.traces.every((t) => t.result !== 'PASS'));
  assert.doesNotMatch(JSON.stringify(result), /\/users\/create/);
});

test('every question appears exactly once; unanswered do not invent PASS', () => {
  const answers = answerAnalystQuestions({ version: '1', screens: [] });
  const ids = answers.map((a) => a.questionId);
  assert.equal(ids.length, new Set(ids).size);
  assert.deepEqual(ids, [...EXPECTED_IDS]);
  assert.ok(answers.every((a) => a.status !== 'ANSWERED' || a.evidenceCount >= 0));
  assert.ok(
    answers
      .filter((a) => a.status === 'NOT_TESTED' || a.status === 'REQUIRES_CONFIGURATION')
      .every((a) => a.evidenceCount === 0)
  );
});

test('extras unlock workflows/states/permissions; dependencyFailureObserved answers dependency-failure', () => {
  const inventory = emailRequiredInventory();
  const answers = answerAnalystQuestions(inventory, {
    workflowCount: 2,
    navigationEdgeCount: 1,
    stateCount: 3,
    permissionRuleCount: 4,
    dependencyFailureObserved: true,
  });
  const map = byId(answers);
  assert.equal(map.get('workflows')?.status, 'ANSWERED');
  assert.equal(map.get('states')?.status, 'ANSWERED');
  assert.equal(map.get('permissions')?.status, 'ANSWERED');
  assert.equal(map.get('dependency-failure')?.status, 'ANSWERED');
});

test('no demo hosts or Create User defaults in analyst-questions source', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'analyst-questions.ts'), 'utf8');
  assert.doesNotMatch(src, /saucedemo|jsonplaceholder/i);
  assert.doesNotMatch(src, /\/users\/create/);
  assert.doesNotMatch(src, /What predefined tests were configured/);
});
