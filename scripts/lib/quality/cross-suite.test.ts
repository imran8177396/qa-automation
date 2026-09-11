import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PATHS } from '../paths';
import {
  buildCrossSuiteReport,
  detectCrossSuiteContradictions,
  pathnameKey,
  type CrossSuiteInputs,
} from './cross-suite';

function loadFixture(name: string): CrossSuiteInputs {
  const filePath = path.join(PATHS.root, 'scripts', 'lib', 'quality', 'fixtures', name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CrossSuiteInputs;
}

test('pathnameKey() maps absolute /solutions and hash routes to the same key', () => {
  assert.equal(pathnameKey('https://example.com/solutions'), '/solutions');
  assert.equal(pathnameKey('https://example.com/#solutions'), '/solutions');
  assert.equal(pathnameKey('/solutions'), '/solutions');
});

test('documented API 404 PASS vs discovery 404 is not CROSS_SUITE_CONTRADICTION', () => {
  const fixture = loadFixture('solutions-contradiction.json');
  const findings = detectCrossSuiteContradictions(fixture);
  const solutions = findings.find((row) => row.url === '/solutions');
  assert.equal(solutions, undefined);
});

test('buildCrossSuiteReport() does not list documented /solutions 404 as a contradiction', () => {
  const report = buildCrossSuiteReport(loadFixture('solutions-contradiction.json'), '2026-09-09T00:00:00.000Z');
  assert.equal(report.findings.some((row) => row.url === '/solutions' && row.type === 'CROSS_SUITE_CONTRADICTION'), false);
  assert.equal(report.generatedAt, '2026-09-09T00:00:00.000Z');
});

test('UI hash #solutions FAIL vs documented API /solutions 404 is not a new equivalence', () => {
  const findings = detectCrossSuiteContradictions({
    discovery: { pages: [] },
    api: {
      requests: [
        {
          endpoint: 'https://example.com/solutions',
          path: '/solutions',
          statusCode: 404,
          result: 'PASS',
          expectedStatus: 404,
        },
      ],
    },
    ui: {
      executions: [{ scenario: 'https://example.com/#solutions should load', status: 'FAIL' }],
    },
  });
  assert.equal(
    findings.some((row) => row.url === '/solutions'),
    false,
    'hash and path already share a key; documented 404 PASS is not a healthy-page signal'
  );
});

test('detects CROSS_SUITE_CONTRADICTION when API expected 200 PASS vs discovery/UI broken', () => {
  const fixture = loadFixture('api-healthy-vs-broken.json');
  const findings = detectCrossSuiteContradictions(fixture);
  const home = findings.find((row) => row.url === '/');

  assert.ok(home, 'expected a / contradiction for API 200 vs discovery/UI broken');
  assert.equal(home.type, 'CROSS_SUITE_CONTRADICTION');
  assert.equal(home.severity, 'High');
  assert.ok(home.healthySuites.includes('api'), `healthy suites: ${home.healthySuites.join(',')}`);
  assert.ok(home.brokenSuites.includes('discovery'), `broken suites: ${home.brokenSuites.join(',')}`);
  assert.ok(home.brokenSuites.includes('ui'), `broken suites: ${home.brokenSuites.join(',')}`);
});
