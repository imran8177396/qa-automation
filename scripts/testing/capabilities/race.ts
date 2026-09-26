/**
 * Optional race-condition / concurrency architecture (PARTIAL).
 *
 * Honest limits:
 * - This does not run the application under real concurrency.
 * - This does not prove absence of races in production.
 * - Timing-based tests are not part of the default suite.
 * - No database, no HTTP, no payment provider.
 *
 * Detection uses an explicit caller-supplied interleaving (ordered steps), not
 * random scheduling, threads, timers, or Promise races. Live multi-process
 * races are not executed — see planRace().
 */

import {
  makeResult,
  type EngineResultStatus,
  type TestResult,
} from '../../core/engine-contract';

/** Live simultaneous operations stay refused. */
export interface RacePlan {
  status: 'NOT_IMPLEMENTED';
  reason: string;
}

const LIVE_RACE_REASON =
  'live race-condition testing is not implemented; simultaneous operations are not started; timing-based tests are not part of the default suite';

/**
 * Refuse starting real concurrent / timed operations against a target.
 * In-memory deterministic checks live in runRaceChecks().
 */
export function planRace(): RacePlan {
  return { status: 'NOT_IMPLEMENTED', reason: LIVE_RACE_REASON };
}

export const RACE_SCENARIO_KINDS = [
  'two-users-update-same-resource',
  'two-payments-submitted-simultaneously',
  'two-workers-process-same-job',
  'two-requests-create-same-entity',
] as const;

export type RaceScenarioKind = (typeof RACE_SCENARIO_KINDS)[number];

export type RaceStepOp = 'read' | 'write' | 'create' | 'process' | 'wait';

/**
 * One ordered step in a deterministic interleaving.
 * No timers — order is entirely caller-supplied.
 */
export interface RaceStep {
  actorId: string;
  op: RaceStepOp;
  /** Shared resource / entity / job id. */
  resourceId?: string;
  /** Version observed (read) or intended base (write). Required for lost-update checks. */
  version?: number;
  /** Value written / created / processed. */
  value?: unknown;
  /** Explicit wait-for edge when op is wait (waiter = actorId). */
  waitForActorId?: string;
  /** Attempt label for evidence (defaults to actorId+op index). */
  attemptId?: string;
}

export interface RaceWaitForEdge {
  /** Actor that is waiting. */
  waiter: string;
  /** Actor being waited on. */
  waitsFor: string;
}

/**
 * Explicit final-state invariant — never invent business rules.
 * Example: { field: 'count', equals: 1 } or { field: 'balance', min: 0 }.
 */
export interface RaceInvariant {
  field: string;
  equals?: unknown;
  min?: number;
  max?: number;
}

export interface RaceModelOptions {
  /**
   * When true, a second create of an existing entityId is rejected (recorded).
   * When false/omitted, the model keeps both records (duplicate → FAIL).
   */
  rejectDuplicateCreates?: boolean;
  /**
   * When true, a write whose read version does not match current is rejected.
   * When false/omitted, the later write silently overwrites (lost update → FAIL).
   */
  detectVersionConflicts?: boolean;
}

export interface RaceScenario {
  kind: RaceScenarioKind;
  /** Ordered interleaving — required. Empty / missing → NOT_TESTED. */
  interleaving: RaceStep[];
  /** Optional wait-for graph for deadlock detection. */
  waitForEdges?: RaceWaitForEdge[];
  /** Optional invariant on the final generic record fields. */
  invariant?: RaceInvariant;
  model?: RaceModelOptions;
}

export interface RunRaceChecksInput {
  enabled: boolean;
  scenario?: RaceScenario;
}

export const RACE_CHECK_IDS = {
  notEnabled: 'race:not-enabled',
  scenario: 'race:scenario',
  duplicateRecords: 'race:duplicate-records',
  lostUpdates: 'race:lost-updates',
  deadlocks: 'race:deadlocks',
  inconsistentState: 'race:inconsistent-state',
  raceConditions: 'race:race-conditions',
} as const;

const TEST_TYPE = 'race';
const CATEGORY = 'advanced';

