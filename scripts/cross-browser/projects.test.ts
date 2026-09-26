import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { engineProject, engineProjects } from './projects';

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

  it('engineProjects() registers all three desktop engines and keeps Firefox SWGL prefs', () => {
    const projects = engineProjects();
    assert.deepEqual(projects.map((project) => project.name), ['chromium', 'firefox', 'webkit']);
    const firefox = projects.find((project) => project.name === 'firefox');
    const launchOptions = firefox?.use?.launchOptions as { firefoxUserPrefs?: Record<string, boolean> } | undefined;
    assert.equal(launchOptions?.firefoxUserPrefs?.['gfx.webrender.software'], true);
  });
});
