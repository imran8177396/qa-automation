import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectCookieFindings, parseSetCookie } from './cookies';

test('parseSetCookie() reads flags and never keeps the value', () => {
  const cookie = parseSetCookie('session=super-secret; Secure; HttpOnly; SameSite=Lax');
  assert.deepEqual(cookie, { name: 'session', secure: true, httpOnly: true, sameSite: 'Lax' });
  assert.ok(cookie && !('value' in cookie));
});

test('collectCookieFindings() is NOT_TESTED when no cookies were observed', () => {
  const rows = collectCookieFindings({
    url: 'https://www.saucedemo.com/',
    setCookies: [],
    isLoopback: false,
    isHttps: true,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'NOT_TESTED');
});

test('collectCookieFindings() FAILs missing flags on a live HTTPS cookie', () => {
  const rows = collectCookieFindings({
    url: 'https://www.saucedemo.com/',
    setCookies: ['session=abc'],
    isLoopback: false,
    isHttps: true,
  });
  assert.equal(rows[0].status, 'FAIL');
  assert.match(rows[0].actual ?? '', /\[REDACTED\]/);
  assert.doesNotMatch(rows[0].actual ?? '', /abc/);
});

test('collectCookieFindings() PASSes a fully flagged cookie', () => {
  const rows = collectCookieFindings({
    url: 'https://example.com/',
    setCookies: ['sid=x; Secure; HttpOnly; SameSite=Strict'],
    isLoopback: false,
    isHttps: true,
  });
  assert.equal(rows[0].status, 'PASS');
});
