import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectApiHygieneFindings, documentedApiGetUrl } from './api-hygiene';

test('documentedApiGetUrl() joins the configured API and documented GET path', () => {
  assert.equal(
    documentedApiGetUrl('https://jsonplaceholder.typicode.com', '/posts'),
    'https://jsonplaceholder.typicode.com/posts'
  );
  assert.equal(documentedApiGetUrl(undefined, '/posts'), null);
});

test('collectApiHygieneFindings() is NOT_TESTED without a documented API', () => {
  const rows = collectApiHygieneFindings({ apiUrl: null });
  assert.equal(rows[0].status, 'NOT_TESTED');
  assert.match(rows[0].detail, /not invented/i);
});

test('collectApiHygieneFindings() uses WARNING for third-party missing headers', () => {
  const rows = collectApiHygieneFindings({
    apiUrl: 'https://jsonplaceholder.typicode.com/posts',
    probe: {
      ok: true,
      status: 200,
      headers: {},
      setCookies: [],
      body: '[]',
      finalUrl: 'https://jsonplaceholder.typicode.com/posts',
    },
  });
  assert.ok(rows.some((row) => row.rule === 'https-scheme' && row.status === 'PASS'));
  assert.ok(rows.some((row) => row.rule === 'x-content-type-options' && row.status === 'WARNING'));
  assert.ok(rows.some((row) => row.rule === 'rate-limit-headers' && row.status === 'NOTE'));
});
