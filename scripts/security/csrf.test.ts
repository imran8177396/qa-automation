import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectCsrfFindings, htmlHasCsrfIndicator, htmlHasForm } from './csrf';

test('htmlHasForm() and htmlHasCsrfIndicator() detect markup only', () => {
  assert.equal(htmlHasForm('<div>no form</div>'), false);
  assert.equal(htmlHasForm('<form action="/login">'), true);
  assert.equal(htmlHasCsrfIndicator('<input name="csrfmiddlewaretoken" />'), true);
  assert.equal(htmlHasCsrfIndicator('<meta name="csrf-token" content="x">'), true);
  assert.equal(htmlHasCsrfIndicator('<input name="username">'), false);
});

test('collectCsrfFindings() is NOT_TESTED without a form', () => {
  const row = collectCsrfFindings({ url: 'https://example.com/', html: '<p>Hello</p>' });
  assert.equal(row.status, 'NOT_TESTED');
});

test('collectCsrfFindings() PASSes a token pattern and WARNs when absent', () => {
  const pass = collectCsrfFindings({
    url: 'https://example.com/login',
    html: '<form><input name="_token"></form>',
  });
  assert.equal(pass.status, 'PASS');
  const warn = collectCsrfFindings({
    url: 'https://www.saucedemo.com/',
    html: '<form><input name="username"><input name="password"></form>',
  });
  assert.equal(warn.status, 'WARNING');
  assert.match(warn.detail, /not a CSRF exploit/i);
});

test('collectCsrfFindings() uses inventoried form evidence when HTML is a JS shell', () => {
  const row = collectCsrfFindings({
    url: 'https://www.saucedemo.com/',
    html: '<div id="root"></div>',
    formObserved: true,
  });
  assert.equal(row.status, 'WARNING');
  assert.match(row.detail, /Form observed without CSRF token/i);
});
