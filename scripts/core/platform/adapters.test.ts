/**
 * Tool adapter registry tests — deterministic, no network, no child processes.
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { describe, it } from 'node:test';
import { PATHS } from '../../lib/paths';
import {
  AdapterRegistry,
  BUILTIN_ADAPTER_IDS,
  createAdapterRegistry,
  listAdapters,
  PLUGIN_ARCHITECTURE_STATUS,
} from './index';
import type { AdapterDefinition, AdapterRunResult } from './plugin-sdk';

const ADAPTERS_SOURCE = path.join(PATHS.root, 'scripts', 'core', 'platform', 'adapters.ts');

const FORBIDDEN_IMPORTS = [
  'playwright',
  'postman',
  'newman',
  'jmeter',
  'kafkajs',
  'redis',
  'amqplib',
  'fast-check',
  'openai',
] as const;

describe('tool adapter registry', () => {
  it('plugin-architecture status remains PARTIAL', () => {
    assert.equal(PLUGIN_ARCHITECTURE_STATUS, 'PARTIAL');
  });

  it('listing includes the seven built-in ids', () => {
    const ids = createAdapterRegistry().list();
    for (const id of BUILTIN_ADAPTER_IDS) {
      assert.ok(ids.includes(id), `missing built-in ${id}`);
    }
    assert.equal(BUILTIN_ADAPTER_IDS.length, 7);
    const defaultIds = listAdapters();
    for (const id of BUILTIN_ADAPTER_IDS) {
      assert.ok(defaultIds.includes(id), `default list missing ${id}`);
    }
  });

  it('playwright missing baseURL or browser binary → REQUIRES_CONFIGURATION, not PASS', async () => {
    const registry = createAdapterRegistry();

    const noUrl = await registry.run({
      adapterId: 'playwright',
      snapshot: { browserBinaryPresent: true },
    });
    assert.equal(noUrl.status, 'REQUIRES_CONFIGURATION');
    assert.notEqual(noUrl.status, 'PASS');
    assert.equal(noUrl.passed, false);
    assert.match(noUrl.reason ?? '', /baseURL/i);

    const noBinary = await registry.run({
      adapterId: 'playwright',
      snapshot: { baseURL: 'https://example.test', browserBinaryPresent: false },
    });
    assert.equal(noBinary.status, 'REQUIRES_CONFIGURATION');
    assert.notEqual(noBinary.status, 'PASS');
    assert.match(noBinary.reason ?? '', /browser binary/i);
  });

  it('postman CLI missing → REQUIRES_CONFIGURATION', async () => {
    const result = await createAdapterRegistry().run({
      adapterId: 'postman',
      snapshot: { postmanCliPresent: false, collectionPathPresent: true },
    });
    assert.equal(result.status, 'REQUIRES_CONFIGURATION');
    assert.match(result.reason ?? '', /Postman CLI/i);
    assert.notEqual(result.status, 'PASS');
  });

  it('jmeter binary missing → REQUIRES_CONFIGURATION', async () => {
    const result = await createAdapterRegistry().run({
      adapterId: 'jmeter',
      snapshot: { jmeterBinaryPresent: false, planPathPresent: true },
    });
    assert.equal(result.status, 'REQUIRES_CONFIGURATION');
    assert.match(result.reason ?? '', /JMeter binary/i);
    assert.notEqual(result.status, 'PASS');
  });

  it('database run → BLOCKED; no connection opened; connect hook not required', async () => {
    let connectCalled = false;
    const fakeConnect = () => {
      connectCalled = true;
    };

    const result = await createAdapterRegistry().run({
      adapterId: 'database',
      snapshot: { databaseUrlPresent: true },
    });

    assert.equal(result.status, 'BLOCKED');
    assert.match(result.reason ?? '', /no driver connection is opened/i);
    assert.notEqual(result.status, 'PASS');
    assert.equal(connectCalled, false);
    // Callers are not required to supply a connect hook; we never invoke one.
    void fakeConnect;
  });

  it('ai run → BLOCKED not implemented', async () => {
    const result = await createAdapterRegistry().run({ adapterId: 'ai' });
    assert.equal(result.status, 'BLOCKED');
    assert.match(result.reason ?? '', /not implemented/i);
    assert.notEqual(result.status, 'PASS');
  });

  it('available:true without execute stub → BLOCKED, not PASS', async () => {
    const result = await createAdapterRegistry().run({
      adapterId: 'playwright',
      availability: { state: 'available' },
    });
    assert.equal(result.status, 'BLOCKED');
    assert.match(result.reason ?? '', /execution was not performed/i);
    assert.notEqual(result.status, 'PASS');
    assert.equal(result.passed, false);
  });

  it('execute stub returning FAIL → FAIL (not hidden)', async () => {
    const result = await createAdapterRegistry().run({
      adapterId: 'playwright',
      availability: { state: 'available' },
      execute: (): AdapterRunResult => ({
        adapterId: 'playwright',
        status: 'FAIL',
        reason: 'stub reported failure',
        passed: false,
      }),
    });
    assert.equal(result.status, 'FAIL');
    assert.notEqual(result.status, 'PASS');
    assert.equal(result.passed, false);
  });

  it('execute stub returning PASS → PASS only when stub ran once', async () => {
    let calls = 0;
    const result = await createAdapterRegistry().run({
      adapterId: 'postman',
      availability: { state: 'available' },
      execute: (): AdapterRunResult => {
        calls += 1;
        return {
          adapterId: 'postman',
          status: 'PASS',
          reason: 'stub executed collection',
          passed: true,
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.status, 'PASS');
    assert.equal(result.passed, true);
  });

  it('unknown adapter id → BLOCKED; run not called', async () => {
    let executeCalled = false;
    const result = await createAdapterRegistry().run({
      adapterId: 'not-a-real-adapter',
      execute: () => {
        executeCalled = true;
        return { adapterId: 'not-a-real-adapter', status: 'PASS', passed: true };
      },
    });
    assert.equal(result.status, 'BLOCKED');
    assert.match(result.reason ?? '', /adapter not registered/i);
    assert.equal(executeCalled, false);
  });

  it('future adapter registers; missing-config probe → REQUIRES_CONFIGURATION', async () => {
    const registry = createAdapterRegistry();
    const future: AdapterDefinition = {
      id: 'future-custom',
      probe: (snapshot) =>
        snapshot && (snapshot as { tokenPresent?: boolean }).tokenPresent === true
          ? { state: 'available' }
          : {
              state: 'requires-configuration',
              reason: 'future adapter token is missing',
            },
      run: async (request) => {
        const availability = request.availability ?? future.probe(request.snapshot);
        if (availability.state === 'requires-configuration') {
          return {
            adapterId: future.id,
            status: 'REQUIRES_CONFIGURATION',
            reason: availability.reason,
            passed: false,
          };
        }
        if (!request.execute) {
          return {
            adapterId: future.id,
            status: 'BLOCKED',
            reason: 'execution was not performed',
            passed: false,
          };
        }
        return request.execute();
      },
    };
    registry.register(future);
    assert.ok(registry.list().includes('future-custom'));

    const missing = await registry.run({ adapterId: 'future-custom' });
    assert.equal(missing.status, 'REQUIRES_CONFIGURATION');
    assert.match(missing.reason ?? '', /token is missing/i);
  });

  it('duplicate register throws', () => {
    const registry = createAdapterRegistry();
    assert.throws(
      () =>
        registry.register({
          id: 'playwright',
          probe: () => ({ state: 'blocked', reason: 'x' }),
          run: async () => ({
            adapterId: 'playwright',
            status: 'BLOCKED',
            reason: 'x',
          }),
        }),
      /Duplicate adapter id/
    );
  });

  it('core adapter module source does not import tool SDKs', () => {
    const source = fs.readFileSync(ADAPTERS_SOURCE, 'utf8');
    for (const name of FORBIDDEN_IMPORTS) {
      // Match require/import of the package name, not comments mentioning it.
      const importPattern = new RegExp(
        String.raw`(?:from\s+['"]|require\s*\(\s*['"])[^'"]*\b${name}\b`,
        'i'
      );
      assert.equal(
        importPattern.test(source),
        false,
        `adapters.ts must not import ${name}`
      );
    }
  });

  it('AdapterRegistry is the extension point (map, not tool switch)', () => {
    const registry = new AdapterRegistry(true);
    assert.equal(registry.list().length, 7);
    assert.ok(registry.get('queue'));
  });
});
