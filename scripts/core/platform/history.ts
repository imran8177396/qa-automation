/**
 * Pure run comparison and trend summary — does not delete history folders or run during qa:all.
 * Complements execution-archive storage with id-keyed result diffs.
 * Disk I/O for run records lives in execution-history.ts — compare functions never touch disk.
 */
import {
  classifyHistoricalRuns,
  detectFlakyFromHistory,
  type HistoricalRun,
} from './flaky';

export const EXECUTION_HISTORY_STATUS = 'PARTIAL' as const;

export type RunResultStatus = 'PASS' | 'FAIL';

export interface RunResultRow {
  id: string;
  status: RunResultStatus;
  durationMs?: number;
  coveragePct?: number;
}

export type RunComparisonKind =
  | 'new'
  | 'removed'
  | 'same'
  | 'regressed'
  | 'improved'
  | 'still-failing';

export interface RunComparisonRow {
  id: string;
  kind: RunComparisonKind;
}

export interface TrendRunSummary {
  passCount: number;
  failCount: number;
}

export interface TrendSummary {
  perRun: TrendRunSummary[];
  /** Duration delta between last two runs (null if either missing duration). */
  durationDeltaMs: number | null;
  /** Coverage delta between last two runs (null if either missing coverage). */
  coverageDeltaPct: number | null;
  /** Ids that FAIL in every provided run (requires at least 2 runs). */
  recurringDefects: string[];
}

/** Per-test row inside an execution run record (JSON-serializable). */
export interface RunRecordTest {
  testEngine: string;
  testId: string;
  status: string;
  /** null when not measured — never use 0 as a fake. */
  durationMs: number | null;
  evidence?: { message?: string; screenshot?: string };
}

/** One archived execution run (file-backed via execution-history.ts). */
export interface ExecutionRunRecord {
  runId: string;
  projectId: string;
  environment: string;
  /** NOT_AVAILABLE when unknown — do not invent. */
  branch: string;
  commit: string;
  build: string;
  timestamp: string;
  tests: RunRecordTest[];
  /** Optional run-level coverage; null means not measured. */
  coveragePct?: number | null;
}

export interface ExecutionComparisonFailure {
  testId: string;
  status: string;
  evidence?: { message?: string; screenshot?: string };
}

export interface ExecutionComparisonFlaky {
  testId: string;
  status: 'FLAKY';
  reason?: string;
}

export interface ExecutionPerformanceRegression {
  testId: string;
  previousMs: number;
  currentMs: number;
  deltaMs: number;
}

export interface ExecutionCoverageChange {
  status: 'MEASURED' | 'NOT_MEASURED';
  delta: number | null;
  previousPct?: number | null;
  currentPct?: number | null;
}

export interface ExecutionComparisonTestRef {
  testId: string;
  status: string;
}

export interface ExecutionComparison {
  currentRunId: string;
  previousRunId: string | null;
  newFailures: ExecutionComparisonFailure[];
  recoveredFailures: ExecutionComparisonFailure[];
  newTests: ExecutionComparisonTestRef[];
  removedTests: ExecutionComparisonTestRef[];
  flakyTests: ExecutionComparisonFlaky[];
  performanceRegressions: ExecutionPerformanceRegression[];
  coverageChanges: ExecutionCoverageChange;
}

/**
 * Compare two result sets keyed by test id.
 * Does not invent missing rows as PASS.
 */
export function compareRuns(
  olderResults: readonly RunResultRow[],
  newerResults: readonly RunResultRow[]
): RunComparisonRow[] {
  const older = new Map(olderResults.map((row) => [row.id, row.status]));
  const newer = new Map(newerResults.map((row) => [row.id, row.status]));
  const ids = new Set([...older.keys(), ...newer.keys()]);
  const rows: RunComparisonRow[] = [];

  for (const id of [...ids].sort()) {
    const prev = older.get(id);
    const next = newer.get(id);
    if (prev === undefined && next !== undefined) {
      rows.push({ id, kind: 'new' });
      continue;
    }
    if (prev !== undefined && next === undefined) {
      rows.push({ id, kind: 'removed' });
      continue;
    }
    if (prev === 'PASS' && next === 'PASS') {
      rows.push({ id, kind: 'same' });
      continue;
    }
    if (prev === 'PASS' && next === 'FAIL') {
      rows.push({ id, kind: 'regressed' });
      continue;
    }
    if (prev === 'FAIL' && next === 'PASS') {
      rows.push({ id, kind: 'improved' });
      continue;
    }
    rows.push({ id, kind: 'still-failing' });
  }

  return rows;
}

