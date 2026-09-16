import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectClickjackingFinding,
  collectRateLimitFinding,
  collectSecurityHeaderFindings,
} from './headers';

test('collectSecurityHeaderFindings() FAILs missing headers on a live HTTPS origin', () => {
  const rows = collectSecurityHeaderFindings({
    url: 'https://www.saucedemo.com/',
    headers: {},
    isLoopback: false,
    isHttps: true,
  });
  assert.ok(rows.some((row) => row.rule === 'content-security-policy' && row.status === 'FAIL'));
  assert.ok(rows.some((row) => row.rule === 'strict-transport-security' && row.status === 'FAIL'));
  assert.ok(rows.some((row) => row.rule === 'x-content-type-options' && row.status === 'FAIL'));
  assert.ok(rows.some((row) => row.rule === 'referrer-policy' && row.status === 'FAIL'));
  assert.ok(rows.some((row) => row.rule === 'permissions-policy' && row.status === 'FAIL'));
  assert.ok(rows.some((row) => row.rule === 'clickjacking' && row.status === 'FAIL'));
});

test('collectSecurityHeaderFindings() records NOTE on loopback instead of FAIL', () => {
  const rows = collectSecurityHeaderFindings({
    url: 'http://127.0.0.1:4173/',
    headers: {},
    isLoopback: true,
    isHttps: false,
  });
  assert.ok(rows.some((row) => row.rule === 'x-content-type-options' && row.status === 'NOTE'));
  assert.equal(rows.find((row) => row.rule === 'strict-transport-security')?.status, 'NOT_APPLICABLE');
});

test('collectSecurityHeaderFindings() PASSes when headers are present', () => {
  const rows = collectSecurityHeaderFindings({
    url: 'https://example.com/',
    headers: {
      'content-security-policy': "default-src 'self'",
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'geolocation=()',
      'x-frame-options': 'DENY',
    },
    isLoopback: false,
    isHttps: true,
  });
  assert.ok(rows.every((row) => row.status === 'PASS'));
});

test('collectSecurityHeaderFindings() treats third-party missing headers as WARNING', () => {
  const rows = collectSecurityHeaderFindings({
    url: 'https://jsonplaceholder.typicode.com/posts',
    headers: {},
    isLoopback: false,
    isHttps: true,
    thirdParty: true,
  });
  assert.ok(rows.some((row) => row.rule === 'content-security-policy' && row.status === 'WARNING'));
});

test('collectClickjackingFinding() accepts CSP frame-ancestors', () => {
  const row = collectClickjackingFinding({
    url: 'https://example.com/',
    headers: { 'content-security-policy': "frame-ancestors 'none'" },
    isLoopback: false,
  });
  assert.equal(row.status, 'PASS');
});

test('collectRateLimitFinding() is NOTE when headers are absent — never a flood', () => {
  const row = collectRateLimitFinding({ url: 'https://example.com/', headers: {} });
  assert.equal(row.status, 'NOTE');
  assert.match(row.detail, /not a flood/i);
});

test('collectRateLimitFinding() PASSes when a RateLimit header is present', () => {
  const row = collectRateLimitFinding({
    url: 'https://example.com/',
    headers: { 'x-ratelimit-limit': '60' },
  });
  assert.equal(row.status, 'PASS');
});
