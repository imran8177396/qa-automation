import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEST_TYPE_IDS } from './types';
import {
  TEST_TYPE_REGISTRY,
  assertRegistryComplete,
  getTestType,
  listImplementedTestTypes,
  listTestTypesByCategory,
} from './registry';

const REQUIRED_IDS = [
  'functional',
  'integration',
  'contract',
  'database',
  'api',
  'ui',
  'e2e',
  'workflow',
  'unit',
  'smoke',
  'sanity',
  'regression',
  'performance',
  'baseline',
  'load',
  'stress',
  'spike',
  'endurance',
  'volume',
  'scalability',
  'security',
  'accessibility',
  'visual',
  'responsive',
  'compatibility',
  'localization',
  'reliability',
  'resilience',
  'failover',
  'recovery',
  'deployment',
  'rollback',
  'configuration',
  'ai',
  'llm',
  'rag',
  'agent',
  'ai-safety',
  'prompt-injection',
  'multi-tenant',
  'webhook',
  'queue',
  'property',
  'mutation',
  'race',
  'backup-restore',
  'privacy',
] as const;

test('registry registers every required id exactly once', () => {
  assertRegistryComplete();
  assert.equal(TEST_TYPE_REGISTRY.length, REQUIRED_IDS.length);
  assert.deepEqual([...TEST_TYPE_IDS], [...REQUIRED_IDS]);

  const seen = new Set<string>();
  for (const row of TEST_TYPE_REGISTRY) {
    assert.equal(seen.has(row.id), false, `duplicate registry id: ${row.id}`);
    seen.add(row.id);
  }
  for (const id of REQUIRED_IDS) {
    assert.equal(seen.has(id), true, `missing registry id: ${id}`);
  }
});

test('getTestType(api) is IMPLEMENTED', () => {
  const api = getTestType('api');
  assert.ok(api);
  assert.equal(api.status, 'IMPLEMENTED');
  assert.equal(api.npmScript, 'test:api');
});

test('getTestType(database) is PARTIAL — adapters not wired even when configured', () => {
  const database = getTestType('database');
  assert.ok(database);
  assert.equal(database.status, 'PARTIAL');
  assert.equal(database.npmScript, 'test:database');
  assert.match(database.note ?? '', /adapter/i);
});

test('phase 1 runners that execute safe checks are IMPLEMENTED; regression stays PARTIAL', () => {
  for (const id of ['integration', 'contract', 'smoke', 'sanity'] as const) {
    const row = getTestType(id);
    assert.ok(row, id);
    assert.equal(row.status, 'IMPLEMENTED', id);
  }
  assert.equal(getTestType('regression')?.status, 'PARTIAL');
});

test('getTestType(ai) is PARTIAL (optional engine)', () => {
  const ai = getTestType('ai');
  assert.ok(ai);
  assert.equal(ai.status, 'PARTIAL');
  assert.equal(ai.npmScript, 'test:ai');
  assert.match(ai.description, /not required for web QA/i);
});

test('llm/rag/agent are PARTIAL; ai-safety and prompt-injection stay NOT_IMPLEMENTED', () => {
  for (const id of ['llm', 'rag', 'agent'] as const) {
    const row = getTestType(id);
    assert.ok(row);
    assert.equal(row.status, 'PARTIAL', id);
    assert.equal(row.npmScript, 'test:ai', id);
  }
  assert.equal(getTestType('ai-safety')?.status, 'NOT_IMPLEMENTED');
  assert.equal(getTestType('prompt-injection')?.status, 'NOT_IMPLEMENTED');
});

test('getTestType(multi-tenant) is PARTIAL (optional; not assumed for every app)', () => {
  const row = getTestType('multi-tenant');
  assert.ok(row);
  assert.equal(row.status, 'PARTIAL');
  assert.equal(row.npmScript, 'test:multi-tenant');
  assert.match(row.description, /optional/i);
  assert.match(row.description, /not assumed for every application/i);
});

