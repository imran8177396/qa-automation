import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths';
import { assignTestPriority, type PriorityDecision } from './test-priority';

function assertNoQualityScore(decision: PriorityDecision): void {
  assert.equal(
    Object.prototype.hasOwnProperty.call(decision, 'qualityScore'),
    false,
    'PriorityDecision must not expose qualityScore'
  );
  assert.equal(
    (decision as { qualityScore?: unknown }).qualityScore,
    undefined
  );
}

test('login scenarioKind → critical auth; no qualityScore', () => {
  const decision = assignTestPriority({ scenarioKind: 'login' });
  assert.equal(decision.priority, 'critical');
  assert.equal(decision.ruleId, 'auth');
  assert.equal(decision.reason, 'authentication case');
  assertNoQualityScore(decision);
});

test('login case id in title → critical auth', () => {
  const decision = assignTestPriority({
    title: 'Auth screen — login-wrong-password',
    scenarioKind: 'negative',
  });
  assert.equal(decision.priority, 'critical');
  assert.equal(decision.ruleId, 'auth');
});

test('delete-button → critical data-deletion', () => {
  const decision = assignTestPriority({ elementType: 'delete-button' });
  assert.equal(decision.priority, 'critical');
  assert.equal(decision.ruleId, 'data-deletion');
  assert.equal(decision.reason, 'data deletion control');
  assertNoQualityScore(decision);
});

test('search-field → medium search', () => {
  const decision = assignTestPriority({ elementType: 'search-field' });
  assert.equal(decision.priority, 'medium');
  assert.equal(decision.ruleId, 'search');
  assert.equal(decision.reason, 'search');
});

test('visual → low minor-ui', () => {
  const decision = assignTestPriority({ scenarioKind: 'visual' });
  assert.equal(decision.priority, 'low');
  assert.equal(decision.ruleId, 'minor-ui');
  assert.equal(decision.reason, 'non-functional presentation or assistive check');
});

test('plain text negative with no other signal → unspecified', () => {
  const decision = assignTestPriority({
    category: 'negative',
    scenarioKind: 'negative',
    title: 'Enter invalid email',
    scenario: 'invalid-format',
    elementType: 'email-input',
  });
  assert.equal(decision.priority, 'unspecified');
  assert.equal(decision.ruleId, 'none');
  assert.equal(decision.reason, 'no priority rule matched');
  assertNoQualityScore(decision);
});

test('existingPriority high wins over delete-button (explicit source priority wins)', () => {
  // Author-set priority is kept even when signals would otherwise raise the band.
  const decision = assignTestPriority({
    existingPriority: 'high',
    elementType: 'delete-button',
    scenario: 'delete account',
  });
  assert.equal(decision.priority, 'high');
  assert.equal(decision.ruleId, 'source-priority');
  assert.equal(decision.reason, 'priority was already set on the test case');
  assertNoQualityScore(decision);
});

test('url /billing → critical payments (word match, not a product module)', () => {
  const decision = assignTestPriority({
    url: 'https://app.example/billing',
    category: 'positive',
  });
  assert.equal(decision.priority, 'critical');
  assert.equal(decision.ruleId, 'payments');
  assert.equal(decision.reason, 'payment-related label or path');
});

test('workflow-happy under workflow → critical core-workflow; visual alone is not', () => {
  // Avoid payment word tokens (checkout/pay/billing) so this asserts core-workflow only.
  const happy = assignTestPriority({
    scenarioKind: 'workflow',
    title: 'Multi-step nav — workflow-happy',
    scenario: 'workflow-happy',
  });
  assert.equal(happy.priority, 'critical');
  assert.equal(happy.ruleId, 'core-workflow');

  const visualRow = assignTestPriority({
    scenarioKind: 'visual',
    title: 'Screen visual baseline',
  });
  assert.equal(visualRow.priority, 'low');
  assert.equal(visualRow.ruleId, 'minor-ui');
});

test('role and security-context authorization/session → critical authorization', () => {
  assert.equal(assignTestPriority({ scenarioKind: 'role' }).ruleId, 'authorization');
  assert.equal(
    assignTestPriority({
      scenarioKind: 'security-context',
      title: 'Page — sec-authorization-bypass',
    }).ruleId,
    'authorization'
  );
  assert.equal(
    assignTestPriority({
      scenarioKind: 'security-context',
      scenario: 'sec-session',
    }).ruleId,
    'authorization'
  );
});

test('module has no quality score, demo hosts, or product-type switch', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'test-priority.ts'), 'utf8');
  assert.doesNotMatch(src, /qualityScore/);
  assert.doesNotMatch(src, /saucedemo|swag.?labs|the-internet\.herokuapp/i);
  assert.doesNotMatch(src, /\bCRM\b|productType|checkoutModule/i);
});
