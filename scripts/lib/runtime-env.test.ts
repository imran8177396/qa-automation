import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyNodeHeapOption,
  applySafePlaywrightBrowsersPath,
  defaultPlaywrightBrowsersDir,
  isUnsafePlaywrightBrowsersPath,
  resolveSafePlaywrightBrowsersPath,
} from './runtime-env';
import { decideWrapperExitCode } from '../run-qa-full';
import { timeoutMsForStageKey, STAGE_TIMEOUT_MS, totalConfiguredStageTimeoutBudgetMs } from '../orchestrator/stage-timeouts';

describe('runtime-env Playwright browsers path', () => {
  it('treats sandbox paths as unsafe', () => {
    assert.equal(isUnsafePlaywrightBrowsersPath('C:\\sandbox\\ms-playwright'), true);
    assert.equal(isUnsafePlaywrightBrowsersPath('D:\\Users\\me\\AppData\\Local\\ms-playwright'), false);
  });

  it('clears sandbox path and prefers the user cache when it exists', () => {
    const home = 'C:\\Users\\tester';
    const preferred = defaultPlaywrightBrowsersDir(home);
    const resolved = resolveSafePlaywrightBrowsersPath(
      { PLAYWRIGHT_BROWSERS_PATH: 'C:\\tmp\\sandbox\\browsers' },
      { home, pathExists: (p) => p === preferred }
    );
    assert.equal(resolved, preferred);
  });

  it('leaves a valid existing path alone', () => {
    const custom = 'D:\\browsers\\pw';
    const resolved = resolveSafePlaywrightBrowsersPath(
      { PLAYWRIGHT_BROWSERS_PATH: custom },
      { home: 'C:\\Users\\tester', pathExists: (p) => p === custom }
    );
    assert.equal(resolved, custom);
  });

  it('mutates env via applySafePlaywrightBrowsersPath', () => {
    const env: NodeJS.ProcessEnv = { PLAYWRIGHT_BROWSERS_PATH: 'C:\\sandbox\\x' };
    const home = 'C:\\Users\\tester';
    const preferred = defaultPlaywrightBrowsersDir(home);
    applySafePlaywrightBrowsersPath(env, { home, pathExists: (p) => p === preferred });
    assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, preferred);
  });
});

describe('runtime-env NODE_OPTIONS heap', () => {
  it('adds max-old-space-size when missing', () => {
    const env: NodeJS.ProcessEnv = {};
    applyNodeHeapOption(env, 4096);
    assert.match(env.NODE_OPTIONS ?? '', /--max-old-space-size=4096/);
  });

  it('does not lower an existing higher heap', () => {
    const env: NodeJS.ProcessEnv = { NODE_OPTIONS: '--max-old-space-size=8192' };
    applyNodeHeapOption(env, 4096);
    assert.match(env.NODE_OPTIONS ?? '', /--max-old-space-size=8192/);
  });
});

describe('stage timeouts', () => {
  it('gives responsive and e2e generous ceilings for slow live sites', () => {
    assert.ok(timeoutMsForStageKey('responsive') >= 60 * 60 * 1000);
    assert.ok(timeoutMsForStageKey('e2e') >= 60 * 60 * 1000);
    assert.equal(timeoutMsForStageKey('responsive'), STAGE_TIMEOUT_MS.responsive);
  });

  it('keeps the serial worst-case budget finite and documented (~16h)', () => {
    const budget = totalConfiguredStageTimeoutBudgetMs();
    assert.ok(budget > 8 * 60 * 60 * 1000);
    assert.ok(budget < 24 * 60 * 60 * 1000);
  });
});

describe('wrapper exit codes', () => {
  it('returns 0 when pipeline complete and verdict not FAIL', () => {
    assert.equal(decideWrapperExitCode({ pipelineComplete: true, overallStatus: 'PASS' }), 0);
    assert.equal(decideWrapperExitCode({ pipelineComplete: true, overallStatus: 'BLOCKED' }), 0);
  });

  it('returns 1 when pipeline incomplete', () => {
    assert.equal(decideWrapperExitCode({ pipelineComplete: false, overallStatus: 'PASS' }), 1);
  });

  it('returns 2 when pipeline complete but verdict FAIL', () => {
    assert.equal(decideWrapperExitCode({ pipelineComplete: true, overallStatus: 'FAIL' }), 2);
  });
});
