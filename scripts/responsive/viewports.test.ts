import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESPONSIVE_LIMITATIONS,
  VIEWPORT_NAMES,
  VIEWPORTS,
  playwrightUseFor,
  viewportFromProjectName,
} from './viewports';

test('viewport matrix covers desktop, laptop, tablet, and mobile only', () => {
  assert.deepEqual([...VIEWPORT_NAMES], ['desktop', 'laptop', 'tablet', 'mobile']);
  assert.equal(VIEWPORTS.desktop.width, 1920);
  assert.equal(VIEWPORTS.laptop.width, 1366);
  assert.equal(VIEWPORTS.tablet.width, 768);
  assert.equal(VIEWPORTS.mobile.width, 390);
});

test('compact chrome is only tablet/mobile', () => {
  assert.equal(VIEWPORTS.desktop.compactChrome, false);
  assert.equal(VIEWPORTS.laptop.compactChrome, false);
  assert.equal(VIEWPORTS.tablet.compactChrome, true);
  assert.equal(VIEWPORTS.mobile.compactChrome, true);
});

test('project names are form factors, not device models', () => {
  for (const name of VIEWPORT_NAMES) {
    assert.match(VIEWPORTS[name].projectName, /^responsive-/);
    assert.doesNotMatch(VIEWPORTS[name].projectName, /iphone|ipad|safari|pixel/i);
    assert.match(VIEWPORTS[name].emulationNote, /emulated viewport/i);
    assert.match(VIEWPORTS[name].emulationNote, /not a real device/i);
    assert.doesNotMatch(VIEWPORTS[name].emulationNote, /real iOS Safari ran|real Android Chrome ran/i);
  }
});

test('playwrightUseFor() does not attach a spoofed device name', () => {
  const use = playwrightUseFor(VIEWPORTS.mobile);
  assert.deepEqual(use.viewport, { width: 390, height: 844 });
  assert.equal(use.isMobile, true);
  assert.equal(use.hasTouch, true);
  assert.equal(use.deviceScaleFactor, 1);
});

test('limitations refuse real-device / iOS Safari / Android Chrome claims', () => {
  assert.ok(RESPONSIVE_LIMITATIONS.some((line) => /emulated viewport/i.test(line)));
  assert.ok(RESPONSIVE_LIMITATIONS.some((line) => /not a real device/i.test(line)));
  assert.ok(RESPONSIVE_LIMITATIONS.some((line) => /No real iOS Safari/i.test(line)));
  assert.ok(RESPONSIVE_LIMITATIONS.some((line) => /not Mobile Safari/i.test(line)));
});

test('viewportFromProjectName() rejects unknown projects', () => {
  assert.equal(viewportFromProjectName('responsive-tablet').name, 'tablet');
  assert.throws(() => viewportFromProjectName('webkit'), /Unknown responsive project/);
});
