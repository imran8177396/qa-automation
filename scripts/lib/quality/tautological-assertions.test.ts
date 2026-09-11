import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../load-config';
import { buildTautologicalArtifact, classifyAssertionFlags } from './tautological-assertions';

test('user-confirmed /solutions and /contact are documented intended status, not derived-from-observed', () => {
  const classified = classifyAssertionFlags(loadConfig());
  const derivedPaths = classified.derivedFromObserved.map((row) => row.path);
  const documentedPaths = classified.documentedIntendedStatus.map((row) => row.path);

  assert.equal(derivedPaths.includes('/solutions'), false);
  assert.equal(derivedPaths.includes('/contact'), false);
  assert.ok(documentedPaths.includes('/solutions'), 'GET /solutions must be documented intended status');
  assert.ok(documentedPaths.includes('/contact'), 'GET /contact must be documented intended status');
  assert.equal(
    classified.documentedIntendedStatus.every((row) => row.origin === 'documented-intended-status'),
    true
  );
});

test('GET / and GET /api/ remain derived-from-observed until separately confirmed', () => {
  const classified = classifyAssertionFlags(loadConfig());
  const derivedPaths = classified.derivedFromObserved.map((row) => row.path);
  assert.ok(derivedPaths.includes('/'), 'GET / 200 is still last-observed');
  assert.ok(derivedPaths.includes('/api/'), 'GET /api/ 404 is still last-observed');
});

test('tautological artifact count excludes documented intended 404s', () => {
  const artifact = buildTautologicalArtifact(loadConfig(), '2026-09-09T00:00:00.000Z');
  assert.equal(artifact.items.some((row) => row.path === '/solutions' || row.path === '/contact'), false);
  assert.equal(artifact.documentedIntendedStatus.some((row) => row.path === '/solutions'), true);
  assert.equal(artifact.documentedIntendedStatus.some((row) => row.path === '/contact'), true);
  assert.equal(artifact.count, artifact.items.length);
  assert.ok(artifact.count >= 1);
});
