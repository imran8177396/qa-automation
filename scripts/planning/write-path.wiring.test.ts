import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths';

/**
 * Discover (qa:all) and qa:test must share the same write entry for planned checks.
 * Does not execute discovery or Playwright — static import wiring only.
 */
test('discover.ts and run-qa-test.ts both import writePlannedUiChecks', () => {
  const discoverSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'discover.ts'), 'utf8');
  const qaTestSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'run-qa-test.ts'), 'utf8');
  assert.match(discoverSrc, /import\s*\{\s*writePlannedUiChecks\s*\}\s*from\s*['"]\.\/planning\/write-planned-checks['"]/);
  assert.match(qaTestSrc, /import\s*\{\s*writePlannedUiChecks\s*\}\s*from\s*['"]\.\/planning\/write-planned-checks['"]/);
  assert.match(discoverSrc, /writePlannedUiChecks\s*\(/);
  assert.match(qaTestSrc, /writePlannedUiChecks\s*\(/);
});

test('write-planned-checks routes through generateUiChecks / generateFromInventory (single planning entry)', () => {
  const writeSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'write-planned-checks.ts'), 'utf8');
  const generateSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'generate-ui-checks.ts'), 'utf8');
  assert.match(writeSrc, /from\s*['"]\.\/generate-ui-checks['"]/);
  assert.match(writeSrc, /generateUiChecks|generateFromInventory/);
  assert.match(generateSrc, /buildScenarioInventory\s*\(/);
  assert.doesNotMatch(writeSrc, /from\s*['"]\.\/scenario-inventory['"]/);
  const importLines = writeSrc
    .split(/\r?\n/)
    .filter((line) => /^\s*import\b/.test(line))
    .join('\n');
  assert.doesNotMatch(importLines, /discovery\/crawler|@playwright\/test|run-discover/);
});