const LIMITS_NOTE =
  'in-memory model only — does not run the application under real concurrency; does not prove absence of races in production; no database, no HTTP, no payment provider';

interface StoredRecord {
  entityId: string;
  version: number;
  value: unknown;
  attemptId: string;
  fields: Record<string, unknown>;
}

interface ModelOutcome {
  records: StoredRecord[];
  /** entityId → current version after successful writes/creates. */
  currentVersion: Map<string, number>;
  rejected: string[];
  droppedWrites: string[];
  waitEdges: RaceWaitForEdge[];
  /** Snapshot fingerprint for race-vs-sequential comparison. */
  fingerprint: string;
}

function raceResult(
  id: string,
  name: string,
  status: EngineResultStatus,
  options: {
    reason?: string;
    assertion?: { expected?: unknown; actual?: unknown };
    metadata?: Record<string, unknown>;
  } = {}
): TestResult {
  const reason = options.reason;
  return makeResult({
    id,
    testType: TEST_TYPE,
    category: CATEGORY,
    name,
    status,
    ...(options.assertion ? { assertion: options.assertion } : {}),
    ...(reason
      ? { error: { message: reason }, metadata: { ...(options.metadata ?? {}), reason } }
      : options.metadata
        ? { metadata: options.metadata }
        : {}),
  });
}

/** Stable evidence string for the supplied step order. */
export function formatInterleavingEvidence(steps: RaceStep[]): string {
  return steps
    .map((s, i) => {
      const rid = s.resourceId ?? '-';
      const ver = s.version !== undefined ? `@v${s.version}` : '';
      const wait = s.waitForActorId ? `→${s.waitForActorId}` : '';
      return `${i}:${s.actorId}.${s.op}(${rid})${ver}${wait}`;
    })
    .join(' | ');
}

function stepAttemptId(step: RaceStep, index: number): string {
  return step.attemptId ?? `${step.actorId}:${step.op}:${index}`;
}

function fieldsFromValue(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  if (value !== undefined) {
    return { value };
  }
  return {};
}

function fingerprintState(
  records: StoredRecord[],
  rejected: string[],
  droppedWrites: string[]
): string {
  const sorted = [...records]
    .map((r) => `${r.entityId}#${r.version}:${JSON.stringify(r.value)}:${r.attemptId}`)
    .sort();
  return JSON.stringify({
    records: sorted,
    rejected: [...rejected].sort(),
    droppedWrites: [...droppedWrites].sort(),
  });
}

/**
 * Apply an ordered interleaving against an in-memory store.
 * Deterministic — no Date, Math.random, setTimeout, workers, or real locks.
 */
