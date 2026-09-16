import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFinding, slugFinding, type ResponsiveFinding } from './findings';

const finding: ResponsiveFinding = {
  status: 'FAIL',
  page: 'home',
  pagePath: '/',
  viewport: 'mobile',
  viewportSize: '390x844',
  affectedElement: 'nav',
  expected: 'navigation stays within the layout viewport',
  actual: 'nav extends 40px past the viewport',
  screenshot: 'test-results/responsive/evidence/mobile-home-nav.png',
  engineNote: 'Chromium emulated viewport (page.setViewportSize / Playwright viewport + touch flags) — not a real device, not iOS Safari, not Android Chrome',
};

test('formatFinding() includes page, viewport, element, expected, actual, evidence', () => {
  const text = formatFinding(finding);
  assert.match(text, /Page: home \(\/\)/);
  assert.match(text, /Viewport: mobile \(390x844\)/);
  assert.match(text, /Affected element: nav/);
  assert.match(text, /Expected: navigation stays/);
  assert.match(text, /Actual: nav extends/);
  assert.match(text, /Evidence: test-results\/responsive\/evidence\/mobile-home-nav.png/);
  assert.match(text, /emulated viewport/);
  assert.match(text, /not a real device/);
});

test('slugFinding() is filesystem-safe', () => {
  assert.equal(slugFinding(finding), 'mobile-home-nav');
});
