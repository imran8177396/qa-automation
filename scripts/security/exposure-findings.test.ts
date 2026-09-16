import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectExposureFindings, isBuildArtifactUrl } from './exposure-findings';

test('isBuildArtifactUrl() matches __next*, source maps, and .txt manifests only', () => {
  assert.equal(isBuildArtifactUrl('https://example.com/work/__next.work'), true);
  assert.equal(isBuildArtifactUrl('https://example.com/static/main.js.map'), true);
  assert.equal(isBuildArtifactUrl('https://example.com/_next/static/build-manifest.txt'), true);
  assert.equal(isBuildArtifactUrl('https://example.com/notes.txt'), false);
  assert.equal(isBuildArtifactUrl('https://example.com/about'), false);
});

test('collectExposureFindings() emits High directory-listing-enabled for autoindex pages', () => {
  const findings = collectExposureFindings({
    pages: [{ url: 'https://example.com/work', title: 'Index of /work', isAutoindex: true, status: 200 }],
  });
  const listing = findings.filter((row) => row.rule === 'directory-listing-enabled');
  assert.equal(listing.length, 1);
  assert.equal(listing[0].severity, 'high');
  assert.match(listing[0].detail, /\/work/);
  assert.equal(listing[0].status, 'FAIL');
});

test('collectExposureFindings() emits High build-artifact-exposed for reachable __next files', () => {
  const findings = collectExposureFindings({
    pages: [
      {
        url: 'https://example.com/work/__next.work',
        title: 'Index of /work/__next.work',
        isAutoindex: true,
        status: 200,
        outboundLinks: [{ href: 'https://example.com/static/app.js.map', text: 'app.js.map' }],
      },
    ],
  });
  const artifacts = findings.filter((row) => row.rule === 'build-artifact-exposed');
  assert.ok(artifacts.some((row) => row.pagePath === '/work/__next.work'));
  assert.ok(artifacts.some((row) => row.pagePath === '/static/app.js.map'));
  assert.ok(artifacts.every((row) => row.severity === 'high'));
});

test('collectExposureFindings() PASSes when discovery pages have no listings or artifacts', () => {
  const findings = collectExposureFindings({
    pages: [{ url: 'https://example.com/', title: 'Home', status: 200 }],
  });
  assert.equal(findings.find((row) => row.rule === 'directory-listing-enabled')?.status, 'PASS');
  assert.equal(findings.find((row) => row.rule === 'build-artifact-exposed')?.status, 'PASS');
  assert.ok(
    findings.every((row) => row.rule === 'directory-listing-enabled' || row.rule === 'build-artifact-exposed')
  );
});

test('collectExposureFindings() is NOT_TESTED without discovery pages', () => {
  const findings = collectExposureFindings({ pages: [] });
  assert.equal(findings.length, 2);
  assert.ok(findings.every((row) => row.status === 'NOT_TESTED'));
});
