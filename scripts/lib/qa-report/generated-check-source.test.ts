import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { generatedCheckResultsPath } from '../playwright-suites';
import { PATHS } from '../paths';
import { loadPlaywrightJsonReport } from '../playwright-results';

test('section 2.6 source is generated-check only — shared results.json is a different path', () => {
  const shared = path.join(PATHS.reports.playwright, 'results.json');
  assert.notEqual(path.resolve(generatedCheckResultsPath), path.resolve(shared));
  assert.match(generatedCheckResultsPath.replace(/\\/g, '/'), /reports\/playwright\/generated-check\/results\.json$/);
});

test('missing generated-check file does not load the shared Playwright JSON', () => {
  if (fs.existsSync(generatedCheckResultsPath)) {
    assert.ok(loadPlaywrightJsonReport(generatedCheckResultsPath));
    return;
  }
  assert.equal(loadPlaywrightJsonReport(generatedCheckResultsPath), null);
  const shared = path.join(PATHS.reports.playwright, 'results.json');
  if (fs.existsSync(shared)) {
    assert.notEqual(path.resolve(generatedCheckResultsPath), path.resolve(shared));
  }
});
