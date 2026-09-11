export const STAGE_PHASES = ['setup', 'discovery', 'inventory', 'execution', 'post'] as const;

export type StagePhase = (typeof STAGE_PHASES)[number];

export const EXECUTION_STAGE_KEYS = [
  'e2e',
  'visual',
  'responsive',
  'cross-browser',
  'accessibility',
  'api',
  'performance',
  'security',
  'seo',
  'content',
  'workflows',
] as const;

export type ExecutionStageKey = (typeof EXECUTION_STAGE_KEYS)[number];

export function stagePhaseForKey(key: string): StagePhase {
  if (key === 'preflight' || key === 'dependencies') return 'setup';
  if (key === 'discovery') return 'discovery';
  if (key === 'inventory') return 'inventory';
  if ((EXECUTION_STAGE_KEYS as readonly string[]).includes(key)) return 'execution';
  return 'post';
}

export function isExecutionStageKey(key: string): boolean {
  return (EXECUTION_STAGE_KEYS as readonly string[]).includes(key);
}

export interface StageTimelineRow {
  id: number;
  key: string;
  name: string;
  phase: StagePhase;
  status: string;
  exitCode: number | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  reason?: string;
  executedCount?: number;
}

export interface StageOrderingResult {
  ok: boolean;
  discoveryCompletedAt: string;
  firstExecutionStartedAt: string;
  violations: string[];
}

export interface StageTimeline {
  generatedAt: string;
  stages: StageTimelineRow[];
  ordering: StageOrderingResult;
}

const MISSING = 'NOT_AVAILABLE';

function parseInstant(value: string | undefined): number | null {
  if (!value || value === MISSING) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Discovery completedAt must precede every execution stage startedAt.
 * Execution stages that never ran (NOT_EXECUTED) are ignored.
 */
export function assertDiscoveryPrecedesExecution(stages: StageTimelineRow[]): StageOrderingResult {
  const discovery = stages.find((row) => row.key === 'discovery');
  const executions = stages.filter(
    (row) => row.phase === 'execution' && row.status.toUpperCase() !== 'NOT_EXECUTED'
  );

  const discoveryCompletedAt = discovery?.completedAt ?? MISSING;
  const firstExecution = executions.reduce<StageTimelineRow | null>((earliest, row) => {
    if (!earliest) return row;
    const current = parseInstant(row.startedAt);
    const prior = parseInstant(earliest.startedAt);
    if (current == null) return earliest;
    if (prior == null || current < prior) return row;
    return earliest;
  }, null);
  const firstExecutionStartedAt = firstExecution?.startedAt ?? MISSING;

  const violations: string[] = [];
  const discoveryMs = parseInstant(discoveryCompletedAt);

  if (executions.length > 0 && discoveryMs == null) {
    violations.push(
      'Discovery completedAt is NOT_AVAILABLE but one or more execution stages started'
    );
  }

  if (discoveryMs != null) {
    for (const row of executions) {
      const startedMs = parseInstant(row.startedAt);
      if (startedMs == null) {
        violations.push(`${row.name} startedAt is NOT_AVAILABLE`);
        continue;
      }
      if (discoveryMs > startedMs) {
        violations.push(
          `Discovery completedAt ${discoveryCompletedAt} is after ${row.name} startedAt ${row.startedAt}`
        );
      }
    }
  }

  return {
    ok: violations.length === 0,
    discoveryCompletedAt,
    firstExecutionStartedAt,
    violations,
  };
}

export function buildStageTimeline(stages: StageTimelineRow[]): StageTimeline {
  return {
    generatedAt: new Date().toISOString(),
    stages,
    ordering: assertDiscoveryPrecedesExecution(stages),
  };
}

/** Markdown rows only — Layer 2 table UI is owned by the report generator. */
export function formatStageTimelineRows(stages: StageTimelineRow[]): string[] {
  return stages.map((row) => {
    const started = row.startedAt || MISSING;
    const completed = row.completedAt || MISSING;
    const seconds = `${(row.durationMs / 1000).toFixed(1)}s`;
    return `| ${row.id} | ${row.name} | ${row.status} | ${row.exitCode ?? 'n/a'} | ${started} | ${completed} | ${seconds} | ${row.reason ?? ''} |`;
  });
}