export function applyInterleaving(
  steps: RaceStep[],
  model: RaceModelOptions = {},
  extraWaitEdges: RaceWaitForEdge[] = []
): ModelOutcome {
  const records: StoredRecord[] = [];
  const currentVersion = new Map<string, number>();
  /** actorId → resourceId → version last read */
  const reads = new Map<string, Map<string, number>>();
  const rejected: string[] = [];
  const droppedWrites: string[] = [];
  const waitEdges: RaceWaitForEdge[] = [...extraWaitEdges];

  const rejectDup = model.rejectDuplicateCreates === true;
  const detectConflict = model.detectVersionConflicts === true;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const attemptId = stepAttemptId(step, i);
    const resourceId = step.resourceId ?? 'resource';

    if (step.op === 'wait') {
      if (step.waitForActorId) {
        waitEdges.push({ waiter: step.actorId, waitsFor: step.waitForActorId });
      }
      continue;
    }

    if (step.op === 'read') {
      const ver =
        step.version !== undefined
          ? step.version
          : (currentVersion.get(resourceId) ?? 0);
      let actorReads = reads.get(step.actorId);
      if (!actorReads) {
        actorReads = new Map();
        reads.set(step.actorId, actorReads);
      }
      actorReads.set(resourceId, ver);
      continue;
    }

    if (step.op === 'create') {
      const exists = records.some((r) => r.entityId === resourceId);
      if (exists && rejectDup) {
        rejected.push(`create:${attemptId}:rejected-duplicate:${resourceId}`);
        continue;
      }
      const version = step.version ?? 1;
      records.push({
        entityId: resourceId,
        version,
        value: step.value,
        attemptId,
        fields: fieldsFromValue(step.value),
      });
      currentVersion.set(resourceId, version);
      continue;
    }

    // write | process
    const actorReads = reads.get(step.actorId);
    const readVersion = actorReads?.get(resourceId);
    const current = currentVersion.get(resourceId);

    if (detectConflict && readVersion !== undefined && current !== undefined && readVersion !== current) {
      rejected.push(
        `write:${attemptId}:version-conflict:read=${readVersion}:current=${current}:${resourceId}`
      );
      continue;
    }

    // Silent overwrite: if another write already advanced the version and we
    // do not detect conflicts, the prior write's value is dropped.
    if (
      !detectConflict &&
      readVersion !== undefined &&
      current !== undefined &&
      readVersion < current
    ) {
      const prior = records.filter((r) => r.entityId === resourceId).at(-1);
      if (prior) {
        droppedWrites.push(prior.attemptId);
      }
    }

    const nextVersion =
      step.version !== undefined
        ? step.version
        : (current ?? 0) + 1;

    // Replace last record for this entity on write/process (update semantics).
    const lastIdx = (() => {
      for (let j = records.length - 1; j >= 0; j--) {
        if (records[j]!.entityId === resourceId) return j;
      }
      return -1;
    })();

    const next: StoredRecord = {
      entityId: resourceId,
      version: nextVersion,
      value: step.value,
      attemptId,
      fields: fieldsFromValue(step.value),
    };

    if (lastIdx >= 0) {
      // Update semantics: replace the current row for this entity.
      records[lastIdx] = next;
    } else {
      records.push(next);
    }
    currentVersion.set(resourceId, nextVersion);
  }

  return {
    records,
    currentVersion,
    rejected,
    droppedWrites,
    waitEdges,
    fingerprint: fingerprintState(records, rejected, droppedWrites),
  };
}

/**
 * Sequential baseline: actors in first-appearance order; each actor's steps
 * in their original relative order. Same steps, different schedule.
 */
export function sequentializeByActor(steps: RaceStep[]): RaceStep[] {
  const actorOrder: string[] = [];
  const byActor = new Map<string, RaceStep[]>();
  for (const step of steps) {
    if (!byActor.has(step.actorId)) {
      actorOrder.push(step.actorId);
      byActor.set(step.actorId, []);
    }
    byActor.get(step.actorId)!.push(step);
  }
  const out: RaceStep[] = [];
  for (const actor of actorOrder) {
    out.push(...(byActor.get(actor) ?? []));
  }
  return out;
}

/**
 * Detect a cycle in a directed wait-for graph.
 * Returns the cycle actor ids when found; otherwise null.
 */
export function findWaitForCycle(edges: RaceWaitForEdge[]): string[] | null {
  if (edges.length === 0) return null;

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.waiter) ?? [];
    list.push(e.waitsFor);
    adj.set(e.waiter, list);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string>();

  for (const e of edges) {
    if (!color.has(e.waiter)) color.set(e.waiter, WHITE);
    if (!color.has(e.waitsFor)) color.set(e.waitsFor, WHITE);
  }

  let cycle: string[] | null = null;

  function dfs(u: string): void {
    if (cycle) return;
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      if (cycle) return;
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) {
        const path = [v, u];
        let cur = u;
        while (cur !== v) {
          const p = parent.get(cur);
          if (!p) break;
          path.push(p);
          cur = p;
        }
        cycle = path.reverse();
        return;
      }
      if (c === WHITE) {
        parent.set(v, u);
        dfs(v);
      }
    }
    color.set(u, BLACK);
  }

  for (const node of color.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      dfs(node);
      if (cycle) return cycle;
    }
  }
  return null;
}