function runDurationMs(run: readonly RunResultRow[]): number | null {
  let total = 0;
  let any = false;
  for (const row of run) {
    if (typeof row.durationMs === 'number') {
      total += row.durationMs;
      any = true;
    }
  }
  return any ? total : null;
}

function runCoveragePct(run: readonly RunResultRow[]): number | null {
  for (let i = run.length - 1; i >= 0; i--) {
    if (typeof run[i].coveragePct === 'number') return run[i].coveragePct!;
  }
  return null;
}

/**
 * Summarize ordered runs. A single run must not invent a trend of 100% coverage.
 * Does not delete history. Does not invent missing coverage or duration.
 */
export function summarizeTrends(runs: readonly (readonly RunResultRow[])[]): TrendSummary {
  const perRun: TrendRunSummary[] = runs.map((run) => {
    let passCount = 0;
    let failCount = 0;
    for (const row of run) {
      if (row.status === 'PASS') passCount += 1;
      else if (row.status === 'FAIL') failCount += 1;
    }
    return { passCount, failCount };
  });

  let durationDeltaMs: number | null = null;
  let coverageDeltaPct: number | null = null;
  if (runs.length >= 2) {
    const prev = runs[runs.length - 2];
    const last = runs[runs.length - 1];
    const prevDur = runDurationMs(prev);
    const lastDur = runDurationMs(last);
    if (prevDur !== null && lastDur !== null) {
      durationDeltaMs = lastDur - prevDur;
    }
    const prevCov = runCoveragePct(prev);
    const lastCov = runCoveragePct(last);
    if (prevCov !== null && lastCov !== null) {
      coverageDeltaPct = lastCov - prevCov;
    }
  }

  const recurringDefects: string[] = [];
  if (runs.length >= 2) {
    const failSets = runs.map(
      (run) => new Set(run.filter((row) => row.status === 'FAIL').map((row) => row.id))
    );
    const candidates = failSets[0];
    for (const id of candidates) {
      if (failSets.every((set) => set.has(id))) {
        recurringDefects.push(id);
      }
    }
    recurringDefects.sort();
  }

  return {
    perRun,
    durationDeltaMs,
    coverageDeltaPct,
    recurringDefects,
  };
}

function indexTestsById(tests: readonly RunRecordTest[]): Map<string, RunRecordTest> {
  const map = new Map<string, RunRecordTest>();
  for (const test of tests) {
    map.set(test.testId, test);
  }
  return map;
}

function coverageChange(
  current: ExecutionRunRecord,
  previous: ExecutionRunRecord | null
): ExecutionCoverageChange {
  if (previous === null) {
    return { status: 'NOT_MEASURED', delta: null };
  }
  const currentHas = Object.prototype.hasOwnProperty.call(current, 'coveragePct');
  const previousHas = Object.prototype.hasOwnProperty.call(previous, 'coveragePct');
  if (!currentHas || !previousHas) {
    return { status: 'NOT_MEASURED', delta: null };
  }
  const cur = current.coveragePct;
  const prev = previous.coveragePct;
  if (typeof cur === 'number' && typeof prev === 'number') {
    return {
      status: 'MEASURED',
      delta: cur - prev,
      previousPct: prev,
      currentPct: cur,
    };
  }
  return {
    status: 'NOT_MEASURED',
    delta: null,
    previousPct: prev ?? null,
    currentPct: cur ?? null,
  };
}

function buildHistoryByTestId(
  orderedRuns: readonly ExecutionRunRecord[]
): Record<string, HistoricalRun[]> {
  const byId: Record<string, HistoricalRun[]> = {};
  orderedRuns.forEach((run, index) => {
    const runNumber = index + 1;
    for (const test of run.tests) {
      const entry: HistoricalRun = {
        run: runNumber,
        status: test.status,
        ...(test.evidence !== undefined ? { evidence: { ...test.evidence } } : {}),
      };
      if (!byId[test.testId]) {
        byId[test.testId] = [];
      }
      byId[test.testId].push(entry);
    }
  });
  return byId;
}

/**
 * Compare two execution run records. Pure — does not read or write disk.
 *
 * When `previous` is null: newFailures = current FAILs, newTests = all current ids,
 * recovered/removed/flaky/performance empty, coverage NOT_MEASURED.
 *
 * Optional `orderedHistory` (oldest → newest) feeds flaky classification; when omitted
 * and previous is present, uses [previous, current]. Only FLAKY classifications are listed
 * (consistent FAIL is excluded).
 */
