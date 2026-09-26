import assert from 'node:assert/strict';
import fs from 'fs';
import { describe, it } from 'node:test';
import { resolveNpmCommand } from './run-command';

describe('resolveNpmCommand', () => {
  it('resolves npm beside node or on PATH so Windows .cmd shims can be spawned', () => {
    const resolved = resolveNpmCommand();
    assert.ok(resolved, 'npm should be resolvable in this environment');
    assert.ok(fs.existsSync(resolved), `resolved npm path should exist: ${resolved}`);
    if (process.platform === 'win32') {
      assert.match(resolved, /npm(\.cmd)?$/i);
    } else {
      assert.match(resolved, /npm$/);
    }
  });
});
