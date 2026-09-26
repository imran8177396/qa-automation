import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMPATIBILITY_DISCLAIMER,
  buildCompatibilityMatrix,
  renderCompatibilityMatrixMarkdown,
} from './compatibility-matrix';

describe('compatibility matrix', () => {
  it('emits six rows with honest engine vs branded-channel statuses', () => {
    const rows = buildCompatibilityMatrix();
    assert.equal(rows.length, 6);

    const byBrowser = Object.fromEntries(rows.map((row) => [row.browser, row]));
    assert.equal(byBrowser.Chromium.status, 'EXECUTED');
    assert.equal(byBrowser.Firefox.status, 'EXECUTED');
    assert.equal(byBrowser.WebKit.status, 'EXECUTED');
    assert.equal(byBrowser.Chrome.status, 'NOT_TESTED');
    assert.equal(byBrowser.Safari.status, 'NOT_TESTED');
    assert.equal(byBrowser.Edge.status, 'NOT_TESTED');
  });

  it('marks chromium/firefox/webkit as desktop-engine-emulation, not real devices', () => {
    const rows = buildCompatibilityMatrix().filter((row) =>
      ['Chromium', 'Firefox', 'WebKit'].includes(row.browser)
    );
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.realDevice, false);
      assert.equal(row.execution, 'desktop-engine-emulation');
      assert.equal(row.deviceProfile, 'desktop emulation');
      assert.equal(row.status, 'EXECUTED');
    }
  });

  it('keeps chrome, safari, and edge NOT_TESTED', () => {
    const rows = buildCompatibilityMatrix().filter((row) =>
      ['Chrome', 'Safari', 'Edge'].includes(row.browser)
    );
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.status, 'NOT_TESTED');
      assert.equal(row.realDevice, false);
      assert.equal(row.execution, 'desktop-engine-emulation');
    }
  });

  it('renders markdown with the real-device disclaimer and without iPhone/Pixel device claims', () => {
    const markdown = renderCompatibilityMatrixMarkdown();
    assert.match(markdown, /not real-device/i);
    assert.ok(markdown.includes(COMPATIBILITY_DISCLAIMER));
    assert.doesNotMatch(markdown, /\biPhone\b/);
    assert.doesNotMatch(markdown, /\bPixel\b/);
  });
});
