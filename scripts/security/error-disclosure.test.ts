import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectErrorDisclosureFindings } from './error-disclosure';

test('collectErrorDisclosureFindings() is NOT_TESTED when no error responses exist', () => {
  const rows = collectErrorDisclosureFindings({
    pages: [{ url: 'https://www.saucedemo.com/', status: 200, title: 'Swag Labs', consoleErrors: [] }],
  });
  assert.equal(rows[0].status, 'NOT_TESTED');
  assert.match(rows[0].detail, /were not forced/i);
});

test('collectErrorDisclosureFindings() FAILs a 500 with stack indicators and redacts them', () => {
  const rows = collectErrorDisclosureFindings({
    pages: [
      {
        url: 'https://example.com/boom',
        status: 500,
        title: 'Traceback (most recent call last)',
        error: 'secret-token-should-not-appear',
        consoleErrors: [],
      },
    ],
  });
  assert.equal(rows[0].status, 'FAIL');
  assert.match(rows[0].actual ?? '', /REDACTED/);
  assert.doesNotMatch(rows[0].actual ?? '', /secret-token-should-not-appear/);
});

test('collectErrorDisclosureFindings() PASSes a 404 without stack indicators', () => {
  const rows = collectErrorDisclosureFindings({
    pages: [{ url: 'https://example.com/missing', status: 404, title: 'Not Found', consoleErrors: [] }],
  });
  assert.equal(rows[0].status, 'PASS');
});
