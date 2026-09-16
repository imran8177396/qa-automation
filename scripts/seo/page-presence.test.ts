import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPagePresenceFindings } from './page-presence';
import { makeDiscoveredPage } from '../testing/discovery-fixtures';

test('single crawled page records duplicate-title as NOT_TESTED', () => {
  let n = 1;
  const nextId = () => `SEO-${String(n++).padStart(4, '0')}`;
  const findings = collectPagePresenceFindings([makeDiscoveredPage()], nextId);
  const dup = findings.find((row) => row.rule === 'duplicate-title');
  assert.equal(dup?.status, 'NOT_TESTED');
  assert.match(dup?.detail ?? '', /Only one crawled page/);
});

test('present title/meta/canonical/OG are PASS', () => {
  let n = 1;
  const nextId = () => `SEO-${String(n++).padStart(4, '0')}`;
  const findings = collectPagePresenceFindings([makeDiscoveredPage()], nextId);
  assert.equal(findings.find((row) => row.rule === 'title')?.status, 'PASS');
  assert.equal(findings.find((row) => row.rule === 'meta-description')?.status, 'PASS');
  assert.equal(findings.find((row) => row.rule === 'canonical')?.status, 'PASS');
  assert.equal(findings.find((row) => row.rule === 'open-graph')?.status, 'PASS');
});
