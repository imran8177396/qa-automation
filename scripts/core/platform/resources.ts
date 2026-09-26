/**
 * Resource requirement declarations for safe parallel wave planning.
 * Plans waves only — does not acquire OS resources, browsers, databases, or sockets.
 */
import { planParallel } from './parallel';

/** Well-known names; additional string names are allowed without a closed-world throw. */
export type ResourceName = 'browser' | 'database' | 'network' | (string & {});

export type ResourceMode = 'exclusive' | 'shared';

export interface ResourceRequirement {
  name: ResourceName;
  /** Integer >= 0. Zero means the test does not take this resource. */
  count: number;
  mode: ResourceMode;
}

/** Map form — each entry means count N with mode `exclusive` (safer default). */
export type ResourceRequirementMap = Readonly<Record<string, number>>;

/**
 * Accepted declaration shapes:
 * - map `{ browser: 1 }` → exclusive
 * - list `[{ name, count, mode }]`
 * - legacy string labels `['db']` → shared count 1 (preserves allowSharedMutableState)
 */
export type ResourceDeclaration =
  | ResourceRequirementMap
  | readonly ResourceRequirement[]
  | readonly string[];

export interface ResourceAwareTest {
  id: string;
  resources?: ResourceDeclaration;
  allowSharedMutableState?: boolean;
  /** Optional dependency ids — when present, dependency waves are planned first. */
  dependsOn?: readonly string[];
}

export interface PlanResourceWavesOptions {
  /** Default false — one test per wave in input order. */
  parallel?: boolean;
  /** Optional pool capacity per resource name. Omitted = unlimited for shared. */
  pool?: Readonly<Record<string, number>>;
}

export interface NormalizedResources {
  /** False when the `resources` field was omitted. */
  declared: boolean;
  requirements: ResourceRequirement[];
  /**
   * Planning note when undeclared tests refuse to share a wave.
   * Not a test execution status.
   */
  reason?: string;
}

export const UNDECLARED_RESOURCE_WAVE_REASON =
  'resource requirements not declared; refusing to share a wave';

export const SHARED_MUTABLE_ALLOW_REASON =
  'shared mutable resource requires allowSharedMutableState on every participant';

/** Resources treated as mutable state — shared+shared needs allowSharedMutableState. */
const MUTABLE_RESOURCE_NAMES = new Set<string>(['browser', 'database']);

function isResourceRequirementList(
  value: ResourceDeclaration
): value is readonly ResourceRequirement[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first = value[0];
  return typeof first === 'object' && first !== null && 'name' in first;
}

function isLegacyStringList(value: ResourceDeclaration): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  return typeof value[0] === 'string';
}

function assertValidCount(count: unknown, label: string): asserts count is number {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || Number.isNaN(count)) {
    throw new Error(
      `Invalid resource count for ${label}: expected integer >= 0, received ${String(count)}`
    );
  }
}

function assertValidMode(mode: unknown, label: string): asserts mode is ResourceMode {
  if (mode !== 'exclusive' && mode !== 'shared') {
    throw new Error(
      `Invalid resource mode for ${label}: expected 'exclusive' | 'shared', received ${String(mode)}`
    );
  }
}

/**
 * Normalize map / list / legacy string declarations into ResourceRequirement[].
 * Missing field → undeclared (not the same as shared).
 */
export function normalizeResourceRequirements(
  resources: ResourceDeclaration | undefined
): NormalizedResources {
  if (resources === undefined) {
    return {
      declared: false,
      requirements: [],
      reason: UNDECLARED_RESOURCE_WAVE_REASON,
    };
  }

  if (isResourceRequirementList(resources)) {
    const requirements: ResourceRequirement[] = [];
    for (const row of resources) {
      if (typeof row.name !== 'string' || row.name.length === 0) {
        throw new Error('ResourceRequirement.name must be a non-empty string');
      }
      assertValidCount(row.count, row.name);
      assertValidMode(row.mode, row.name);
      requirements.push({ name: row.name, count: row.count, mode: row.mode });
    }
    return { declared: true, requirements };
  }

  if (isLegacyStringList(resources)) {
    const requirements: ResourceRequirement[] = resources.map((name) => {
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('Legacy resource label must be a non-empty string');
      }
      return { name, count: 1, mode: 'shared' as const };
    });
    return { declared: true, requirements };
  }

  // Map form — exclusive by default (safer).
  const requirements: ResourceRequirement[] = [];
  for (const [name, count] of Object.entries(resources)) {
    if (name.length === 0) {
      throw new Error('Resource map keys must be non-empty strings');
    }
    assertValidCount(count, name);
    requirements.push({ name, count, mode: 'exclusive' });
  }
  return { declared: true, requirements };
}

