import { ORCHESTRATOR_PHASE_NAMES } from '../../orchestrator/phases';

/**
 * Topological ordering only — does not change run-all spawn order. Gating is a scheduler primitive.
 * Callers may call gateDependents; the default pipeline (run-all / qa:all) does not.
 */
export const TEST_DEPENDENCIES_STATUS = 'IMPLEMENTED' as const;

export interface DependencyNode {
  id: string;
  dependsOn: string[];
}

/**
 * Prerequisite edge for dependent test scheduling.
 * `requiredStatus` defaults to PASS when omitted. Only `'PASS'` is supported.
 */
export interface TestDependency {
  testId: string;
  /** Defaults to PASS when omitted. Dependent may run only when the prerequisite has this status. */
  requiredStatus?: 'PASS';
}

import type { ResourceDeclaration } from './resources';

/** A test that may declare prerequisites via {@link TestDependency}. */
export interface DependentTest {
  testId: string;
  /** Prerequisites that must be satisfied before this test runs. */
  dependsOn?: TestDependency[];
  /**
   * Optional resource requirements for parallel wave packing.
   * - Map `{ browser: 1 }` → exclusive (safer default)
   * - List `[{ name, count, mode }]`
   * - Legacy string labels `['db']` → shared count 1
   * Omitted → undeclared: refuses to share a wave when parallel planning is on.
   * Never inferred from titles.
   */
  resources?: ResourceDeclaration;
  /**
   * When true with another test that also sets true, shared mutable resources
   * (browser / database / unknown names) may overlap in the same wave.
   * Network shared+shared does not require this flag. Default false.
   */
  allowSharedMutableState?: boolean;
  /**
   * Optional per-node timeout for {@link executeDependentPlan}.
   * Positive ms only; omitted/0 means no timer for this node.
   */
  timeoutMs?: number;
}

/** Prerequisite statuses that block dependents that have not yet run. */
const BLOCKING_PREREQ_STATUSES = new Set(['FAIL', 'BLOCKED', 'NOT_TESTED']);

export type GateDependentResult = {
  id: string;
  status: 'BLOCKED';
  reason: string;
};

export type ScheduleBlockedResult = {
  testId: string;
  status: 'BLOCKED';
  reason: string;
};

export type ScheduleDependentTestsResult = {
  order: string[];
  blocked: ScheduleBlockedResult[];
  runnable: string[];
};

/**
 * Default graph matching the existing 11 orchestrator phases in current order.
 * Pure planning data — `run-all.ts` spawn order is unchanged.
 */
export const DEFAULT_ORCHESTRATOR_DEPENDENCY_GRAPH: readonly DependencyNode[] =
  ORCHESTRATOR_PHASE_NAMES.map((id, index) => ({
    id,
    dependsOn: index === 0 ? [] : [ORCHESTRATOR_PHASE_NAMES[index - 1]],
  }));

/**
 * Topological order of dependency nodes.
 * Cycle → error with cycle ids. Missing dependency id → error naming it.
 * Never drops nodes silently.
 */
export function orderByDependencies(nodes: readonly DependencyNode[]): string[] {
  const byId = new Map<string, DependencyNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      throw new Error(`Duplicate dependency node id: ${node.id}`);
    }
    byId.set(node.id, node);
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!byId.has(dep)) {
        throw new Error(`Missing dependency id: ${dep} (required by ${node.id})`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: string[] = [];
  const stack: string[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id);
      const cycle = cycleStart >= 0 ? [...stack.slice(cycleStart), id] : [...stack, id];
      throw new Error(`Dependency cycle detected: ${cycle.join(' → ')}`);
    }
    visiting.add(id);
    stack.push(id);
    const node = byId.get(id)!;
    for (const dep of node.dependsOn) {
      visit(dep);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }

  for (const node of nodes) {
    visit(node.id);
  }

  return order;
}

function resolveStatus(
  resultsById: ReadonlyMap<string, { status: string }> | Record<string, { status: string }>
): Map<string, string> {
  if (resultsById instanceof Map) {
    return new Map([...resultsById.entries()].map(([id, row]) => [id, row.status]));
  }
  return new Map(Object.entries(resultsById).map(([id, row]) => [id, row.status]));
}

/**
 * Build reverse adjacency: prerequisite → direct dependents.
 */
function directDependents(nodes: readonly DependencyNode[]): Map<string, string[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const node of nodes) {
    if (!out.has(node.id)) out.set(node.id, []);
    for (const dep of node.dependsOn) {
      if (!byId.has(dep)) {
        throw new Error(`Missing dependency id: ${dep} (required by ${node.id})`);
      }
      const list = out.get(dep) ?? [];
      list.push(node.id);
      out.set(dep, list);
    }
  }
  return out;
}

/**
 * Collect transitive dependents of `root` (excluding root itself).
 */
