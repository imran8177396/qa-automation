import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WELL_KNOWN_PATHS,
  classifyWellKnownResponse,
  extractSameOriginSourceMaps,
  wellKnownFinding,
} from './well-known';

const LOGIN_HTML = '<html><head><title>Swag Labs</title></head><body><form>login</form></body></html>';

test('WELL_KNOWN_PATHS is a fixed GET list without traversal or injection payloads', () => {
  assert.ok(WELL_KNOWN_PATHS.includes('/.env'));
  assert.ok(WELL_KNOWN_PATHS.includes('/.git'));
  assert.ok(WELL_KNOWN_PATHS.includes('/backup'));
  assert.ok(WELL_KNOWN_PATHS.some((path) => path.endsWith('.map')));
  for (const path of WELL_KNOWN_PATHS) {
    assert.equal(path.startsWith('/'), true);
    assert.doesNotMatch(path, /\.\.\//);
    assert.doesNotMatch(path, /[;'"]/);
    assert.doesNotMatch(path, /union\s+select/i);
  }
});

test('classifyWellKnownResponse() treats SPA login HTML as not exposed', () => {
  const row = classifyWellKnownResponse({
    path: '/.env',
    status: 200,
    contentType: 'text/html',
    body: LOGIN_HTML,
    homepageBody: LOGIN_HTML,
  });
  assert.equal(row.class, 'not-exposed');
});

test('classifyWellKnownResponse() flags a real dotenv body and wellKnownFinding redacts it', () => {
  const body = 'AWS_SECRET=super-secret-value\nDB_PASSWORD=also-secret\n';
  const row = classifyWellKnownResponse({
    path: '/.env',
    status: 200,
    contentType: 'text/plain',
    body,
  });
  assert.equal(row.class, 'exposed');
  const finding = wellKnownFinding({
    origin: 'https://example.com',
    path: '/.env',
    status: 200,
    contentType: 'text/plain',
    body,
  });
  assert.equal(finding.status, 'FAIL');
  assert.doesNotMatch(finding.detail, /super-secret-value/);
  assert.doesNotMatch(finding.actual ?? '', /also-secret/);
  assert.match(finding.actual ?? '', /REDACTED/);
});

test('classifyWellKnownResponse() treats 404 and 403 as not exposed', () => {
  assert.equal(
    classifyWellKnownResponse({ path: '/.git', status: 404, contentType: 'text/plain', body: 'nope' }).class,
    'not-exposed'
  );
  assert.equal(
    classifyWellKnownResponse({ path: '/.git', status: 403, contentType: 'text/plain', body: 'deny' }).class,
    'not-exposed'
  );
});

test('extractSameOriginSourceMaps() keeps same-origin .map refs only', () => {
  const html = `
    //# sourceMappingURL=/static/js/main.js.map
    //# sourceMappingURL=https://cdn.example/app.js.map
  `;
  const urls = extractSameOriginSourceMaps('https://www.saucedemo.com/', html);
  assert.deepEqual(urls, ['https://www.saucedemo.com/static/js/main.js.map']);
});
