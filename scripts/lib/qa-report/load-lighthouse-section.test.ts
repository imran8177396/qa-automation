import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOT_AVAILABLE } from '../suite-origin';
import { loadLighthouseSection } from './load-section-artifacts';

test('Lighthouse section stays separate and does not invent CWV scores', () => {
  const section = loadLighthouseSection();
  if (!section.available) {
    assert.equal(section.status, 'NOT_EXECUTED');
    assert.equal(section.source, NOT_AVAILABLE);
    return;
  }
  assert.equal(section.source, 'reports/lighthouse/summary.json');
  assert.ok(section.status === 'RECORDED' || section.status === 'NOT_EXECUTED');
  if (section.status === 'NOT_EXECUTED') {
    assert.ok(section.skipReason.length > 0);
  }
});