function finalFields(outcome: ModelOutcome): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const r of outcome.records) {
    Object.assign(merged, r.fields);
    merged.count = (typeof merged.count === 'number' ? merged.count : 0) + 1;
    merged.status = r.fields.status ?? merged.status;
    if (r.fields.balance !== undefined) merged.balance = r.fields.balance;
  }
  merged.recordCount = outcome.records.length;
  return merged;
}

function checkDuplicate(
  outcome: ModelOutcome,
  interleavingEvidence: string,
  model: RaceModelOptions
): TestResult {
  const byEntity = new Map<string, StoredRecord[]>();
  for (const r of outcome.records) {
    const list = byEntity.get(r.entityId) ?? [];
    list.push(r);
    byEntity.set(r.entityId, list);
  }

  const dupes: StoredRecord[] = [];
  for (const list of byEntity.values()) {
    if (list.length > 1) dupes.push(...list);
  }

  const rejectedDup = outcome.rejected.filter((r) => r.includes('rejected-duplicate'));

  if (dupes.length > 1) {
    const attempts = dupes.map((d) => d.attemptId);
    return raceResult(RACE_CHECK_IDS.duplicateRecords, 'duplicate-records', 'FAIL', {
      reason: `duplicate records kept for entity (${[...new Set(dupes.map((d) => d.entityId))].join(', ')}); attempts=${attempts.join(',')}; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
      assertion: { expected: 'at most one stored record per entity id', actual: attempts },
      metadata: {
        interleaving: interleavingEvidence,
        attempts,
        entityIds: [...new Set(dupes.map((d) => d.entityId))],
      },
    });
  }

  if (rejectedDup.length > 0 || model.rejectDuplicateCreates === true) {
    return raceResult(RACE_CHECK_IDS.duplicateRecords, 'duplicate-records', 'PASS', {
      reason: `second create rejected or no duplicate records; rejected=[${rejectedDup.join(';') || 'none'}]; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
      metadata: { interleaving: interleavingEvidence, rejected: rejectedDup },
    });
  }

  return raceResult(RACE_CHECK_IDS.duplicateRecords, 'duplicate-records', 'PASS', {
    reason: `no duplicate records in final state; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
    metadata: { interleaving: interleavingEvidence },
  });
}

function checkLostUpdates(
  steps: RaceStep[],
  outcome: ModelOutcome,
  interleavingEvidence: string,
  model: RaceModelOptions
): TestResult {
  const anyVersion = steps.some((s) => s.version !== undefined);
  const anyRead = steps.some((s) => s.op === 'read');
  if (!anyVersion && !anyRead) {
    return raceResult(RACE_CHECK_IDS.lostUpdates, 'lost-updates', 'NOT_TESTED', {
      reason: `versions were not supplied; cannot evaluate lost updates; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
      metadata: { interleaving: interleavingEvidence },
    });
  }

  if (outcome.droppedWrites.length > 0 && model.detectVersionConflicts !== true) {
    return raceResult(RACE_CHECK_IDS.lostUpdates, 'lost-updates', 'FAIL', {
      reason: `lost update: dropped write(s) ${outcome.droppedWrites.join(', ')} without conflict detection; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
      assertion: { expected: 'no silently dropped write', actual: outcome.droppedWrites },
      metadata: {
        interleaving: interleavingEvidence,
        droppedWrites: outcome.droppedWrites,
      },
    });
  }

  const conflicts = outcome.rejected.filter((r) => r.includes('version-conflict'));
  if (conflicts.length > 0 || model.detectVersionConflicts === true) {
    return raceResult(RACE_CHECK_IDS.lostUpdates, 'lost-updates', 'PASS', {
      reason: `version conflict detected or no silent drop; conflicts=[${conflicts.join(';') || 'none'}]; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
      metadata: { interleaving: interleavingEvidence, conflicts },
    });
  }

  return raceResult(RACE_CHECK_IDS.lostUpdates, 'lost-updates', 'PASS', {
    reason: `no lost update observed under supplied interleaving; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
    metadata: { interleaving: interleavingEvidence },
  });
}

function checkDeadlocks(
  outcome: ModelOutcome,
  interleavingEvidence: string
): TestResult {
  if (outcome.waitEdges.length === 0) {
    return raceResult(RACE_CHECK_IDS.deadlocks, 'deadlocks', 'NOT_TESTED', {
      reason: `no wait-for edges were supplied; deadlock is not asserted; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
      metadata: { interleaving: interleavingEvidence },
    });
  }

  const cycle = findWaitForCycle(outcome.waitEdges);
  if (cycle) {
    return raceResult(RACE_CHECK_IDS.deadlocks, 'deadlocks', 'FAIL', {
      reason: `deadlock cycle detected: ${cycle.join(' → ')}; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
      assertion: { expected: 'acyclic wait-for graph', actual: cycle },
      metadata: { interleaving: interleavingEvidence, cycle, waitEdges: outcome.waitEdges },
    });
  }

  return raceResult(RACE_CHECK_IDS.deadlocks, 'deadlocks', 'PASS', {
    reason: `wait-for graph has no cycle; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
    metadata: { interleaving: interleavingEvidence, waitEdges: outcome.waitEdges },
  });
}