function transitiveDependents(root: string, edges: Map<string, string[]>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const queue = [...(edges.get(root) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    found.push(id);
    for (const child of edges.get(id) ?? []) {
      queue.push(child);
    }
  }
  return found;
}

/**
 * Scheduler primitive: if a prerequisite is FAIL, BLOCKED, or NOT_TESTED, every
 * direct and transitive dependent that has not already run becomes BLOCKED with a
 * non-empty reason naming the prerequisite. PASS prerequisites do not block.
 * Does not convert blocked dependents to PASS. Does not change run-all spawn order.
 */
export function gateDependents(
  nodes: readonly DependencyNode[],
  resultsById: ReadonlyMap<string, { status: string }> | Record<string, { status: string }>
): GateDependentResult[] {
  const statuses = resolveStatus(resultsById);
  const edges = directDependents(nodes);
  const blocked = new Map<string, GateDependentResult>();

  for (const [prereqId, status] of statuses) {
    if (!BLOCKING_PREREQ_STATUSES.has(status)) continue;
    for (const dependentId of transitiveDependents(prereqId, edges)) {
      if (statuses.has(dependentId)) continue;
      if (blocked.has(dependentId)) continue;
      blocked.set(dependentId, {
        id: dependentId,
        status: 'BLOCKED',
        reason: `blocked because prerequisite ${prereqId} is ${status}`,
      });
    }
  }

  return [...blocked.values()];
}

function assertSupportedRequiredStatus(dep: TestDependency, dependentId: string): void {
  const required = dep.requiredStatus as string | undefined;
  if (required === undefined || required === 'PASS') return;
  throw new Error(
    `Unsupported requiredStatus "${required}" for dependency ${dep.testId} (required by ${dependentId}); only 'PASS' is allowed`
  );
}

/**
 * Convert DependentTest[] into DependencyNode[] for orderByDependencies.
 * Throws on unsupported requiredStatus (same class of hard error as cycles).
 */
export function dependentTestsToNodes(tests: readonly DependentTest[]): DependencyNode[] {
  return tests.map((test) => {
    const deps = test.dependsOn ?? [];
    for (const dep of deps) {
      assertSupportedRequiredStatus(dep, test.testId);
    }
    return {
      id: test.testId,
      dependsOn: deps.map((dep) => dep.testId),
    };
  });
}

/**
 * All transitive prerequisite ids of `root` (excluding root), prerequisites first.
 */
function transitivePrerequisites(
  root: string,
  byId: ReadonlyMap<string, DependencyNode>
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  function walk(id: string): void {
    const node = byId.get(id);
    if (!node) return;
    for (const dep of node.dependsOn) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      walk(dep);
      found.push(dep);
    }
  }

  walk(root);
  return found;
}

function formatUnmetPrerequisiteReason(
  unmet: Array<{ id: string; status: string | undefined }>
): string {
  return unmet
    .map((row) =>
      row.status === undefined
        ? `${row.id} was not executed`
        : `${row.id} did not PASS (${row.status})`
    )
    .join('; ');
}

/**
 * Schedule dependent tests against current results.
 *
 * - Resolves into the existing graph form and calls {@link orderByDependencies}.
 * - Cycles and unknown dependency ids throw (never recorded as FAIL).
 * - A test is BLOCKED (not FAIL) when any transitive prerequisite is not PASS
 *   (missing result, FAIL, BLOCKED, NOT_TESTED, REQUIRES_CONFIGURATION, SKIPPED, …).
 * - `runnable` = not blocked and not already present in resultsById.
 * - Does not change {@link gateDependents} or the 11-phase orchestrator graph.
 */
export function scheduleDependentTests(
  tests: readonly DependentTest[],
  resultsById: ReadonlyMap<string, { status: string }> | Record<string, { status: string }> = {}
): ScheduleDependentTestsResult {
  const nodes = dependentTestsToNodes(tests);
  const order = orderByDependencies(nodes);
  const statuses = resolveStatus(resultsById);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const blocked: ScheduleBlockedResult[] = [];
  const blockedIds = new Set<string>();

  for (const testId of order) {
    if (statuses.has(testId)) continue;

    const prereqs = transitivePrerequisites(testId, nodeById);
    const unmet: Array<{ id: string; status: string | undefined }> = [];
    for (const prereqId of prereqs) {
      const status = statuses.get(prereqId);
      if (status === 'PASS') continue;
      unmet.push({ id: prereqId, status });
    }

    if (unmet.length === 0) continue;

    const reason = formatUnmetPrerequisiteReason(unmet);
    blocked.push({ testId, status: 'BLOCKED', reason });
    blockedIds.add(testId);
  }

  const runnable = order.filter((id) => !blockedIds.has(id) && !statuses.has(id));

  return { order, blocked, runnable };
}
