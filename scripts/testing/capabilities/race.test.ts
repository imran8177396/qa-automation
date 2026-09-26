/**
 * Deterministic unit tests for in-memory race checks.
 * Fixed interleavings only — no Date.now ordering, no random, no retries that hide FAIL.
 * Does not run live concurrency, HTTP, database, or payment providers.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../../lib/paths';
import {
  RACE_CHECK_IDS,
  findWaitForCycle,
  formatInterleavingEvidence,
  planRace,
  runRaceChecks,
  type RaceScenario,
} from './race';

function byId(results: ReturnType<typeof runRaceChecks>) {
  return Object.fromEntries(results.map((r) => [r.id, r]));
}

function reasonOf(row: { metadata?: Record<string, unknown>; error?: { message?: string } }): string {
  return String(row.metadata?.reason ?? row.error?.message ?? '');
}

test('planRace remains NOT_IMPLEMENTED for live simultaneous operations', () => {
  const plan = planRace();
  assert.equal(plan.status, 'NOT_IMPLEMENTED');
  assert.match(plan.reason, /simultaneous operations are not started/i);
});

test('disabled → NOT_APPLICABLE race:not-enabled', () => {
  const results = runRaceChecks({ enabled: false });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, RACE_CHECK_IDS.notEnabled);
  assert.equal(results[0]?.status, 'NOT_APPLICABLE');
  assert.match(reasonOf(results[0]!), /not enabled/i);
});

test('enabled + missing body → NOT_TESTED (no invented schedule)', () => {
  const results = runRaceChecks({ enabled: true });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, RACE_CHECK_IDS.scenario);
  assert.equal(results[0]?.status, 'NOT_TESTED');
  assert.match(reasonOf(results[0]!), /no interleaving/i);
});

test('enabled + empty interleaving → NOT_TESTED', () => {
  const results = runRaceChecks({
    enabled: true,
    scenario: {
      kind: 'two-requests-create-same-entity',
      interleaving: [],
    },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, 'NOT_TESTED');
});

test('duplicate creates without reject → FAIL with interleaving evidence', () => {
  const scenario: RaceScenario = {
    kind: 'two-requests-create-same-entity',
    interleaving: [
      { actorId: 'A', op: 'create', resourceId: 'entity-1', value: { id: 'entity-1' }, attemptId: 'A-create' },
      { actorId: 'B', op: 'create', resourceId: 'entity-1', value: { id: 'entity-1' }, attemptId: 'B-create' },
    ],
  };
  const results = byId(runRaceChecks({ enabled: true, scenario }));
  const row = results[RACE_CHECK_IDS.duplicateRecords]!;
  assert.equal(row.status, 'FAIL');
  assert.match(reasonOf(row), /A-create/);
  assert.match(reasonOf(row), /B-create/);
  assert.match(reasonOf(row), /interleaving=/);
  assert.ok(String(row.metadata?.interleaving ?? '').length > 0);
});

test('duplicate creates with rejectDuplicateCreates → PASS with rejection evidence', () => {
  const scenario: RaceScenario = {
    kind: 'two-requests-create-same-entity',
    model: { rejectDuplicateCreates: true },
    interleaving: [
      { actorId: 'A', op: 'create', resourceId: 'entity-1', attemptId: 'A-create' },
      { actorId: 'B', op: 'create', resourceId: 'entity-1', attemptId: 'B-create' },
    ],
  };
  const results = byId(runRaceChecks({ enabled: true, scenario }));
  const row = results[RACE_CHECK_IDS.duplicateRecords]!;
  assert.equal(row.status, 'PASS');
  assert.match(reasonOf(row), /rejected/i);
  assert.match(reasonOf(row), /interleaving=/);
});

test('lost update: both read N then both write without conflict detection → FAIL', () => {
  const scenario: RaceScenario = {
    kind: 'two-users-update-same-resource',
    interleaving: [
      { actorId: 'A', op: 'read', resourceId: 'res-1', version: 1 },
      { actorId: 'B', op: 'read', resourceId: 'res-1', version: 1 },
      { actorId: 'A', op: 'write', resourceId: 'res-1', value: { status: 'A' }, attemptId: 'A-write' },
      { actorId: 'B', op: 'write', resourceId: 'res-1', value: { status: 'B' }, attemptId: 'B-write' },
    ],
  };
  // Seed: first write establishes version 1→2, second silently drops first.
  // Pre-create so read versions are meaningful against current.
  const seeded: RaceScenario = {
    ...scenario,
    interleaving: [
      { actorId: 'seed', op: 'create', resourceId: 'res-1', version: 1, value: { status: 'init' }, attemptId: 'seed' },
      ...scenario.interleaving,
    ],
  };
  const results = byId(runRaceChecks({ enabled: true, scenario: seeded }));
  const row = results[RACE_CHECK_IDS.lostUpdates]!;
  assert.equal(row.status, 'FAIL');
  assert.match(reasonOf(row), /dropped write/i);
  assert.match(reasonOf(row), /A-write/);
  assert.match(reasonOf(row), /interleaving=/);
});

test('lost update with detectVersionConflicts → PASS', () => {
  const scenario: RaceScenario = {
    kind: 'two-users-update-same-resource',
    model: { detectVersionConflicts: true },
    interleaving: [
      { actorId: 'seed', op: 'create', resourceId: 'res-1', version: 1, value: { status: 'init' }, attemptId: 'seed' },
      { actorId: 'A', op: 'read', resourceId: 'res-1', version: 1 },
      { actorId: 'B', op: 'read', resourceId: 'res-1', version: 1 },
      { actorId: 'A', op: 'write', resourceId: 'res-1', value: { status: 'A' }, attemptId: 'A-write' },
      { actorId: 'B', op: 'write', resourceId: 'res-1', value: { status: 'B' }, attemptId: 'B-write' },
    ],
  };
  const results = byId(runRaceChecks({ enabled: true, scenario }));
  const row = results[RACE_CHECK_IDS.lostUpdates]!;
  assert.equal(row.status, 'PASS');
  assert.match(reasonOf(row), /conflict/i);
  assert.match(reasonOf(row), /interleaving=/);
});

test('lost update without versions → NOT_TESTED', () => {
  const scenario: RaceScenario = {
    kind: 'two-workers-process-same-job',
    interleaving: [
      { actorId: 'W1', op: 'process', resourceId: 'job-1', value: { done: true } },
      { actorId: 'W2', op: 'process', resourceId: 'job-1', value: { done: true } },
    ],
  };
  const results = byId(runRaceChecks({ enabled: true, scenario }));
  assert.equal(results[RACE_CHECK_IDS.lostUpdates]?.status, 'NOT_TESTED');
  assert.match(reasonOf(results[RACE_CHECK_IDS.lostUpdates]!), /versions were not supplied/i);
});

test('deadlock cycle → FAIL with cycle in reason', () => {
  const scenario: RaceScenario = {
    kind: 'two-payments-submitted-simultaneously',
    waitForEdges: [
      { waiter: 'A', waitsFor: 'B' },
      { waiter: 'B', waitsFor: 'A' },
    ],
    interleaving: [
      { actorId: 'A', op: 'wait', waitForActorId: 'B' },
      { actorId: 'B', op: 'wait', waitForActorId: 'A' },
    ],
  };
  const results = byId(runRaceChecks({ enabled: true, scenario }));
  const row = results[RACE_CHECK_IDS.deadlocks]!;
  assert.equal(row.status, 'FAIL');
  assert.match(reasonOf(row), /cycle/i);
  assert.match(reasonOf(row), /A/);
  assert.match(reasonOf(row), /B/);
});

test('deadlock with no wait-for edges → NOT_TESTED', () => {
  const scenario: RaceScenario = {
    kind: 'two-users-update-same-resource',
    interleaving: [
      { actorId: 'A', op: 'read', resourceId: 'r', version: 1 },
      { actorId: 'B', op: 'read', resourceId: 'r', version: 1 },
    ],
  };
  const results = byId(runRaceChecks({ enabled: true, scenario }));
  assert.equal(results[RACE_CHECK_IDS.deadlocks]?.status, 'NOT_TESTED');
  assert.match(reasonOf(results[RACE_CHECK_IDS.deadlocks]!), /no wait-for edges/i);
});

test('findWaitForCycle returns null for acyclic graph', () => {
  assert.equal(findWaitForCycle([{ waiter: 'A', waitsFor: 'B' }]), null);
});

test('inconsistent state without invariant → NOT_TESTED', () => {
  const scenario: RaceScenario = {
    kind: 'two-payments-submitted-simultaneously',
    interleaving: [
      { actorId: 'A', op: 'create', resourceId: 'pay-1', value: { balance: 10 } },
    ],
  };
  const results = byId(runRaceChecks({ enabled: true, scenario }));
  assert.equal(results[RACE_CHECK_IDS.inconsistentState]?.status, 'NOT_TESTED');
});

test('inconsistent state invariant violation → FAIL', () => {
  const scenario: RaceScenario = {
    kind: 'two-payments-submitted-simultaneously',
    invariant: { field: 'balance', min: 0 },
    interleaving: [
      { actorId: 'A', op: 'create', resourceId: 'acct', value: { balance: -5 } },
    ],
  };
  const results = byId(runRaceChecks({ enabled: true, scenario }));
  assert.equal(results[RACE_CHECK_IDS.inconsistentState]?.status, 'FAIL');
  assert.match(reasonOf(results[RACE_CHECK_IDS.inconsistentState]!), /invariant violated/i);
});

test('inconsistent state invariant holds → PASS', () => {
  const scenario: RaceScenario = {
    kind: 'two-payments-submitted-simultaneously',
    invariant: { field: 'balance', equals: 10 },
    interleaving: [
      { actorId: 'A', op: 'create', resourceId: 'acct', value: { balance: 10 } },
    ],
  };
  const results = byId(runRaceChecks({ enabled: true, scenario }));
  assert.equal(results[RACE_CHECK_IDS.inconsistentState]?.status, 'PASS');
});

test('race vs sequential: create interleaving that differs from actor-sequential → FAIL', () => {
  // Sequential (actor order): seed, A read+write, B read+write — B reads after A, no drop.
  // Interleaved: both read v1 then write — A's write is dropped.
  const scenario: RaceScenario = {
    kind: 'two-users-update-same-resource',
    interleaving: [
      { actorId: 'seed', op: 'create', resourceId: 'res-1', version: 1, value: { status: 'init' }, attemptId: 'seed' },
      { actorId: 'A', op: 'read', resourceId: 'res-1', version: 1 },
      { actorId: 'B', op: 'read', resourceId: 'res-1', version: 1 },
      { actorId: 'A', op: 'write', resourceId: 'res-1', value: { status: 'A' }, attemptId: 'A-write' },
      { actorId: 'B', op: 'write', resourceId: 'res-1', value: { status: 'B' }, attemptId: 'B-write' },
    ],
  };
  const results = byId(runRaceChecks({ enabled: true, scenario }));
  const row = results[RACE_CHECK_IDS.raceConditions]!;
  assert.equal(row.status, 'FAIL');
  assert.match(reasonOf(row), /interleaved=/i);
  assert.match(reasonOf(row), /sequential=/i);
  assert.ok(row.metadata?.interleavedFingerprint);
  assert.ok(row.metadata?.sequentialFingerprint);
  assert.notEqual(row.metadata?.interleavedFingerprint, row.metadata?.sequentialFingerprint);
});

test('formatInterleavingEvidence is stable for fixed steps', () => {
  const ev = formatInterleavingEvidence([
    { actorId: 'A', op: 'read', resourceId: 'r', version: 1 },
    { actorId: 'B', op: 'write', resourceId: 'r' },
  ]);
  assert.equal(ev, '0:A.read(r)@v1 | 1:B.write(r)');
});

test('PR workflow file text does not contain test:race', () => {
  const workflowPath = path.join(ROOT, '.github', 'workflows', 'qa-automation.yml');
  const text = fs.readFileSync(workflowPath, 'utf8');
  assert.equal(text.includes('test:race'), false);
});

test('source does not call setTimeout, import worker_threads, or use Math.random/Date.now', () => {
  const source = fs.readFileSync(path.join(__dirname, 'race.ts'), 'utf8');
  assert.equal(/setTimeout\s*\(/.test(source), false);
  assert.equal(/from ['"]node:worker_threads['"]/.test(source), false);
  assert.equal(/require\(['"]worker_threads['"]\)/.test(source), false);
  assert.equal(/Math\.random\s*\(/.test(source), false);
  assert.equal(/Date\.now\s*\(/.test(source), false);
});
