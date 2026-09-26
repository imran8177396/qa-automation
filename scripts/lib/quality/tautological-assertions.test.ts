import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QaConfig } from '../../types';
import { buildTautologicalArtifact, classifyAssertionFlags } from './tautological-assertions';

function fixtureConfig(): QaConfig {
  return {
    postman: {
      enabled: true,
      collectionName: 't',
      requests: [
        {
          name: 'GET /solutions — documented intended 404',
          method: 'GET',
          path: '/solutions',
          expectedStatus: 404,
          assertionFlags: [
            {
              assertion: 'statusCode',
              expected: 404,
              lastObserved: 404,
              flags: ['DOCUMENTED_INTENDED_STATUS', 'USER_CONFIRMED'],
              note: 'User-confirmed intended status for the classifier fixture.',
            },
          ],
        },
        {
          name: 'GET /contact — documented intended 404',
          method: 'GET',
          path: '/contact',
          expectedStatus: 404,
          assertionFlags: [
            {
              assertion: 'statusCode',
              expected: 404,
              lastObserved: 404,
              flags: ['DOCUMENTED_INTENDED_STATUS', 'USER_CONFIRMED'],
              note: 'User-confirmed intended status for the classifier fixture.',
            },
          ],
        },
        {
          name: 'GET / — last-observed 200',
          method: 'GET',
          path: '/',
          expectedStatus: 200,
          assertionFlags: [
            {
              assertion: 'statusCode',
              expected: 200,
              lastObserved: 200,
              flags: ['TAUTOLOGICAL_ASSERTION'],
              note: 'Expected status was copied from last observed.',
            },
          ],
        },
        {
          name: 'GET /api/ — last-observed 404',
          method: 'GET',
          path: '/api/',
          expectedStatus: 404,
          assertionFlags: [
            {
              assertion: 'statusCode',
              expected: 404,
              lastObserved: 404,
              flags: ['TAUTOLOGICAL_ASSERTION'],
              note: 'Expected status was copied from last observed.',
            },
          ],
        },
      ],
    },
  } as unknown as QaConfig;
}

test('user-confirmed /solutions and /contact are documented intended status, not derived-from-observed', () => {
  const classified = classifyAssertionFlags(fixtureConfig());
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
  const classified = classifyAssertionFlags(fixtureConfig());
  const derivedPaths = classified.derivedFromObserved.map((row) => row.path);
  assert.ok(derivedPaths.includes('/'), 'GET / 200 is still last-observed');
  assert.ok(derivedPaths.includes('/api/'), 'GET /api/ 404 is still last-observed');
});

test('tautological artifact count excludes documented intended 404s', () => {
  const artifact = buildTautologicalArtifact(fixtureConfig(), '2026-09-09T00:00:00.000Z');
  assert.equal(artifact.items.some((row) => row.path === '/solutions' || row.path === '/contact'), false);
  assert.equal(artifact.documentedIntendedStatus.some((row) => row.path === '/solutions'), true);
  assert.equal(artifact.documentedIntendedStatus.some((row) => row.path === '/contact'), true);
  assert.equal(artifact.count, artifact.items.length);
  assert.ok(artifact.count >= 1);
});
