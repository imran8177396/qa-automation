import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DanglingSectionReferenceError,
  SECTION_MANIFEST,
  SectionRegistry,
  numberSections,
  resolveRefTokens,
} from './section-manifest';

test('Layer 2 numbers 2.11 SEO through 2.17 Retest from manifest order', () => {
  const numbered = numberSections();
  const byId = Object.fromEntries(numbered.map((row) => [row.id, row.number]));
  assert.equal(byId.seo, '2.11');
  assert.equal(byId.accessibility, '2.12');
  assert.equal(byId.security, '2.13');
  assert.equal(byId.content, '2.14');
  assert.equal(byId.visual, '2.15');
  assert.equal(byId['failure-analysis'], '2.16');
  assert.equal(byId.retest, '2.17');
  assert.equal(byId['failure-detail'], '2.6.5');
  assert.equal(byId.lighthouse, '2.8.2');
});

test('cross-reference text includes the resolved section number', () => {
  const registry = new SectionRegistry();
  registry.emit('accessibility');
  const text = registry.ref('accessibility');
  assert.match(text, /Accessibility Analysis/);
  assert.match(text, /2\.12/);
});

test('dangling cross-reference throws and fails the report stage', () => {
  const registry = new SectionRegistry();
  resolveRefTokens('see {{ref:accessibility}}', registry);
  assert.throws(() => registry.assertEveryReferenceResolves(), (error: unknown) => {
    assert.ok(error instanceof DanglingSectionReferenceError);
    assert.deepEqual(error.unresolved, ['accessibility']);
    return true;
  });
});

test('resolved ref after emit does not throw', () => {
  const registry = new SectionRegistry();
  resolveRefTokens('see {{ref:security}}', registry);
  registry.emit('security');
  assert.doesNotThrow(() => registry.assertEveryReferenceResolves());
});

test('manifest keeps 2.1–2.11 titles including SEO Analysis', () => {
  const seo = SECTION_MANIFEST.find((row) => row.id === 'seo');
  assert.equal(seo?.title, 'SEO Analysis');
});
