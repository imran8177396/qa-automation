import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  analyzeChangeImpact,
  resolveRuntimeDependencyGraph,
  resolveStaticDependencyGraph,
} from './risk';

const AUTH_DIFF = `diff --git a/src/auth/login.ts b/src/auth/login.ts
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
`;

const AUTH_MAPPING = {
  path: 'src/auth/',
  module: 'auth',
  service: 'identity',
  feature: 'login',
  testIds: ['AUTH-001'],
};

describe('analyzeChangeImpact', () => {
  it('maps a unified-diff fixture via explicit path prefix', () => {
    const result = analyzeChangeImpact({
      gitDiff: AUTH_DIFF,
      mapping: [AUTH_MAPPING],
    });
    assert.equal(result.status, 'PARTIAL');
    assert.ok(result.changedFiles.includes('src/auth/login.ts'));
    assert.deepEqual(result.changedModules, ['auth']);
    assert.deepEqual(result.affectedServices, ['identity']);
    assert.deepEqual(result.affectedFeatures, ['login']);
    assert.deepEqual(result.affectedTests, ['AUTH-001']);
    assert.deepEqual(result.unmappedFiles, []);
    assert.equal(result.fallback, 'none');
    assert.match(result.reason, /git diff was not executed by this function/);
  });

  it('falls back to full regression when an unmapped file exists and allTestIds is provided', () => {
    const result = analyzeChangeImpact({
      gitDiff: AUTH_DIFF,
      changedFiles: ['src/auth/login.ts', 'src/billing/invoice.ts'],
      mapping: [AUTH_MAPPING],
      allTestIds: ['AUTH-001', 'BILL-001'],
    });
    assert.equal(result.status, 'PARTIAL');
    assert.equal(result.fallback, 'full-regression');
    assert.deepEqual(result.affectedTests, ['AUTH-001', 'BILL-001']);
    assert.deepEqual(result.unmappedFiles, ['src/billing/invoice.ts']);
    assert.deepEqual(result.changedModules, ['auth']);
    assert.deepEqual(result.affectedServices, ['identity']);
    assert.deepEqual(result.affectedFeatures, ['login']);
    assert.match(result.reason, /mappings are incomplete/);
    assert.match(result.reason, /full regression/);
  });

  it('returns NOT_IMPLEMENTED with empty affected tests when no diff or changedFiles', () => {
    const result = analyzeChangeImpact({});
    assert.equal(result.status, 'NOT_IMPLEMENTED');
    assert.deepEqual(result.affectedTests, []);
    assert.deepEqual(result.changedFiles, []);
    assert.match(result.reason, /change-impact analysis is not implemented/);
  });

  it('does not select AUTH tests when mapping path does not prefix the file', () => {
    const result = analyzeChangeImpact({
      changedFiles: ['src/auth/login.ts'],
      mapping: [
        {
          path: 'src/billing/',
          module: 'billing',
          service: 'payments',
          feature: 'invoice',
          testIds: ['AUTH-001'],
        },
      ],
    });
    assert.deepEqual(result.affectedTests, []);
    assert.deepEqual(result.unmappedFiles, ['src/auth/login.ts']);
    assert.equal(result.fallback, 'full-regression');
    assert.deepEqual(result.changedModules, []);
  });

  it('keeps mapped subset when unmapped and allTestIds is omitted', () => {
    const result = analyzeChangeImpact({
      changedFiles: ['src/auth/login.ts', 'src/billing/invoice.ts'],
      mapping: [AUTH_MAPPING],
    });
    assert.deepEqual(result.affectedTests, ['AUTH-001']);
    assert.equal(result.fallback, 'full-regression');
    assert.match(result.reason, /full test list was not provided/);
  });

  it('treats empty mapping as all unmapped full-regression', () => {
    const result = analyzeChangeImpact({
      changedFiles: ['src/auth/login.ts'],
      mapping: [],
      allTestIds: ['AUTH-001', 'OTHER'],
    });
    assert.deepEqual(result.unmappedFiles, ['src/auth/login.ts']);
    assert.equal(result.fallback, 'full-regression');
    assert.deepEqual(result.affectedTests, ['AUTH-001', 'OTHER']);
  });
});

describe('dependency graph seams', () => {
  it('resolveStaticDependencyGraph is NOT_IMPLEMENTED', () => {
    const result = resolveStaticDependencyGraph();
    assert.equal(result.status, 'NOT_IMPLEMENTED');
    assert.match(result.reason, /static dependency graph is not implemented/);
  });

  it('resolveRuntimeDependencyGraph is NOT_IMPLEMENTED', () => {
    const result = resolveRuntimeDependencyGraph();
    assert.equal(result.status, 'NOT_IMPLEMENTED');
    assert.match(result.reason, /runtime dependency graph is not implemented/);
  });
});

describe('change-impact source policy', () => {
  it('does not contain openai, llm, or inferTests', () => {
    const riskPath = path.join(process.cwd(), 'scripts', 'core', 'platform', 'risk.ts');
    const source = readFileSync(riskPath, 'utf8').toLowerCase();
    assert.equal(source.includes('openai'), false);
    assert.equal(source.includes('llm'), false);
    assert.equal(source.includes('infertests'), false);
  });
});
