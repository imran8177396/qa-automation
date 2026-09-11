import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicableScenarios, inferFieldHint, kindForElement } from './scenarios';

test('applicableScenarios() does not assign the same matrix to every kind', () => {
  const page = applicableScenarios({ kind: 'page', pageStatus: 200 }).map((s) => s.id);
  const field = applicableScenarios({ kind: 'field', elementType: 'input', inputHint: 'text', required: true }).map(
    (s) => s.id
  );
  const button = applicableScenarios({ kind: 'button', isSubmit: false }).map((s) => s.id);
  assert.ok(page.includes('page-load'));
  assert.ok(!page.includes('valid-input'));
  assert.ok(field.includes('required-validation'));
  assert.ok(!button.includes('required-validation'));
});

test('required email field gets format-invalid and empty checks, not an invented boundary matrix', () => {
  const ids = applicableScenarios({
    kind: 'field',
    elementType: 'input',
    required: true,
    inputHint: 'email',
  }).map((s) => s.id);
  assert.ok(ids.includes('valid-input'));
  assert.ok(ids.includes('invalid-input'));
  assert.ok(ids.includes('empty-input'));
  assert.ok(ids.includes('required-validation'));
  assert.ok(!ids.includes('boundary-values'));
  assert.ok(!ids.includes('form-submit'));
});

test('optional free-text input does not get empty/required/invalid scenarios', () => {
  const ids = applicableScenarios({
    kind: 'field',
    elementType: 'input',
    required: false,
    inputHint: 'text',
  }).map((s) => s.id);
  assert.ok(ids.includes('valid-input'));
  assert.ok(!ids.includes('invalid-input'));
  assert.ok(!ids.includes('empty-input'));
  assert.ok(!ids.includes('required-validation'));
});

test('submit button is not given an executable click or submit scenario', () => {
  const scenarios = applicableScenarios({ kind: 'button', isSubmit: true });
  assert.ok(scenarios.some((s) => s.id === 'visibility' && s.disposition === 'executable'));
  assert.ok(scenarios.some((s) => s.id === 'form-submit' && s.disposition === 'blocked-safety'));
  assert.ok(!scenarios.some((s) => s.id === 'click-behavior'));
});

test('non-submit button can be clicked; loading/success/error are not invented', () => {
  const ids = applicableScenarios({ kind: 'button', isSubmit: false }).map((s) => s.id);
  assert.ok(ids.includes('click-behavior'));
  assert.ok(!ids.includes('form-submit'));
  assert.deepEqual(
    ids.filter((id) => id === 'page-load' || id === 'invalid-input'),
    []
  );
});

test('404 pages get broken-link, not a positive page-load', () => {
  const ids = applicableScenarios({ kind: 'page', pageStatus: 404 }).map((s) => s.id);
  assert.deepEqual(ids, ['broken-link']);
});

test('inferFieldHint() uses evidence instead of guessing', () => {
  assert.equal(inferFieldHint({ locator: '#email', evidence: 'text-like input' }), 'email');
  assert.equal(inferFieldHint({ evidence: 'text-like input (type=password)' }), 'password');
  assert.equal(inferFieldHint({ elementType: 'textarea' }), 'text');
});

test('configured UI+API correlation is executable and is not form-submit or api-smoke', () => {
  const scenarios = applicableScenarios({ kind: 'workflow', workflowKind: 'ui-api' });
  assert.equal(scenarios[0]?.id, 'ui-api-correlation');
  assert.equal(scenarios[0]?.disposition, 'executable');
  assert.ok(!scenarios.some((row) => row.id === 'form-submit' || row.id === 'api-smoke'));
});

test('API auth stays REQUIRES_CONFIGURATION when no contract is documented', () => {
  const scenarios = applicableScenarios({ kind: 'api', workflowKind: 'auth' });
  assert.equal(scenarios[0]?.id, 'api-auth');
  assert.equal(scenarios[0]?.disposition, 'requires-configuration');
});

test('viewport matrix is executable as Chromium emulation, not real devices', () => {
  const scenarios = applicableScenarios({ kind: 'viewport' });
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0]?.id, 'viewport-matrix');
  assert.equal(scenarios[0]?.disposition, 'executable');
  assert.match(scenarios[0]?.reason ?? '', /not real-device|not Mobile Safari/i);
});

test('accessibility scan is executable as automated checks, not a full WCAG audit', () => {
  const scenarios = applicableScenarios({ kind: 'accessibility' });
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0]?.id, 'accessibility-scan');
  assert.equal(scenarios[0]?.disposition, 'executable');
  assert.match(scenarios[0]?.reason ?? '', /not a complete manual WCAG audit/i);
});

test('security baseline is executable as QA-level checks, not a pentest', () => {
  const scenarios = applicableScenarios({ kind: 'security' });
  assert.equal(scenarios[0]?.id, 'security-baseline');
});

test('seo baseline is executable as technical checks, not a ranking audit', () => {
  const scenarios = applicableScenarios({ kind: 'seo' });
  assert.equal(scenarios[0]?.id, 'seo-baseline');
  assert.equal(scenarios[0]?.disposition, 'executable');
  assert.match(scenarios[0]?.reason ?? '', /not a ranking audit/i);
});

test('content baseline is executable as structural checks, not fact-checking', () => {
  const scenarios = applicableScenarios({ kind: 'content' });
  assert.equal(scenarios[0]?.id, 'content-baseline');
  assert.equal(scenarios[0]?.disposition, 'executable');
  assert.match(scenarios[0]?.reason ?? '', /not factual verification/i);
});

test('performance liveness is executable; heavy profiles require authorization', () => {
  const liveness = applicableScenarios({ kind: 'performance', workflowKind: 'liveness' });
  const smokeAlias = applicableScenarios({ kind: 'performance', workflowKind: 'smoke' });
  const load = applicableScenarios({ kind: 'performance', workflowKind: 'heavy' });
  assert.equal(liveness[0]?.id, 'performance-profile');
  assert.equal(liveness[0]?.disposition, 'executable');
  assert.equal(smokeAlias[0]?.disposition, 'executable');
  assert.equal(load[0]?.id, 'performance-profile');
  assert.equal(load[0]?.disposition, 'requires-configuration');
});

test('visual regression is executable once the screenshot suite exists', () => {
  const scenarios = applicableScenarios({ kind: 'visual' });
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0]?.id, 'visual-regression');
  assert.equal(scenarios[0]?.disposition, 'executable');
});

test('kindForElement() maps discovery types without collapsing everything to interactive', () => {
  assert.equal(kindForElement('form'), 'form');
  assert.equal(kindForElement('input'), 'field');
  assert.equal(kindForElement('button'), 'button');
  assert.equal(kindForElement('header'), 'ui-component');
  assert.equal(kindForElement('pages'), null);
});
