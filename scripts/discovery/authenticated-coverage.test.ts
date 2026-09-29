import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildAuthenticatedCoverage, configuredRoleKeys } from './authenticated-coverage';
import { ROOT } from '../lib/paths';

function assertNoDemoHosts(value: unknown): void {
  const blob = JSON.stringify(value).toLowerCase();
  assert.equal(/saucedemo|jsonplaceholder|swag\s*labs|inventory\.html/.test(blob), false);
}

function assertNoSecrets(value: unknown): void {
  const blob = JSON.stringify(value).toLowerCase();
  assert.equal(/password|secret|token|api[_-]?key/.test(blob), false);
}

test('no session: public screens listed, login NOT_TESTED if none, gates REQUIRES_CONFIGURATION, no invented URLs', () => {
  const coverage = buildAuthenticatedCoverage({
    screens: [
      {
        id: 'SCREEN-001',
        url: 'http://app.test/',
        state: 'default',
        authenticationRequired: false,
        authenticationEvidence: 'public',
      },
    ],
    pages: [{ url: 'http://app.test/', access: 'public', status: 200 }],
    session: null,
  });

  assert.deepEqual(coverage.publicScreenIds, ['SCREEN-001']);
  const publicLayer = coverage.layers.find((l) => l.gate === 'public');
  const loginLayer = coverage.layers.find((l) => l.gate === 'login');
  assert.ok(publicLayer);
  assert.equal(publicLayer!.status, 'DISCOVERED');
  assert.deepEqual(publicLayer!.screenIds, ['SCREEN-001']);
  assert.ok(loginLayer);
  assert.equal(loginLayer!.status, 'NOT_TESTED');
  assert.match(loginLayer!.reason, /no login screen was discovered/);
  assert.deepEqual(loginLayer!.screenIds, []);

  const sessionGates = coverage.layers.filter((l) =>
    ['role', 'permission', 'organization', 'tenant', 'subscription', 'feature-flag'].includes(l.gate)
  );
  assert.equal(sessionGates.length, 6);
  for (const layer of sessionGates) {
    assert.equal(layer.status, 'REQUIRES_CONFIGURATION');
    assert.deepEqual(layer.screenIds, []);
    assert.equal(layer.key, undefined);
  }
  assert.equal(
    coverage.layers.some((l) => l.key === 'Admin' || l.key === 'Super Admin' || l.key === 'admin'),
    false
  );
  const blob = JSON.stringify(coverage);
  assert.equal(/\/admin|\/dashboard/i.test(blob), false);
  assertNoDemoHosts(coverage);
  assertNoSecrets(coverage);
});

test('session established with roles User and authenticated page without role → User NOT_TESTED, no Admin', () => {
  const coverage = buildAuthenticatedCoverage({
    screens: [
      {
        id: 'SCREEN-001',
        url: 'http://app.test/',
        state: 'default',
        authenticationRequired: false,
        authenticationEvidence: 'public',
      },
      {
        id: 'SCREEN-002',
        url: 'http://app.test/app',
        state: 'authenticated',
        authenticationRequired: false,
        authenticationEvidence: 'authenticated',
      },
    ],
    pages: [
      { url: 'http://app.test/', access: 'public', status: 200 },
      { url: 'http://app.test/app', access: 'authenticated', status: 200 },
    ],
    session: { established: true, roles: ['User'] },
  });

  const userLayer = coverage.layers.find((l) => l.gate === 'role' && l.key === 'User');
  assert.ok(userLayer);
  assert.equal(userLayer!.status, 'NOT_TESTED');
  assert.deepEqual(userLayer!.screenIds, []);
  assert.match(userLayer!.reason, /active role was not recorded/);
  assert.equal(
    coverage.layers.some((l) => l.gate === 'role' && (l.key === 'Admin' || l.key === 'Super Admin')),
    false
  );
  assert.equal(/\/admin|\/dashboard/i.test(JSON.stringify(coverage)), false);
  assertNoDemoHosts(coverage);
});

test('gated login page → login layer DISCOVERED with that screen id', () => {
  const coverage = buildAuthenticatedCoverage({
    screens: [
      {
        id: 'SCREEN-001',
        url: 'http://app.test/signin',
        state: 'unauthenticated',
        authenticationRequired: true,
        authenticationEvidence: 'gated',
      },
    ],
    pages: [{ url: 'http://app.test/signin', access: 'gated', status: 200 }],
    session: { established: false },
  });

  const loginLayer = coverage.layers.find((l) => l.gate === 'login');
  assert.ok(loginLayer);
  assert.equal(loginLayer!.status, 'DISCOVERED');
  assert.deepEqual(loginLayer!.screenIds, ['SCREEN-001']);
  assertNoDemoHosts(coverage);
});

