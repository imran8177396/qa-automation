import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectInputValidationFindings, fieldsFromHtml } from './input-validation';
import type { UiInventory } from '../discovery/ui-scan';

test('fieldsFromHtml() reads type and required without submitting', () => {
  const fields = fieldsFromHtml(
    'https://www.saucedemo.com/',
    '<form><input name="user" type="text" required><input id="pass" type="password"></form>'
  );
  assert.equal(fields.length, 2);
  assert.equal(fields[0].required, true);
  assert.equal(fields[1].inputType, 'password');
});

test('collectInputValidationFindings() PASSes observed login fields', () => {
  const rows = collectInputValidationFindings({
    url: 'https://www.saucedemo.com/',
    html: '<input data-test="username" type="text"><input data-test="password" type="password">',
  });
  assert.ok(rows.every((row) => row.status === 'PASS'));
  assert.ok(rows.every((row) => /not submitted/i.test(row.detail)));
});

test('collectInputValidationFindings() FAILs a password-named field that is not type=password', () => {
  const rows = collectInputValidationFindings({
    url: 'https://example.com/login',
    html: '<input name="password" type="text">',
  });
  assert.equal(rows[0].status, 'FAIL');
});

test('collectInputValidationFindings() uses inventory fields when present', () => {
  const inventory: UiInventory = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    seedUrl: 'https://www.saucedemo.com/',
    pagesScanned: 1,
    elements: [
      {
        page: 'https://www.saucedemo.com/',
        elementId: 'username',
        elementType: 'input',
        locator: '[data-test="username"]',
        locatorCandidates: [],
        accessibleName: 'Username',
        visible: true,
        enabled: true,
        required: false,
        interactive: true,
        potentialAction: 'type',
        applicableTestTypes: [],
        discoveryStatus: 'DISCOVERED',
        evidence: 'input',
        inputType: 'text',
      },
    ],
    categoryStatus: [],
  };
  const rows = collectInputValidationFindings({
    url: 'https://www.saucedemo.com/',
    inventory,
    html: '<input name="ignored">',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'PASS');
  assert.match(rows[0].actual ?? '', /type=text/);
});
