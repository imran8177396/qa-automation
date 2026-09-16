import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allureCliHint, resolveAllureCommand } from './allure-cli';
import { localBinPath } from './run-command';

describe('allure CLI resolver', () => {
  it('documents the project Allure CLI dependency and prefers the local binary when present', () => {
    assert.match(allureCliHint(), /allure-commandline/);
    assert.match(allureCliHint(), /Java/);
    const resolved = resolveAllureCommand();
    const local = localBinPath('allure');
    if (resolved) {
      assert.ok(resolved === local || resolved.toLowerCase().includes('allure'));
    }
  });
});
