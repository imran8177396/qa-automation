import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REDACTED, collectSensitiveFindings, detectSensitivePatterns } from './sensitive';

test('detectSensitivePatterns() finds a private key and a demo password dump', () => {
  const html = `
    <p>Password for all users: secret_sauce</p>
    <pre>-----BEGIN RSA PRIVATE KEY-----
    MIIEowIBAAKCAQEA
    </pre>
  `;
  const hits = detectSensitivePatterns(html);
  assert.ok(hits.includes('private-key'));
  assert.ok(hits.includes('demo-password-dump'));
});

test('collectSensitiveFindings() FAILs without copying secret values', () => {
  const rows = collectSensitiveFindings({
    url: 'https://www.saucedemo.com/',
    html: 'password="hunter2-should-not-leak" extra',
  });
  assert.equal(rows[0].status, 'FAIL');
  assert.match(rows[0].actual ?? '', new RegExp(REDACTED));
  assert.doesNotMatch(JSON.stringify(rows), /hunter2-should-not-leak/);
});

test('collectSensitiveFindings() PASSes clean HTML', () => {
  const rows = collectSensitiveFindings({
    url: 'https://example.com/',
    html: '<html><body><h1>Welcome</h1></body></html>',
  });
  assert.equal(rows[0].status, 'PASS');
});

test('collectSensitiveFindings() uses discovery headings when GET HTML is a JS shell', () => {
  const rows = collectSensitiveFindings({
    url: 'https://www.saucedemo.com/',
    html: '<div id="root"></div>',
    extraText: 'Accepted usernames are:\nPassword for all users:',
  });
  assert.equal(rows[0].status, 'FAIL');
  assert.match(rows[0].actual ?? '', /demo-password-dump/);
  assert.doesNotMatch(JSON.stringify(rows), /secret_sauce/);
});