function activeRequirements(reqs: readonly ResourceRequirement[]): ResourceRequirement[] {
  return reqs.filter((row) => row.count > 0);
}

function isMutableResource(name: string): boolean {
  if (name === 'network') return false;
  if (MUTABLE_RESOURCE_NAMES.has(name)) return true;
  // Unknown names: treat as mutable (safer default).
  return true;
}

/**
 * Whether two tests may occupy the same parallel wave given resource declarations.
 * Undeclared tests never share. Does not execute anything.
 */
export function resourcesAllowShare(
  a: Pick<ResourceAwareTest, 'resources' | 'allowSharedMutableState'>,
  b: Pick<ResourceAwareTest, 'resources' | 'allowSharedMutableState'>
): boolean {
  const left = normalizeResourceRequirements(a.resources);
  const right = normalizeResourceRequirements(b.resources);

  if (!left.declared || !right.declared) {
    return false;
  }

  const leftActive = activeRequirements(left.requirements);
  const rightActive = activeRequirements(right.requirements);

  for (const la of leftActive) {
    const rb = rightActive.find((row) => row.name === la.name);
    if (!rb) continue;

    if (la.mode === 'exclusive' || rb.mode === 'exclusive') {
      return false;
    }

    // Both shared on this name.
    if (isMutableResource(la.name)) {
      if (a.allowSharedMutableState !== true || b.allowSharedMutableState !== true) {
        return false;
      }
    }
  }

  return true;
}

function waveFitsPool(
  group: readonly ResourceAwareTest[],
  candidate: ResourceAwareTest,
  pool: Readonly<Record<string, number>> | undefined
): boolean {
  if (!pool) return true;

  const members = [...group, candidate];
  const usage = new Map<string, number>();

  for (const test of members) {
    const { requirements } = normalizeResourceRequirements(test.resources);
    for (const row of activeRequirements(requirements)) {
      usage.set(row.name, (usage.get(row.name) ?? 0) + row.count);
    }
  }

  for (const [name, total] of usage) {
    const cap = pool[name];
    if (typeof cap === 'number' && total > cap) return false;
  }
  return true;
}

/**
 * Pack tests into compatible sub-waves. Preserves input order within each wave.
 * Undeclared tests always form their own wave. Does not drop tests.
 */
export function packResourceCompatibleWaves(
  tests: readonly ResourceAwareTest[],
  pool?: Readonly<Record<string, number>>
): ResourceAwareTest[][] {
  const groups: ResourceAwareTest[][] = [];

  for (const test of tests) {
    const normalized = normalizeResourceRequirements(test.resources);
    if (!normalized.declared) {
      groups.push([test]);
      continue;
    }

    let placed = false;
    for (const group of groups) {
      const undeclaredInGroup = group.some(
        (other) => !normalizeResourceRequirements(other.resources).declared
      );
      if (undeclaredInGroup) continue;
      if (!group.every((other) => resourcesAllowShare(test, other))) continue;
      if (!waveFitsPool(group, test, pool)) continue;
      group.push(test);
      placed = true;
      break;
    }
    if (!placed) {
      groups.push([test]);
    }
  }

  return groups;
}

/**
 * Plan ordered waves of test ids from resource (+ optional dependency) declarations.
 * When `parallel` is false (default), returns one test per wave in input order.
 * Does not spawn processes or acquire resources.
 */
export function planResourceWaves(
  tests: readonly ResourceAwareTest[],
  options: PlanResourceWavesOptions = {}
): string[][] {
  for (const test of tests) {
    if (typeof test.id !== 'string' || test.id.length === 0) {
      throw new Error('planResourceWaves: every test requires a non-empty id');
    }
    // Validate counts early (throws on invalid).
    normalizeResourceRequirements(test.resources);
  }

  const parallel = options.parallel === true;
  if (!parallel) {
    return tests.map((test) => [test.id]);
  }

  const hasDeps = tests.some((test) => (test.dependsOn?.length ?? 0) > 0);
  if (hasDeps) {
    const plan = planParallel({
      nodes: tests.map((test) => ({
        id: test.id,
        dependsOn: [...(test.dependsOn ?? [])],
      })),
      enabled: true,
      concurrency: 1,
    });
    const byId = new Map(tests.map((test) => [test.id, test]));
    const waves: string[][] = [];
    for (const waveIds of plan.waves) {
      const waveTests = waveIds.map((id) => {
        const test = byId.get(id);
        if (!test) {
          throw new Error(`planResourceWaves: unknown id in dependency wave: ${id}`);
        }
        return test;
      });
      for (const group of packResourceCompatibleWaves(waveTests, options.pool)) {
        waves.push(group.map((test) => test.id));
      }
    }
    return waves;
  }

  return packResourceCompatibleWaves(tests, options.pool).map((group) =>
    group.map((test) => test.id)
  );
}
