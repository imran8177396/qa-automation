/**
 * File-based execution run records under the existing history directories.
 * Pure comparison lives in history.ts — this module owns build / append / load / render.
 * Does not rewrite runners, touch qa:all stage order, or delete reports/history.
 */
import fs from 'fs';
import path from 'path';
import { NOT_AVAILABLE } from '../../lib/suite-origin';
import { PATHS } from '../../lib/paths';
import { DEFAULT_PROJECT_ID, projectStores } from './project';
import { createExecutionId } from './observability';
import type { ExecutionComparison, ExecutionRunRecord, RunRecordTest } from './history';

export type { ExecutionRunRecord, RunRecordTest };

export interface BuildRunRecordInput {
  runId?: string;
  projectId?: string;
  environment?: string;
  branch?: string;
  commit?: string;
  build?: string;
  timestamp?: string;
  tests: RunRecordTest[];
  coveragePct?: number | null;
}

export interface AppendRunRecordOptions {
  /** Override history directory (tests use os.tmpdir()). */
  dir?: string;
}

function nonEmpty(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function metaOrUnavailable(value: string | undefined | null): string {
  return nonEmpty(value) ?? NOT_AVAILABLE;
}

function isRunRecord(value: unknown): value is ExecutionRunRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.runId === 'string' &&
    typeof row.projectId === 'string' &&
    typeof row.timestamp === 'string' &&
    Array.isArray(row.tests)
  );
}

/**
 * History root for a project id. `"default"` → PATHS.reports.history;
 * any other id → projectStores(id).history (never another project's dir).
 */
export function resolveRunRecordHistoryDir(projectId: string, overrideDir?: string): string {
  if (overrideDir) return overrideDir;
  const id = nonEmpty(projectId) ?? DEFAULT_PROJECT_ID;
  if (id === DEFAULT_PROJECT_ID) {
    return PATHS.reports.history;
  }
  return projectStores(id).history;
}

export function runRecordFileName(runId: string): string {
  return `run-${runId}.json`;
}

export function runRecordFilePath(historyDir: string, runId: string): string {
  return path.join(historyDir, runRecordFileName(runId));
}

/**
 * Build one JSON-serializable run record.
 * Omitting runId uses createExecutionId(). Unknown branch/commit/build → NOT_AVAILABLE.
 * durationMs null means not measured — callers must not pass 0 as a fake.
 */
export function buildRunRecord(input: BuildRunRecordInput): ExecutionRunRecord {
  const runId = nonEmpty(input.runId) ?? createExecutionId();
  const record: ExecutionRunRecord = {
    runId,
    projectId: nonEmpty(input.projectId) ?? DEFAULT_PROJECT_ID,
    environment: nonEmpty(input.environment) ?? NOT_AVAILABLE,
    branch: metaOrUnavailable(input.branch),
    commit: metaOrUnavailable(input.commit),
    build: metaOrUnavailable(input.build),
    timestamp: nonEmpty(input.timestamp) ?? new Date().toISOString(),
    tests: input.tests.map((test) => {
      const row: RunRecordTest = {
        testEngine: test.testEngine,
        testId: test.testId,
        status: test.status,
        durationMs: test.durationMs,
      };
      if (test.evidence !== undefined) {
        row.evidence = { ...test.evidence };
      }
      return row;
    }),
  };
  if (input.coveragePct !== undefined) {
    record.coveragePct = input.coveragePct;
  }
  return record;
}

/**
 * Persist a run record under the project's history directory (or options.dir).
 * Same runId twice → throw. Never writes project A into project B's directory.
 */
