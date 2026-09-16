import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { PATHS } from '../lib/paths';
import { resolveSpecFile } from './resolve-spec';
import { NOT_AVAILABLE } from '../lib/suite-origin';

describe('resolveSpecFile', () => {
  it('resolves accessibility and e2e basenames that exist in the repo', () => {
    const axe = resolveSpecFile('axe.spec.ts', 'accessibility');
    assert.ok(axe);
    assert.equal(path.basename(axe ?? ''), 'axe.spec.ts');
    assert.ok((axe ?? '').replace(/\\/g, '/').includes('tests/e2e/accessibility'));

    const login = resolveSpecFile('login-fields.spec.ts', 'cross-browser');
    assert.ok(login);
    assert.equal(path.normalize(login ?? ''), path.normalize(path.join(PATHS.root, 'tests/e2e/login-fields.spec.ts')));
  });

  it('returns null for NOT_AVAILABLE or non-spec artifacts', () => {
    assert.equal(resolveSpecFile(NOT_AVAILABLE, 'security'), null);
    assert.equal(resolveSpecFile('reports/security/summary.json', 'security'), null);
  });
});
