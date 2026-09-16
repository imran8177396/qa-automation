import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferWorkflows } from './workflows';
import { applicableTestTypes } from './test-types';
import type { PageMap } from './page-map';
import type { UiElementRecord } from './ui-scan';
import type { ApiInventory } from './api-observe';

function emptyPageMap(overrides: Partial<PageMap> = {}): PageMap {
  return {
    generatedAt: new Date().toISOString(),
    seedUrl: 'https://example.com/',
    scopeHost: 'example.com',
    truncated: false,
    pages: [
      {
        url: 'https://example.com/',
        route: '/',
        title: 'Example Domain',
        status: 200,
        ok: true,
        depth: 0,
        h1s: ['Example Domain'],
        applicableTestTypes: applicableTestTypes('pages'),
      },
    ],
    routes: [{ path: '/', url: 'https://example.com/', title: 'Example Domain', source: 'crawl' }],
    navigation: [],
    skippedByScope: [],
    categoryStatus: [],
    ...overrides,
  };
}

function emptyApi(): ApiInventory {
  return {
    generatedAt: new Date().toISOString(),
    seedUrl: 'https://example.com/',
    pagesObserved: 1,
    calls: [],
    categoryStatus: [],
  };
}

test('inferWorkflows() does not invent authentication when there is no password field or auth route', () => {
  const inventory = inferWorkflows(emptyPageMap(), [], emptyApi());
  assert.equal(inventory.workflows.some((item) => item.kind === 'authentication'), false);
  const auth = inventory.categoryStatus.find((row) => row.category === 'authentication');
  assert.equal(auth?.status, 'NOT_DISCOVERED');
});

test('inferWorkflows() marks authentication as REQUIRES_CONFIGURATION when a password field is present', () => {
  const passwordField: UiElementRecord = {
    page: 'https://example.com/login',
    elementId: 'UI-0001',
    elementType: 'input',
    locator: '[name="password"]',
    locatorCandidates: ['[name="password"]'],
    accessibleName: 'Password',
    visible: true,
    enabled: true,
    required: true,
    interactive: true,
    potentialAction: 'fill',
    applicableTestTypes: ['form-presence'],
    discoveryStatus: 'DISCOVERED',
    evidence: 'text-like input (type=password)',
  };

  const inventory = inferWorkflows(emptyPageMap(), [passwordField], emptyApi());
  const auth = inventory.workflows.find((item) => item.kind === 'authentication');
  assert.ok(auth);
  assert.equal(auth!.status, 'REQUIRES_CONFIGURATION');
});

test('inferWorkflows() records form-submit as NOT_TESTED and never treats it as authorized', () => {
  const form: UiElementRecord = {
    page: 'https://example.com/contact',
    elementId: 'UI-0002',
    elementType: 'form',
    locator: null,
    locatorCandidates: [],
    accessibleName: null,
    visible: true,
    enabled: true,
    required: false,
    interactive: false,
    potentialAction: 'submit (NOT_TESTED — safety policy)',
    applicableTestTypes: ['form-presence'],
    discoveryStatus: 'DISCOVERED',
    evidence: '<form>',
  };

  const inventory = inferWorkflows(emptyPageMap(), [form], emptyApi());
  const submit = inventory.workflows.find((item) => item.kind === 'form-submit');
  assert.ok(submit);
  assert.equal(submit!.status, 'NOT_TESTED');
  assert.match(submit!.potentialAction, /NOT_TESTED|safety/i);
});

test('inferWorkflows() marks authentication DISCOVERED only after a successful discovery session', () => {
  const inventory = inferWorkflows(emptyPageMap(), [], emptyApi(), {
    attempted: true,
    succeeded: true,
    reason: 'Observed login form accepted the provided QA_USERNAME/QA_PASSWORD session',
    loginPageUrl: 'https://example.com/',
    afterUrl: 'https://example.com/inventory',
  });
  const auth = inventory.workflows.find((item) => item.kind === 'authentication');
  assert.ok(auth);
  assert.equal(auth!.status, 'DISCOVERED');
});

test('inferWorkflows() records gated inventory as REQUIRES_CONFIGURATION without inventing pages', () => {
  const gated = emptyPageMap({
    pages: [
      {
        url: 'https://example.com/inventory',
        route: '/inventory',
        title: 'Swag Labs',
        status: 200,
        ok: false,
        depth: 1,
        h1s: [],
        access: 'gated',
        gatedReason: 'Login wall observed',
        applicableTestTypes: applicableTestTypes('pages'),
      },
    ],
    auth: {
      attempted: false,
      succeeded: false,
      reason: 'Login form observed; QA_USERNAME/QA_PASSWORD are not set',
    },
  });
  const inventory = inferWorkflows(gated, [], emptyApi());
  const row = inventory.workflows.find((item) => item.kind === 'gated');
  assert.ok(row);
  assert.equal(row!.status, 'REQUIRES_CONFIGURATION');
  assert.match(row!.evidence, /inventory/);
});

test('applicableTestTypes() does not assign the same matrix to every category', () => {
  assert.deepEqual(applicableTestTypes('link'), ['broken-link', 'page-sanity']);
  assert.deepEqual(applicableTestTypes('image'), ['seo-alt', 'visibility']);
  assert.deepEqual(applicableTestTypes('authentication'), ['REQUIRES_CONFIGURATION']);
  assert.ok(applicableTestTypes('input', { required: true }).includes('form-boundary'));
  assert.ok(!applicableTestTypes('input', { required: false }).includes('form-boundary'));
});
