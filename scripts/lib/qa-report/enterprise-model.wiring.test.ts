import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('enterprise-model no longer falls back to shared Playwright JSON or overwrite disclaimer', () => {
  const source = fs.readFileSync(path.join('scripts', 'lib', 'qa-report', 'enterprise-model.ts'), 'utf8');
  assert.doesNotMatch(source, /Later Playwright suites[\s\S]*overwrite reports\/playwright\/results\.json/);
  assert.doesNotMatch(source, /sharedPlaywrightJson/);
  assert.match(source, /generatedCheckResultsPath/);
  assert.match(source, /A shared reports\/playwright\/results\.json path is not read/);
  assert.match(source, /resolveSuiteStatus/);
  assert.match(source, /loadLighthouseSection/);
  assert.match(source, /coverageFormula/);
  assert.match(source, /loadFailureAnalysisSection/);
  assert.match(source, /loadRetestSection/);
  assert.match(source, /readTautologicalArtifact/);
  assert.match(source, /cross-suite\.json/);
});

test('HTML and DOCX consume 2.16 / 2.17 schema columns and do not invent confidence', () => {
  const html = fs.readFileSync(path.join('scripts', 'lib', 'qa-report', 'enterprise-html.ts'), 'utf8');
  const docx = fs.readFileSync(path.join('scripts', 'lib', 'qa-report', 'enterprise-docx.ts'), 'utf8');
  for (const source of [html, docx]) {
    assert.match(source, /Test ID/);
    assert.match(source, /Evidence excerpt/);
    assert.match(source, /Rule fired/);
    assert.match(source, /Stability verdict/);
    assert.match(source, /Classifications are evidence-based and are not defect tickets/);
    assert.doesNotMatch(source, /row\.confidence/);
    assert.doesNotMatch(source, /row\.recommendation/);
    assert.doesNotMatch(source, /\['ID', 'Classification', 'Confidence'/);
  }
});