test('unknown authentication evidence is not classified as public', () => {
  const coverage = buildAuthenticatedCoverage({
    screens: [
      {
        id: 'SCREEN-001',
        url: 'http://app.test/mystery',
        state: 'default',
        authenticationRequired: false,
        authenticationEvidence: 'unknown',
      },
    ],
    pages: [{ url: 'http://app.test/mystery', status: 200 }],
    session: { established: false },
  });

  assert.deepEqual(coverage.publicScreenIds, []);
  const publicLayer = coverage.layers.find((l) => l.gate === 'public');
  assert.deepEqual(publicLayer?.screenIds, []);
  const loginLayer = coverage.layers.find((l) => l.gate === 'login');
  assert.equal(loginLayer?.status, 'NOT_TESTED');
  assert.match(loginLayer?.reason ?? '', /authentication requirement was not determined/);
  assert.deepEqual(loginLayer?.screenIds, ['SCREEN-001']);
  assertNoDemoHosts(coverage);
});

test('production + authorizeAuthenticatedDiscovery false → role layer BLOCKED', () => {
  const coverage = buildAuthenticatedCoverage({
    screens: [
      {
        id: 'SCREEN-001',
        url: 'http://app.test/',
        state: 'default',
        authenticationRequired: false,
        authenticationEvidence: 'public',
      },
      {
        id: 'SCREEN-002',
        url: 'http://app.test/app',
        state: 'authenticated',
        authenticationRequired: false,
        authenticationEvidence: 'authenticated',
      },
    ],
    pages: [
      { url: 'http://app.test/', access: 'public', status: 200 },
      {
        url: 'http://app.test/app',
        access: 'authenticated',
        status: 200,
        metadata: { role: 'User' },
      },
    ],
    session: { established: true, roles: ['User'] },
    environment: 'production',
    authorizeAuthenticatedDiscovery: false,
  });

  const roleLayer = coverage.layers.find((l) => l.gate === 'role' && l.key === 'User');
  assert.ok(roleLayer);
  assert.equal(roleLayer!.status, 'BLOCKED');
  assert.match(roleLayer!.reason, /not authorized against production/);
  assert.deepEqual(roleLayer!.screenIds, []);
  assert.deepEqual(coverage.publicScreenIds, ['SCREEN-001']);
  assert.equal(coverage.layers.some((l) => l.key === 'Admin'), false);
  assertNoDemoHosts(coverage);
});

test('does not invent /admin or /dashboard unless present in input pages', () => {
  const coverage = buildAuthenticatedCoverage({
    screens: [
      {
        id: 'SCREEN-001',
        url: 'http://app.test/',
        state: 'default',
        authenticationRequired: false,
        authenticationEvidence: 'public',
      },
    ],
    pages: [{ url: 'http://app.test/', access: 'public', status: 200 }],
    session: { established: true, roles: ['User', 'Admin', 'Super Admin'] },
  });

  const blob = JSON.stringify(coverage);
  assert.equal(/\/admin/i.test(blob), false);
  assert.equal(/\/dashboard/i.test(blob), false);
  // Keys may appear when supplied — URLs must not.
  assert.ok(coverage.layers.some((l) => l.gate === 'role' && l.key === 'Admin'));
  assert.ok(coverage.layers.some((l) => l.gate === 'role' && l.key === 'Super Admin'));
  for (const layer of coverage.layers) {
    for (const id of layer.screenIds) {
      assert.equal(id.startsWith('SCREEN-'), true);
    }
  }
  assertNoDemoHosts(coverage);
  assertNoSecrets(coverage);
});

test('configuredRoleKeys returns only supplied role keys — never invents Admin', () => {
  const empty = buildAuthenticatedCoverage({
    screens: [],
    pages: [],
    session: null,
  });
  assert.deepEqual(configuredRoleKeys(empty), []);
  assert.equal(configuredRoleKeys(empty).includes('Admin'), false);

  const withRoles = buildAuthenticatedCoverage({
    screens: [
      {
        id: 'SCREEN-001',
        url: 'http://app.test/',
        state: 'authenticated',
        authenticationEvidence: 'authenticated',
      },
    ],
    pages: [{ url: 'http://app.test/', access: 'authenticated', status: 200 }],
    session: { established: true, roles: ['User'] },
  });
  assert.deepEqual(configuredRoleKeys(withRoles), ['User']);
  assert.equal(configuredRoleKeys(withRoles).includes('Admin'), false);
  assert.equal(configuredRoleKeys(withRoles).includes('Manager'), false);
  assert.equal(configuredRoleKeys(withRoles).includes('Viewer'), false);
});

test('source has ACCESS_LAYER_EXAMPLE as comment only and no demo hosts', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'scripts', 'discovery', 'authenticated-coverage.ts'),
    'utf8'
  );
  assert.match(src, /Access-layer example/);
  assert.match(src, /Public → Login → User → Admin → Super Admin/);
  assert.doesNotMatch(src, /export const ACCESS_LAYER_EXAMPLE/);
  assert.doesNotMatch(src, /saucedemo|jsonplaceholder|swag\s*labs/i);
});
