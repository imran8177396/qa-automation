import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('run-seo writes results.json with the same unique findings as summary', () => {
  const source = fs.readFileSync(path.join('scripts', 'run-seo.ts'), 'utf8');
  assert.match(source, /writeJson\(path\.join\(PATHS\.reports\.seo, 'results\.json'\), summary\)/);
  assert.match(source, /writeJson\(path\.join\(PATHS\.reports\.seo, 'summary\.json'\), summary\)/);
  assert.match(source, /rawFindingCount/);
  assert.match(source, /uniqueFindingCount/);
  assert.match(source, /collectSeoFindings/);
  assert.match(source, /collectSeoSuiteFindings/);
  assert.match(source, /findings\.md/);
});

test('run-content writes findings.md and results.json', () => {
  const source = fs.readFileSync(path.join('scripts', 'run-content.ts'), 'utf8');
  assert.match(source, /writeJson\(path\.join\(PATHS\.reports\.content, 'results\.json'\), summary\)/);
  assert.match(source, /writeJson\(path\.join\(PATHS\.reports\.content, 'summary\.json'\), summary\)/);
  assert.match(source, /findings\.md/);
  assert.match(source, /collectContentSuiteFindings/);
});
