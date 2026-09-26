import { orderByDependencies, type DependencyNode } from './dependencies';

/**
 * Wave planning + in-process concurrency helper — does not spawn processes.
 * Resource-aware packing: `./resources` (`planResourceWaves`). Status stays PARTIAL
 * because this plans waves only and does not acquire OS resources.
 */
export const PARALLEL_EXECUTION_STATUS = 'PARTIAL' as const;
export interface PlanParallelInput {
  nodes: readonly DependencyNode[];
  /** Alias accepted for callers that pass a separate dependency list; defaults to nodes. */
  dependencies?: readonly DependencyNode[];
  /** Default false — one sequential wave. */
  enabled?: boolean;
  /** Planned concurrency. Forced to 1 when enabled is false. Default 1. */
  concurrency?: number;
  /** Max workers hint. Default 1. */
  maxWorkers?: number;
  /** Workers should be isolated. Default true. */
  isolateWorkers?: boolean;
  /** Optional AbortSignal — recorded on the plan for callers. */
  signal?: AbortSignal;
}

export interface ParallelPlan {
  enabled: boolean;
  waves: string[][];
  concurrency: number;
  maxWorkers: number;
  isolateWorkers: boolean;
  /** True when the caller-supplied signal is already aborted. */
  cancelled: boolean;
}

export type ConcurrencyTaskResult<T> =
  | { status: 'PASS'; value: T }
  | { status: 'FAIL'; error: unknown }
  | { status: 'cancelled'; reason: string };

/**
 * When `enabled` is false (default), one wave contains every node in dependency order
 * and concurrency is forced to 1. When true, nodes with no pending dependency may share
 * a wave; dependents stay later. Does not spawn processes.
 */
export function planParallel(input: PlanParallelInput): ParallelPlan {
  const graph = input.dependencies ?? input.nodes;
  const enabled = input.enabled === true;
  const order = orderByDependencies(graph);
  const cancelled = input.signal?.aborted === true;
  const maxWorkers = Math.max(1, input.maxWorkers ?? 1);
  const isolateWorkers = input.isolateWorkers !== false;
  const concurrency = enabled ? Math.max(1, input.concurrency ?? 1) : 1;

  if (!enabled) {
    return {
      enabled: false,
      waves: [order],
      concurrency: 1,
      maxWorkers,
      isolateWorkers,
      cancelled,
    };
  }

  const byId = new Map(graph.map((node) => [node.id, node]));
  const completed = new Set<string>();
  const remaining = new Set(order);
  const waves: string[][] = [];

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of order) {
      if (!remaining.has(id)) continue;
      const node = byId.get(id)!;
      const ready = node.dependsOn.every((dep) => completed.has(dep));
      if (ready) wave.push(id);
    }
    if (wave.length === 0) {
      throw new Error(`Parallel plan stuck with pending nodes: ${[...remaining].join(', ')}`);
    }
    waves.push(wave);
    for (const id of wave) {
      remaining.delete(id);
      completed.add(id);
    }
  }

  return {
    enabled: true,
    waves,
    concurrency,
    maxWorkers,
    isolateWorkers,
    cancelled,
  };
}

/**
 * Run async tasks with a concurrency limit. An aborted signal does not start
 * remaining tasks and records `cancelled` (never PASS). Does not spawn child processes.
 */
export async function runWithConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
  signal?: AbortSignal
): Promise<ConcurrencyTaskResult<T>[]> {
  const results: ConcurrencyTaskResult<T>[] = new Array(tasks.length);
  const workerLimit = Math.max(1, limit);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) {
        while (nextIndex < tasks.length) {
          const i = nextIndex++;
          if (results[i] === undefined) {
            results[i] = {
              status: 'cancelled',
              reason: 'AbortSignal aborted before task start',
            };
          }
        }
        return;
      }
      const i = nextIndex++;
      if (i >= tasks.length) return;
      try {
        const value = await tasks[i]();
        results[i] = { status: 'PASS', value };
      } catch (error) {
        results[i] = { status: 'FAIL', error };
      }
    }
  }

  const workers = Array.from({ length: Math.min(workerLimit, Math.max(tasks.length, 1)) }, () =>
    worker()
  );
  await Promise.all(workers);

  for (let i = 0; i < tasks.length; i++) {
    if (results[i] === undefined) {
      results[i] = {
        status: 'cancelled',
        reason: 'AbortSignal aborted before task start',
      };
    }
  }

  return results;
}