export function compareExecutions(
  current: ExecutionRunRecord,
  previous: ExecutionRunRecord | null,
  orderedHistory?: readonly ExecutionRunRecord[]
): ExecutionComparison {
  const currentById = indexTestsById(current.tests);
  const previousById = previous ? indexTestsById(previous.tests) : new Map<string, RunRecordTest>();

  const newFailures: ExecutionComparisonFailure[] = [];
  const recoveredFailures: ExecutionComparisonFailure[] = [];
  const newTests: ExecutionComparisonTestRef[] = [];
  const removedTests: ExecutionComparisonTestRef[] = [];
  const performanceRegressions: ExecutionPerformanceRegression[] = [];

  if (previous === null) {
    for (const test of current.tests) {
      newTests.push({ testId: test.testId, status: test.status });
      if (test.status === 'FAIL') {
        const row: ExecutionComparisonFailure = { testId: test.testId, status: test.status };
        if (test.evidence !== undefined) {
          row.evidence = { ...test.evidence };
        }
        newFailures.push(row);
      }
    }
    newTests.sort((a, b) => a.testId.localeCompare(b.testId));
    newFailures.sort((a, b) => a.testId.localeCompare(b.testId));
    return {
      currentRunId: current.runId,
      previousRunId: null,
      newFailures,
      recoveredFailures,
      newTests,
      removedTests,
      flakyTests: [],
      performanceRegressions: [],
      coverageChanges: coverageChange(current, null),
    };
  }

  for (const [testId, cur] of currentById) {
    const prev = previousById.get(testId);
    if (!prev) {
      newTests.push({ testId, status: cur.status });
      if (cur.status === 'FAIL') {
        const row: ExecutionComparisonFailure = { testId, status: cur.status };
        if (cur.evidence !== undefined) {
          row.evidence = { ...cur.evidence };
        }
        newFailures.push(row);
      }
      continue;
    }

    if (cur.status === 'FAIL' && prev.status !== 'FAIL') {
      const row: ExecutionComparisonFailure = { testId, status: cur.status };
      if (cur.evidence !== undefined) {
        row.evidence = { ...cur.evidence };
      }
      newFailures.push(row);
    }

    if (prev.status === 'FAIL' && cur.status === 'PASS') {
      recoveredFailures.push({ testId, status: cur.status });
    }

    if (
      typeof cur.durationMs === 'number' &&
      typeof prev.durationMs === 'number' &&
      cur.durationMs > prev.durationMs
    ) {
      performanceRegressions.push({
        testId,
        previousMs: prev.durationMs,
        currentMs: cur.durationMs,
        deltaMs: cur.durationMs - prev.durationMs,
      });
    }
  }

  for (const [testId, prev] of previousById) {
    if (!currentById.has(testId)) {
      removedTests.push({ testId, status: prev.status });
    }
  }

  newTests.sort((a, b) => a.testId.localeCompare(b.testId));
  removedTests.sort((a, b) => a.testId.localeCompare(b.testId));
  newFailures.sort((a, b) => a.testId.localeCompare(b.testId));
  recoveredFailures.sort((a, b) => a.testId.localeCompare(b.testId));
  performanceRegressions.sort((a, b) => a.testId.localeCompare(b.testId));

  const historyRuns =
    orderedHistory && orderedHistory.length > 0 ? orderedHistory : [previous, current];
  const historyById = buildHistoryByTestId(historyRuns);
  const classified = detectFlakyFromHistory(historyById);
  const flakyTests: ExecutionComparisonFlaky[] = [];
  for (const [testId, classification] of Object.entries(classified)) {
    if (classification.status !== 'FLAKY') continue;
    // ensure classifyHistoricalRuns agrees (single source)
    const again = classifyHistoricalRuns(historyById[testId] ?? []);
    if (again.status !== 'FLAKY') continue;
    flakyTests.push({
      testId,
      status: 'FLAKY',
      ...(again.reason !== undefined ? { reason: again.reason } : {}),
    });
  }
  flakyTests.sort((a, b) => a.testId.localeCompare(b.testId));

  return {
    currentRunId: current.runId,
    previousRunId: previous.runId,
    newFailures,
    recoveredFailures,
    newTests,
    removedTests,
    flakyTests,
    performanceRegressions,
    coverageChanges: coverageChange(current, previous),
  };
}
