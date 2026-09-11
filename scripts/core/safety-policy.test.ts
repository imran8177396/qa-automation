import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize, classify, resolveSafetyConfig } from './safety-policy';

test('authorize() denies submit-form regardless of classification', () => {
  assert.equal(authorize({ kind: 'submit-form' }), false);
});

test('authorize() denies a submit control click', () => {
  assert.equal(authorize({ kind: 'click-button', isSubmitControl: true }), false);
});

test('authorize() denies anything correlated with a state change, for every action kind', () => {
  for (const kind of ['click-link', 'click-button', 'fill-field'] as const) {
    assert.equal(authorize({ kind, correlatesWithStateChange: true }), false, `expected ${kind} to be denied`);
  }
});

test('authorize() allows plain link/button/fill actions with no state-change correlation', () => {
  assert.equal(authorize({ kind: 'click-link' }), true);
  assert.equal(authorize({ kind: 'click-button' }), true);
  assert.equal(authorize({ kind: 'fill-field' }), true);
});

test('classify() labels a delete/purchase-style action as destructive', () => {
  const config = resolveSafetyConfig();
  assert.equal(classify({ text: 'Delete account' }, config), 'destructive');
  assert.equal(classify({ text: 'Buy now' }, config), 'destructive');
});

test('classify() labels a non-idempotent GET link as destructive', () => {
  const config = resolveSafetyConfig();
  assert.equal(classify({ href: '/item?action=delete&id=5' }, config), 'destructive');
});

test('classify() labels a plain POST form as caution, not destructive, absent a danger keyword', () => {
  const config = resolveSafetyConfig();
  assert.equal(classify({ text: 'Send message', formMethod: 'POST' }, config), 'caution');
});

test('classify() labels a plain link/GET as safe', () => {
  const config = resolveSafetyConfig();
  assert.equal(classify({ text: 'About us', href: '/about' }, config), 'safe');
});

test('classify() returns unknown for an element with no usable signal', () => {
  const config = resolveSafetyConfig();
  assert.equal(classify({}, config), 'unknown');
});

test('resolveSafetyConfig() defaults to enabled with a non-empty keyword list', () => {
  const config = resolveSafetyConfig();
  assert.equal(config.enabled, true);
  assert.ok(config.dangerKeywords.length > 0);
});

test('classify() returns unknown for everything when safety.enabled is false', () => {
  const config = resolveSafetyConfig({ enabled: false });
  assert.equal(classify({ text: 'Delete account' }, config), 'unknown');
  assert.equal(classify({ href: '/item?action=delete&id=5' }, config), 'unknown');
});

test('classify() downgrades an allowlisted url+selector match to safe', () => {
  const config = resolveSafetyConfig({
    allowlist: [{ url: '/account', selector: '#delete-btn', reason: 'demo-only destructive action' }],
  });
  assert.equal(
    classify({ text: 'Delete account', pageUrl: '/account', selector: '#delete-btn' }, config),
    'safe'
  );
});

test('classify() does not downgrade when only the url or only the selector matches', () => {
  const config = resolveSafetyConfig({
    allowlist: [{ url: '/account', selector: '#delete-btn', reason: 'demo-only destructive action' }],
  });
  assert.equal(
    classify({ text: 'Delete account', pageUrl: '/other-page', selector: '#delete-btn' }, config),
    'destructive'
  );
  assert.equal(
    classify({ text: 'Delete account', pageUrl: '/account', selector: '#other-btn' }, config),
    'destructive'
  );
});