function checkInconsistentState(
  scenario: RaceScenario,
  outcome: ModelOutcome,
  interleavingEvidence: string
): TestResult {
  const inv = scenario.invariant;
  if (!inv) {
    return raceResult(RACE_CHECK_IDS.inconsistentState, 'inconsistent-state', 'NOT_TESTED', {
      reason: `no invariant was supplied; inconsistent state is not asserted; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
      metadata: { interleaving: interleavingEvidence },
    });
  }

  const fields = finalFields(outcome);
  const actual = fields[inv.field];

  if (inv.equals !== undefined) {
    const ok = JSON.stringify(actual) === JSON.stringify(inv.equals);
    if (!ok) {
      return raceResult(RACE_CHECK_IDS.inconsistentState, 'inconsistent-state', 'FAIL', {
        reason: `invariant violated: ${inv.field} expected ${JSON.stringify(inv.equals)} got ${JSON.stringify(actual)}; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
        assertion: { expected: inv.equals, actual },
        metadata: { interleaving: interleavingEvidence, fields },
      });
    }
  }

  if (typeof inv.min === 'number') {
    if (typeof actual !== 'number' || actual < inv.min) {
      return raceResult(RACE_CHECK_IDS.inconsistentState, 'inconsistent-state', 'FAIL', {
        reason: `invariant violated: ${inv.field} min ${inv.min} got ${JSON.stringify(actual)}; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
        assertion: { expected: { min: inv.min }, actual },
        metadata: { interleaving: interleavingEvidence, fields },
      });
    }
  }

  if (typeof inv.max === 'number') {
    if (typeof actual !== 'number' || actual > inv.max) {
      return raceResult(RACE_CHECK_IDS.inconsistentState, 'inconsistent-state', 'FAIL', {
        reason: `invariant violated: ${inv.field} max ${inv.max} got ${JSON.stringify(actual)}; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
        assertion: { expected: { max: inv.max }, actual },
        metadata: { interleaving: interleavingEvidence, fields },
      });
    }
  }

  return raceResult(RACE_CHECK_IDS.inconsistentState, 'inconsistent-state', 'PASS', {
    reason: `invariant holds for ${inv.field}; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
    metadata: { interleaving: interleavingEvidence, fields },
  });
}

function checkRaceConditions(
  steps: RaceStep[],
  interleaved: ModelOutcome,
  model: RaceModelOptions,
  extraWaitEdges: RaceWaitForEdge[],
  interleavingEvidence: string
): TestResult {
  if (steps.length === 0) {
    return raceResult(RACE_CHECK_IDS.raceConditions, 'race-conditions', 'NOT_TESTED', {
      reason: `sequential baseline cannot be computed from empty steps; interleaving=[${interleavingEvidence}]; ${LIMITS_NOTE}`,
      metadata: { interleaving: interleavingEvidence },
    });
  }

  const sequentialSteps = sequentializeByActor(steps).map((s) =>
    // Sequential baseline re-reads current state — supplied read versions
    // document the interleaved observation, not the sequential one.
    s.op === 'read' ? { ...s, version: undefined } : s
  );
  // Identical actor-order schedule (after stripping read versions for baseline).
  const sameOrder =
    sequentializeByActor(steps).length === steps.length &&
    sequentializeByActor(steps).every(
      (s, i) =>
        s.actorId === steps[i]!.actorId &&
        s.op === steps[i]!.op &&
        s.resourceId === steps[i]!.resourceId &&
        s.version === steps[i]!.version &&
        JSON.stringify(s.value) === JSON.stringify(steps[i]!.value)
    );

  const sequential = applyInterleaving(sequentialSteps, model, extraWaitEdges);
  const seqEvidence = formatInterleavingEvidence(sequentialSteps);

  if (sameOrder) {
    return raceResult(RACE_CHECK_IDS.raceConditions, 'race-conditions', 'PASS', {
      reason: `interleaving matches actor-sequential order; outcomes identical; interleaving=[${interleavingEvidence}]; sequential=[${seqEvidence}]; ${LIMITS_NOTE}`,
      metadata: {
        interleaving: interleavingEvidence,
        sequential: seqEvidence,
        interleavedFingerprint: interleaved.fingerprint,
        sequentialFingerprint: sequential.fingerprint,
      },
    });
  }

  if (interleaved.fingerprint !== sequential.fingerprint) {
    return raceResult(RACE_CHECK_IDS.raceConditions, 'race-conditions', 'FAIL', {
      reason: `race condition: interleaved outcome differs from sequential; interleaved=${interleaved.fingerprint}; sequential=${sequential.fingerprint}; interleaving=[${interleavingEvidence}]; sequentialOrder=[${seqEvidence}]; ${LIMITS_NOTE}`,
      assertion: {
        expected: sequential.fingerprint,
        actual: interleaved.fingerprint,
      },
      metadata: {
        interleaving: interleavingEvidence,
        sequential: seqEvidence,
        interleavedFingerprint: interleaved.fingerprint,
        sequentialFingerprint: sequential.fingerprint,
      },
    });
  }

  return raceResult(RACE_CHECK_IDS.raceConditions, 'race-conditions', 'PASS', {
    reason: `interleaved and sequential outcomes match; interleaving=[${interleavingEvidence}]; sequential=[${seqEvidence}]; ${LIMITS_NOTE}`,
    metadata: {
      interleaving: interleavingEvidence,
      sequential: seqEvidence,
      fingerprint: interleaved.fingerprint,
    },
  });
}

/**
 * Optional race checks. Disabled → single NOT_APPLICABLE.
 * Missing scenario / empty interleaving → single NOT_TESTED (no invented schedule).
 * Does not contact a database, HTTP, or payment provider.
 */
export function runRaceChecks(input: RunRaceChecksInput): TestResult[] {
  if (input.enabled !== true) {
    return [
      raceResult(RACE_CHECK_IDS.notEnabled, 'Race testing', 'NOT_APPLICABLE', {
        reason:
          'race testing is not enabled for this application; live concurrency is not executed; timing-based tests are not part of the default suite',
      }),
    ];
  }

  const scenario = input.scenario;
  if (!scenario || !Array.isArray(scenario.interleaving) || scenario.interleaving.length === 0) {
    return [
      raceResult(RACE_CHECK_IDS.scenario, 'Race scenario', 'NOT_TESTED', {
        reason:
          'no interleaving / scenario body was supplied; random schedules are not invented; does not prove absence of races in production',
      }),
    ];
  }

  const model = scenario.model ?? {};
  const waitEdges = scenario.waitForEdges ?? [];
  const interleavingEvidence = formatInterleavingEvidence(scenario.interleaving);
  const outcome = applyInterleaving(scenario.interleaving, model, waitEdges);

  return [
    checkDuplicate(outcome, interleavingEvidence, model),
    checkLostUpdates(scenario.interleaving, outcome, interleavingEvidence, model),
    checkDeadlocks(outcome, interleavingEvidence),
    checkInconsistentState(scenario, outcome, interleavingEvidence),
    checkRaceConditions(scenario.interleaving, outcome, model, waitEdges, interleavingEvidence),
  ];
}
