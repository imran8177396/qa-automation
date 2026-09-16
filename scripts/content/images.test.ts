import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectImageAltFindings, collectImageSrcs } from './images';

test('collectImageAltFindings() FAILs missing alt and PASSes when all have alt', () => {
  const missing = collectImageAltFindings('https://example.com/', [
    { src: '/a.png', alt: '', hasAltAttr: false },
  ]);
  assert.equal(missing[0]?.status, 'FAIL');

  const ok = collectImageAltFindings('https://example.com/', [
    { src: '/a.png', alt: 'Logo', hasAltAttr: true },
  ]);
  assert.equal(ok[0]?.status, 'PASS');
});

test('collectImageSrcs() keeps same-origin srcs only', () => {
  const srcs = collectImageSrcs('https://www.saucedemo.com/', 'https://www.saucedemo.com', [
    { src: '/logo.png', alt: 'Logo', hasAltAttr: true },
    { src: 'https://cdn.example.com/x.png', alt: 'x', hasAltAttr: true },
  ]);
  assert.deepEqual(srcs, ['https://www.saucedemo.com/logo.png']);
});
