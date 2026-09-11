import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDiscoveredPageTargets } from './discovered-page-targets';
import type { PageMap } from '../discovery/page-map';

const liveTarget = {
  url: 'https://example.com',
  origin: 'https://example.com',
  isLoopback: false,
  source: 'config' as const,
};

const fixtureFallback = [
  {
    path: '/contact.html',
    name: 'contact',
    url: 'http://127.0.0.1:4173/contact.html',
    source: 'fixture' as const,
  },
];

describe('resolveDiscoveredPageTargets', () => {
  it('uses discovery pages when the page-map origin matches the live target', () => {
    const pageMap = {
      seedUrl: 'https://example.com/',
      pages: [
        { url: 'https://example.com/', route: '/', ok: true, error: undefined },
        { url: 'https://example.com/work', route: '/work', ok: true, error: undefined },
      ],
    } as PageMap;

    const resolved = resolveDiscoveredPageTargets({
      target: liveTarget,
      fallback: fixtureFallback,
      pageMap,
    });
    assert.equal(resolved.source, 'discovery');
    assert.deepEqual(
      resolved.pages.map((page) => page.path),
      ['/', '/work']
    );
  });

  it('does not substitute fixture pages when a live origin has no matching page-map', () => {
    const resolved = resolveDiscoveredPageTargets({
      target: liveTarget,
      fallback: fixtureFallback,
      pageMap: null,
    });
    assert.equal(resolved.source, 'homepage-fallback');
    assert.equal(resolved.pages[0]?.path, '/');
    assert.ok(resolved.reason);
    assert.equal(resolved.pages.some((page) => page.path === '/contact.html'), false);
  });

  it('uses fixture pages only when the UI target is loopback', () => {
    const resolved = resolveDiscoveredPageTargets({
      target: {
        url: 'http://127.0.0.1:4173',
        origin: 'http://127.0.0.1:4173',
        isLoopback: true,
        source: 'env',
      },
      fallback: fixtureFallback,
      pageMap: null,
    });
    assert.equal(resolved.source, 'fixture');
    assert.equal(resolved.pages[0]?.path, '/contact.html');
  });
});
