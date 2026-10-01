import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('enterprise-model surfaces orchestrator integrity, API REQUIRES_CONFIGURATION, and JMeter targetSource', () => {
  const source = fs.readFileSync(path.join('scripts', 'lib', 'qa-report', 'enterprise-model.ts'), 'utf8');
  assert.match(source, /readReconciledOrchestratorSummary/);
  assert.match(source, /orchestratorIntegrityNote/);
  assert.match(source, /postmanSuiteSummary/);
  assert.match(source, /REQUIRES_CONFIGURATION/);
  assert.match(source, /targetSource/);
  assert.match(source, /Liveness against the website under test, no API URL configured; status RECORDED, not PASS/);
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
    assert.match(source, /ENGINE_RESULT_COLUMN_LABELS/);
    assert.match(source, /engine-results/);
  }
});
