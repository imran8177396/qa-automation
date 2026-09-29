import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths';
import { deduplicateTestCases, type DedupableTestCase } from './test-case-uniqueness';
import { buildTestCaseQuality, isGenericTitle } from './test-case-quality';

function baseCase(overrides: Partial<DedupableTestCase> = {}): DedupableTestCase {
  return {
    id: 'SRC-KEEP',
    screenId: 'SCREEN-1',
    elementId: 'EL-EMAIL',
    elementType: 'email-input',
    category: 'negative',
    action: 'fill-no-submit',
    status: 'PLANNED',
    input: 'userexample.com',
    ...overrides,
  };
}

test('three equivalent invalid-email titles → one quality.what with invalid-format; how has no Submit or POST /users', () => {
  const cases: DedupableTestCase[] = [
    baseCase({ id: 'SRC-A', title: 'Enter invalid email' }),
    baseCase({ id: 'TC-002', title: 'Enter malformed email' }),
    baseCase({ id: 'SRC-C', title: 'Enter incorrect email format' }),
  ];
  const { kept, removed } = deduplicateTestCases(cases);
  assert.equal(kept.length, 1);
  assert.equal(removed, 2);
  const q = kept[0]!.quality;
  assert.match(q.what, /invalid-format/);
  assert.match(q.what, /EL-EMAIL|email-input/);
  assert.equal(/\bSubmit\b/.test(q.how), false);
  assert.equal(q.how.includes('POST /users'), false);
  assert.match(q.distinction, /userexample\.com/);
  assert.equal(q.generic, false);
});

test('title "Verify button works." → generic true; what/how are not that sentence', () => {
  const { kept } = deduplicateTestCases([
    baseCase({
      title: 'Verify button works.',
      category: 'positive',
      action: 'observe',
      input: null,
      elementId: 'EL-BTN',
      elementType: 'button',
    }),
  ]);
  const q = kept[0]!.quality;
  assert.equal(q.generic, true);
  assert.equal(isGenericTitle('Verify button works.'), true);
  assert.notEqual(q.what.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), 'verify button works');
  assert.notEqual(q.how.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), 'verify button works');
  assert.match(q.what, /positive check of/);
});

test('Create User + POST url + observe → how names method/URL, not list appearance', () => {
  const { kept } = deduplicateTestCases([
    baseCase({
      title: 'Observe create user control',
      category: 'positive',
      action: 'observe',
      input: null,
      elementId: 'EL-CREATE',
      controlLabel: 'Create User',
      method: 'POST',
      url: 'https://api.example.test/users',
      expect: { note: 'control observed; request not sent' },
    }),
  ]);
  const q = kept[0]!.quality;
  assert.match(q.how, /POST/);
  assert.match(q.how, /https:\/\/api\.example\.test\/users/);
  assert.match(q.how, /not sent by this plan/i);
  assert.equal(/appears in (the )?users? list/i.test(q.how), false);
  assert.equal(/appears in (the )?users? list/i.test(q.expectedResult), false);
  assert.equal(q.expectedResult, 'control observed; request not sent');
  assert.equal(/\bSubmit\b/.test(q.how), false);
  // Not an authorized click — must not use the full Click the Create User… sentence.
  assert.equal(/^Click the Create User/i.test(q.how), false);
});

test('source without method/url → how does not contain /users', () => {
  const { kept } = deduplicateTestCases([
    baseCase({
      title: 'Enter invalid email',
      controlLabel: 'Create User',
    }),
  ]);
  const q = kept[0]!.quality;
  assert.equal(q.how.includes('/users'), false);
  assert.equal(q.how.includes('POST'), false);
});

test('distinction mentions the input', () => {
  const { kept } = deduplicateTestCases([
    baseCase({ title: 'Enter invalid email', input: 'bad@@example.test' }),
  ]);
  assert.match(kept[0]!.quality.distinction, /bad@@example\.test/);
  assert.match(kept[0]!.quality.distinction, /Differs by scenario/);
});

test('null expectedResult fallback; never invents validation-error', () => {
  const quality = buildTestCaseQuality(
    {
      category: 'negative',
      screenId: 'SCREEN-1',
      elementId: 'EL-1',
      scenario: 'invalid-format',
      input: 'x',
      expectedResult: null,
      duplicateCount: 0,
      steps: ['Do not execute.'],
    },
    { title: 'Enter invalid email', action: 'none' }
  );
  assert.equal(quality.expectedResult, 'No expected result was recorded');
  assert.equal(quality.expectedResult.toLowerCase().includes('validation-error'), false);
});

test('quality modules have no demo product hosts besides example.test in fixtures', () => {
  const uniquenessSrc = fs.readFileSync(
    path.join(ROOT, 'scripts', 'planning', 'test-case-uniqueness.ts'),
    'utf8'
  );
  const qualitySrc = fs.readFileSync(
    path.join(ROOT, 'scripts', 'planning', 'test-case-quality.ts'),
    'utf8'
  );
  const qualityTestSrc = fs.readFileSync(
    path.join(ROOT, 'scripts', 'planning', 'test-case-quality.test.ts'),
    'utf8'
  );
  for (const src of [uniquenessSrc, qualitySrc]) {
    assert.doesNotMatch(src, /saucedemo\.com|the-internet\.herokuapp|demoqa\.com/i);
    assert.doesNotMatch(src, /Create User/);
    assert.doesNotMatch(src, /POST \/users/);
  }
  // Fixture URLs may use example.test only — not other demo product hosts.
  assert.match(qualityTestSrc, /example\.test/);
  assert.doesNotMatch(qualityTestSrc, /saucedemo\.com|the-internet\.herokuapp|demoqa\.com/i);
  const fixtureHosts = [...qualityTestSrc.matchAll(/https?:\/\/[^\s'"`]+/g)].map((m) => m[0]!);
  for (const host of fixtureHosts) {
    assert.match(host, /example\.test/);
  }
});