export function appendRunRecord(
  record: ExecutionRunRecord,
  options: AppendRunRecordOptions = {}
): string {
  if (!record.runId?.trim()) {
    throw new Error('appendRunRecord: runId is required');
  }
  const historyDir = resolveRunRecordHistoryDir(record.projectId, options.dir);
  fs.mkdirSync(historyDir, { recursive: true });
  const filePath = runRecordFilePath(historyDir, record.runId);
  if (fs.existsSync(filePath)) {
    throw new Error(
      `appendRunRecord: runId ${JSON.stringify(record.runId)} already exists at ${filePath}`
    );
  }
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return filePath;
}

/**
 * Load run records from a history directory, sorted by timestamp ascending.
 * Missing dir → empty array (not an error, not a fake run).
 */
export function loadRunRecords(dir: string): ExecutionRunRecord[] {
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const records: ExecutionRunRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith('run-') || !entry.name.endsWith('.json')) continue;
    const full = path.join(dir, entry.name);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8')) as unknown;
      if (isRunRecord(parsed)) {
        records.push(parsed);
      }
    } catch {
      // Skip unreadable / invalid files — do not invent a run.
    }
  }
  records.sort((a, b) => {
    const ta = Date.parse(a.timestamp);
    const tb = Date.parse(b.timestamp);
    const aOk = Number.isFinite(ta);
    const bOk = Number.isFinite(tb);
    if (aOk && bOk && ta !== tb) return ta - tb;
    if (aOk && !bOk) return -1;
    if (!aOk && bOk) return 1;
    return a.runId.localeCompare(b.runId);
  });
  return records;
}

/**
 * Short markdown comparison. Status words appear as themselves (PASS, FAIL, FLAKY, …).
 */
export function renderExecutionComparison(comparison: ExecutionComparison): string {
  const lines: string[] = [
    '# Execution history comparison',
    '',
    `- Current runId: ${comparison.currentRunId}`,
    `- Previous runId: ${comparison.previousRunId ?? 'null'}`,
    '',
    '## newFailures',
  ];

  if (comparison.newFailures.length === 0) {
    lines.push('- (none)');
  } else {
    for (const row of comparison.newFailures) {
      const evidence = row.evidence?.message ? ` — ${row.evidence.message}` : '';
      lines.push(`- ${row.testId}: ${row.status}${evidence}`);
    }
  }

  lines.push('', '## recoveredFailures');
  if (comparison.recoveredFailures.length === 0) {
    lines.push('- (none)');
  } else {
    for (const row of comparison.recoveredFailures) {
      lines.push(`- ${row.testId}: ${row.status}`);
    }
  }

  lines.push('', '## newTests');
  if (comparison.newTests.length === 0) {
    lines.push('- (none)');
  } else {
    for (const row of comparison.newTests) {
      lines.push(`- ${row.testId}: ${row.status}`);
    }
  }

  lines.push('', '## removedTests');
  if (comparison.removedTests.length === 0) {
    lines.push('- (none)');
  } else {
    for (const row of comparison.removedTests) {
      lines.push(`- ${row.testId}: ${row.status}`);
    }
  }

  lines.push('', '## flakyTests');
  if (comparison.flakyTests.length === 0) {
    lines.push('- (none)');
  } else {
    for (const row of comparison.flakyTests) {
      const reason = row.reason ? ` — ${row.reason}` : '';
      lines.push(`- ${row.testId}: ${row.status}${reason}`);
    }
  }

  lines.push('', '## performanceRegressions');
  if (comparison.performanceRegressions.length === 0) {
    lines.push('- (none)');
  } else {
    for (const row of comparison.performanceRegressions) {
      lines.push(
        `- ${row.testId}: previousMs=${row.previousMs} currentMs=${row.currentMs} deltaMs=${row.deltaMs}`
      );
    }
  }

  lines.push('', '## coverageChanges');
  const cov = comparison.coverageChanges;
  if (cov.status === 'NOT_MEASURED') {
    lines.push(`- status: NOT_MEASURED, delta: null`);
  } else {
    lines.push(`- status: ${cov.status}, delta: ${cov.delta}`);
  }

  lines.push('');
  return lines.join('\n');
}
