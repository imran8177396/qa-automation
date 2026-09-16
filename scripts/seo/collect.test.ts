import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSeoSuiteFindings } from './collect';
import { makeDiscoveredPage, makeDiscoveryResult } from '../testing/discovery-fixtures';
import type { QaConfig } from '../types';
import type { ProbeResult } from '../security/probe';
import type { SeoProbe } from './http';

function ok(body: string, status = 200, headers: Record<string, string> = {}): ProbeResult {
  return { ok: status < 400, status, headers, setCookies: [], body, finalUrl: 'https://example.com/' };
}

function mockProbe(): SeoProbe {
  return {
    async get(url) {
      if (url.endsWith('/robots.txt')) {
        return ok('<html><title>Swag Labs</title></html>', 200, { 'content-type': 'text/html' });
      }
      if (url.endsWith('/sitemap.xml')) {
        return ok('<html><title>Swag Labs</title></html>', 200, { 'content-type': 'text/html' });
      }
      return ok('<html><head><title>Example — Home</title></head><body><h1>Welcome</h1></body></html>');
    },
    async head() {
      return ok('', 200);
    },
  };
}

test('collectSeoSuiteFindings() records robots/sitemap FAIL on HTML fallback and duplicate-title NOT_TESTED', async () => {
  const config = { seo: { enabled: true }, urls: { website: 'https://example.com/', api: '' } } as QaConfig;
  const findings = await collectSeoSuiteFindings({
    discovery: makeDiscoveryResult([makeDiscoveredPage()]),
    pageMap: null,
    config,
    probe: mockProbe(),
  });
  assert.equal(findings.find((row) => row.rule === 'robots-txt')?.status, 'FAIL');
  assert.equal(findings.find((row) => row.rule === 'sitemap-xml')?.status, 'FAIL');
  assert.equal(findings.find((row) => row.rule === 'duplicate-title')?.status, 'NOT_TESTED');
  assert.equal(findings.find((row) => row.rule === 'missing-path-404')?.status, 'NOT_TESTED');
  assert.equal(findings.find((row) => row.rule === 'title')?.status, 'PASS');
});