test('getTestType(webhook) is PARTIAL (optional; no live receiver)', () => {
  const row = getTestType('webhook');
  assert.ok(row);
  assert.equal(row.status, 'PARTIAL');
  assert.equal(row.npmScript, 'test:webhook');
  assert.match(row.description, /optional/i);
  assert.match(row.description, /no live receiver/i);
});

test('getTestType(queue) is PARTIAL (optional; generic in-memory; brokers not implemented)', () => {
  const row = getTestType('queue');
  assert.ok(row);
  assert.equal(row.status, 'PARTIAL');
  assert.equal(row.npmScript, 'test:queue');
  assert.match(row.description, /generic in-memory/i);
  assert.match(row.description, /not implemented/i);
});

test('getTestType(property) is PARTIAL (sample adapter; not a PBT framework)', () => {
  const row = getTestType('property');
  assert.ok(row);
  assert.equal(row.status, 'PARTIAL');
  assert.equal(row.npmScript, 'test:property');
  assert.match(row.description, /caller-supplied samples/i);
  assert.match(row.description, /fast-check is not installed/i);
  assert.match(row.description, /not a property-testing framework/i);
});

test('getTestType(mutation) is PARTIAL (in-memory; file mutation and suite re-run not implemented)', () => {
  const row = getTestType('mutation');
  assert.ok(row);
  assert.equal(row.status, 'PARTIAL');
  assert.equal(row.npmScript, 'test:mutation');
  assert.match(row.description, /in-memory mutants/i);
  assert.match(row.description, /caller-supplied detection/i);
  assert.match(row.description, /not part of the default PR suite/i);
});

test('getTestType(race) is PARTIAL (in-memory interleavings; live multi-process races not executed)', () => {
  const row = getTestType('race');
  assert.ok(row);
  assert.equal(row.status, 'PARTIAL');
  assert.equal(row.npmScript, 'test:race');
  assert.match(row.description, /in-memory/i);
  assert.match(row.description, /live multi-process races are not executed/i);
  assert.notEqual(row.status, 'IMPLEMENTED');
});

test('getTestType(backup-restore) is PARTIAL (evidence-only; live backup/restore not executed; production never deleted)', () => {
  const row = getTestType('backup-restore');
  assert.ok(row);
  assert.equal(row.status, 'PARTIAL');
  assert.equal(row.npmScript, 'test:backup-restore');
  assert.match(row.description, /live backup\/restore is not executed/i);
  assert.match(row.description, /production data is never deleted/i);
  assert.notEqual(row.status, 'IMPLEMENTED');
});

test('getTestType(privacy) is PARTIAL (evidence-only; live deletion/retention/export not executed)', () => {
  const row = getTestType('privacy');
  assert.ok(row);
  assert.equal(row.status, 'PARTIAL');
  assert.equal(row.npmScript, 'test:privacy');
  assert.match(row.description, /live deletion, retention enforcement, and export jobs are not executed/i);
  assert.notEqual(row.status, 'IMPLEMENTED');
});

test('unknown id does not silently count as implemented', () => {
  const unknown = getTestType('not-a-real-test-type');
  // Unknown lookups must not invent an IMPLEMENTED row.
  assert.equal(unknown?.status, undefined);
  assert.equal(unknown, undefined);
});

test('listImplementedTestTypes excludes ai, llm, and rag', () => {
  const implemented = listImplementedTestTypes();
  const ids = new Set(implemented.map((row) => row.id));
  assert.equal(ids.has('ai'), false);
  assert.equal(ids.has('llm'), false);
  assert.equal(ids.has('rag'), false);
  for (const row of implemented) {
    assert.equal(row.status, 'IMPLEMENTED');
  }
});

test('listTestTypesByCategory returns only that category', () => {
  const performance = listTestTypesByCategory('performance');
  assert.ok(performance.length > 0);
  for (const row of performance) {
    assert.equal(row.category, 'performance');
  }
  assert.ok(performance.some((row) => row.id === 'load'));
});
