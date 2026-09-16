import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { engineProject } from './projects';

describe('engineProject', () => {
  it('names each project after the Playwright engine, not a physical device', () => {
    assert.equal(engineProject('chromium').name, 'chromium');
    assert.equal(engineProject('firefox').name, 'firefox');
    assert.equal(engineProject('webkit').name, 'webkit');
    assert.equal(engineProject('webkit').use?.browserName, 'webkit');
  });

  it('launches Firefox with software Webrender prefs and does not treat it as a real device', () => {
    const firefox = engineProject('firefox');
    const launchOptions = firefox.use?.launchOptions as { firefoxUserPrefs?: Record<string, boolean> } | undefined;
    assert.equal(launchOptions?.firefoxUserPrefs?.['layers.acceleration.disabled'], true);
    assert.equal(launchOptions?.firefoxUserPrefs?.['gfx.webrender.software'], true);
    assert.equal(engineProject('chromium').use?.launchOptions, undefined);
    assert.equal(engineProject('webkit').use?.launchOptions, undefined);
  });
});
