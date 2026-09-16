import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectUrlConsistencyFindings } from './url-consistency';
import { makeDiscoveredPage } from '../testing/discovery-fixtures';

const nextId = (() => {
  let n = 1;
  return () => `SEO-${String(n++).padStart(4, '0')}`;
})();

test('url consistency PASSes when crawled URLs share one scheme and host', () => {
  const findings = collectUrlConsistencyFindings(
    [makeDiscoveredPage({ url: 'https://www.saucedemo.com/' })],
    nextId
  );
  assert.equal(findings[0]?.status, 'PASS');
  assert.match(findings[0]?.detail ?? '', /policy was invented/i);
});

test('url consistency WARNINGs when www and apex are mixed', () => {
  const findings = collectUrlConsistencyFindings(
    [
      makeDiscoveredPage({ url: 'https://www.example.com/' }),
      makeDiscoveredPage({ url: 'https://example.com/about' }),
    ],
    nextId
  );
  assert.equal(findings[0]?.status, 'WARNING');
});
