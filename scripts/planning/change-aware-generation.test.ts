/**
 * Change-aware generation selection tests — no git spawn, no PASS, no demo hosts.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parseChangedFilesFromDiff } from '../core/platform/risk';
import {
  selectCasesForChange,
  type ChangeAwareGenerationMapping,
} from './change-aware-generation';
import type { UniqueTestCase } from './test-case-uniqueness';

function stubCase(
  overrides: Pick<UniqueTestCase, 'testCaseId' | 'screenId'> &
    Partial<Pick<UniqueTestCase, 'elementId'>>
): UniqueTestCase {
  return {
    testCaseId: overrides.testCaseId,
    screenId: overrides.screenId,
    elementId: overrides.elementId ?? null,
    category: 'positive',
    scenario: 'happy-path',
    preconditions: [],
    steps: ['observe'],
    input: null,
    expectedResult: 'NOT_TESTED',
    priority: 'unspecified',
    risk: 'unspecified',
    duplicateCount: 0,
    quality: {
      what: 'stub',
      why: 'fixture',
      how: 'observe',
      expectedResult: 'NOT_TESTED',
      distinction: 'stub fixture',
      generic: false,
    },
  };
}

describe('selectCasesForChange', () => {
  const screen1 = stubCase({ testCaseId: 'TC-SCREEN1', screenId: 'SCREEN-1' });
  const screen2 = stubCase({ testCaseId: 'TC-SCREEN2', screenId: 'SCREEN-2' });
  const allCases = [screen1, screen2];

  it('no files → NOT_IMPLEMENTED, preserved equals all cases, regenerate empty', () => {
    const result = selectCasesForChange({
      changedFiles: [],
      mappings: [{ pathPrefix: 'src/login', screenIds: ['SCREEN-1'] }],
      cases: allCases,
    });
    assert.equal(result.status, 'NOT_IMPLEMENTED');
    assert.deepEqual(result.regenerate, []);
    assert.equal(result.preserved.length, allCases.length);
    assert.deepEqual(result.preserved, allCases);
    assert.match(result.reason, /no changed files were supplied/);
    assert.match(result.reason, /inventory was not regenerated/);
  });

  it('files with empty mappings → UNMAPPED, regenerate empty, preserved is all', () => {
    const result = selectCasesForChange({
      changedFiles: ['src/app.ts'],
      mappings: [],
      cases: allCases,
    });
    assert.equal(result.status, 'UNMAPPED');
    assert.deepEqual(result.regenerate, []);
    assert.deepEqual(result.preserved, allCases);
    assert.deepEqual(result.unmappedFiles, ['src/app.ts']);
    assert.match(result.reason, /full inventory was not regenerated/);
  });

  it('mapped prefix with screenIds regenerates only matching screen', () => {
    const mappings: ChangeAwareGenerationMapping[] = [
      { pathPrefix: 'src/login', screenIds: ['SCREEN-1'] },
    ];
    const result = selectCasesForChange({
      changedFiles: ['src/login/form.ts'],
      mappings,
      cases: allCases,
    });
    assert.equal(result.status, 'UPDATED');
    assert.deepEqual(
      result.regenerate.map((c) => c.screenId),
      ['SCREEN-1']
    );
    assert.deepEqual(
      result.preserved.map((c) => c.screenId),
      ['SCREEN-2']
    );
    assert.deepEqual(result.unmappedFiles, []);
  });

  it('prefix match with empty screenIds/elementIds/testCaseIds → UNMAPPED', () => {
    const result = selectCasesForChange({
      changedFiles: ['src/login/form.ts'],
      mappings: [{ pathPrefix: 'src/login' }],
      cases: allCases,
    });
    assert.equal(result.status, 'UNMAPPED');
    assert.deepEqual(result.regenerate, []);
    assert.deepEqual(result.preserved, allCases);
    assert.deepEqual(result.unmappedFiles, ['src/login/form.ts']);
    assert.match(result.reason, /full inventory was not regenerated/);
  });

  it('diff text parses to file without spawning git (shared parser)', () => {
    const diff =
      'diff --git a/src/login/a.ts b/src/login/a.ts\n+++ b/src/login/a.ts';
    const files = parseChangedFilesFromDiff(diff);
    assert.ok(files.includes('src/login/a.ts'));

    const result = selectCasesForChange({
      changedFiles: files,
      mappings: [{ pathPrefix: 'src/login', screenIds: ['SCREEN-1'] }],
      cases: allCases,
    });
    assert.equal(result.status, 'UPDATED');
    assert.equal(result.regenerate.length, 1);
    assert.equal(result.regenerate[0]?.screenId, 'SCREEN-1');
  });

  it('source does not spawn git or invent PASS', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'scripts', 'planning', 'change-aware-generation.ts'),
      'utf8'
    );
    assert.doesNotMatch(src, /\bgit\b\s*\(/);
    assert.doesNotMatch(src, /spawnSync|execSync|execFileSync/);
    assert.doesNotMatch(src, /\bPASS\b/);
    assert.doesNotMatch(src, /demo\.|example\.com|localhost/);
  });
});
