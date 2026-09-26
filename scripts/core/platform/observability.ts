import { randomUUID } from 'crypto';
import { redactSecrets, REDACTED_PLACEHOLDER } from '../safety-policy';

/**
 * Structured logs + in-memory metrics — no network I/O.
 * PARTIAL: structured execution logs are produced from makeResult / toExecutionLog
 * with secret/PII values masked. Live log shipping (external collector) is not implemented.
 */
export const OBSERVABILITY_STATUS = 'PARTIAL' as const;

/** Execution-log mask token (maps from redactSecrets `[REDACTED]`). */
export const MASKED_PLACEHOLDER = '[MASKED]' as const;

const NOT_AVAILABLE = 'NOT_AVAILABLE';

export interface LogEventInput {
  executionId: string;
  engine: string;
  message: string;
  traceId?: string;
  fields?: Record<string, unknown>;
}

export interface LogEvent {
  executionId: string;
  engine: string;
  message: string;
  traceId?: string;
  fields?: Record<string, unknown>;
  at: string;
}

/**
 * Structured per-execution log (stable key order in the builder).
 * Attached under `metadata.executionLog` by makeResult.
 */
export interface ExecutionLog {
  runId: string;
  testId: string;
  engine: string;
  startTime: string | null;
  endTime: string | null;
  /** Integer ms when both clocks are real and end >= start; otherwise null (never a fake 0). */
  duration: number | null;
  status: string;
  target: string | null;
  environment: string;
  /** Masked error string only — never a raw error object. null when no error. */
  error: string | null;
  /**
   * Retry count rules:
   * - metadata.retryCount (finite >= 0) wins when present
   * - else metadata.attempts (total attempts) → max(0, attempts - 1)
   * - else if status is FLAKY → null (do not pretend 0 retries)
   * - else → 0
   */
  retryCount: number | null;
}

/**
 * Structural input for toExecutionLog — avoids importing TestResult (circular).
 * Callers pass makeResult output or any compatible row.
 */
export interface ExecutionLogSource {
  id?: string;
  status: string;
  target?: string;
  engine?: string;
  error?: { message?: string };
  metadata?: Record<string, unknown>;
}

const metrics = new Map<string, number>();

/** Unique execution id string. */
export function createExecutionId(): string {
  return randomUUID();
}

/**
 * Build a structured log event. Secret-like field values are redacted.
 * Never puts raw secret-like field values in the returned object.
 */
export function logEvent(input: LogEventInput): LogEvent {
  const fields =
    input.fields === undefined ? undefined : (redactSecrets(input.fields) as Record<string, unknown>);
  return {
    executionId: input.executionId,
    engine: input.engine,
    message: input.message,
    ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
    ...(fields !== undefined ? { fields } : {}),
    at: new Date().toISOString(),
  };
}

/** Increment an in-memory counter. */
export function incrementMetric(name: string): number {
  const next = (metrics.get(name) ?? 0) + 1;
  metrics.set(name, next);
  return next;
}

/** Snapshot of in-memory counters (copy). */
export function snapshotMetrics(): Record<string, number> {
  return Object.fromEntries(metrics.entries());
}

/** Reset in-memory metrics (test helper). */
export function resetMetrics(): void {
  metrics.clear();
}

/**
 * Correlation headers only — no network.
 * Returns `{ 'x-qa-execution-id': id }` only.
 */
export function correlationHeaders(executionId: string): { 'x-qa-execution-id': string } {
  return { 'x-qa-execution-id': executionId };
}

/**
 * Mask a string for execution logs using redactSecrets, then map to [MASKED].
 * Leaves an already-masked `[MASKED]` / `[REDACTED]` value as `[MASKED]` (no double-wrap).
 */
export function maskExecutionLogString(value: string): string {
  const trimmed = value.trim();
  if (trimmed === MASKED_PLACEHOLDER || trimmed === REDACTED_PLACEHOLDER) {
    return MASKED_PLACEHOLDER;
  }
  const redacted = redactSecrets(value);
  const asString = typeof redacted === 'string' ? redacted : MASKED_PLACEHOLDER;
  return asString.split(REDACTED_PLACEHOLDER).join(MASKED_PLACEHOLDER);
}

function readMetaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const raw = meta?.[key];
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

/**
 * Parse a clock value into ISO + epoch ms.
 * Accepts finite numbers (epoch ms) or parseable date strings.
 * Does not invent clocks — returns null when missing/invalid.
 */
function parseClock(value: unknown): { iso: string; ms: number } | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { iso: new Date(value).toISOString(), ms: value };
  }
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) {
      const iso = /^\d{4}-\d{2}-\d{2}T/.test(value.trim()) ? value.trim() : new Date(ms).toISOString();
      return { iso, ms };
    }
  }
  return null;
}

/**
 * duration is null unless both start and end are real clocks.
 * end before start → null (never a negative duration presented as valid).
 */
function computeDurationMs(
  start: { iso: string; ms: number } | null,
  end: { iso: string; ms: number } | null
): number | null {
  if (!start || !end) return null;
  if (end.ms < start.ms) return null;
  return Math.round(end.ms - start.ms);
}

function resolveRetryCount(
  meta: Record<string, unknown> | undefined,
  status: string
): number | null {
  // Prefer explicit retryCount; attempts is total tries → retries = attempts - 1.
  // FLAKY without a count → null (do not pretend 0). Otherwise default 0.
  if (meta) {
    if (typeof meta.retryCount === 'number' && Number.isFinite(meta.retryCount) && meta.retryCount >= 0) {
      return Math.floor(meta.retryCount);
    }
    if (typeof meta.attempts === 'number' && Number.isFinite(meta.attempts)) {
      return Math.max(0, Math.floor(meta.attempts) - 1);
    }
  }
  if (status === 'FLAKY') return null;
  return 0;
}

function resolveEngine(source: ExecutionLogSource): string {
  if (typeof source.engine === 'string' && source.engine.trim()) {
    return source.engine.trim();
  }
  const fromMeta =
    readMetaString(source.metadata, 'engine') ?? readMetaString(source.metadata, 'engineId');
  return fromMeta ?? NOT_AVAILABLE;
}

function resolveRunId(source: ExecutionLogSource): string {
  const fromMeta =
    readMetaString(source.metadata, 'runId') ?? readMetaString(source.metadata, 'executionId');
  return fromMeta ?? NOT_AVAILABLE;
}

function resolveEnvironment(source: ExecutionLogSource): string {
  return readMetaString(source.metadata, 'environment') ?? NOT_AVAILABLE;
}

function resolveError(source: ExecutionLogSource): string | null {
  const message = source.error?.message;
  if (typeof message !== 'string' || !message.trim()) {
    const reason = readMetaString(source.metadata, 'reason');
    if (!reason) return null;
    return maskExecutionLogString(reason);
  }
  return maskExecutionLogString(message);
}

function resolveTarget(source: ExecutionLogSource): string | null {
  const raw =
    typeof source.target === 'string'
      ? source.target
      : readMetaString(source.metadata, 'target');
  if (raw === undefined || raw === '') return null;
  return maskExecutionLogString(raw);
}

/**
 * Build a structured ExecutionLog from a test result (or compatible row).
 * Pure / side-effect-free. Does not invent runIds, clocks, or statuses.
 * Throws when testId (result.id) is blank.
 */
export function toExecutionLog(source: ExecutionLogSource): ExecutionLog {
  const testId = typeof source.id === 'string' ? source.id.trim() : '';
  if (!testId) {
    throw new Error('toExecutionLog requires a non-blank testId (result.id)');
  }

  const meta = source.metadata;
  const start = parseClock(meta?.startTime);
  const end = parseClock(meta?.endTime);
  // Prefer explicit clocks over durationMs — never invent start/end from Date.now().
  const duration = computeDurationMs(start, end);

  // Stable key order for JSON.stringify consumers.
  const log: ExecutionLog = {
    runId: resolveRunId(source),
    testId,
    engine: resolveEngine(source),
    startTime: start ? start.iso : null,
    endTime: end ? end.iso : null,
    duration,
    status: source.status,
    target: resolveTarget(source),
    environment: resolveEnvironment(source),
    error: resolveError(source),
    retryCount: resolveRetryCount(meta, source.status),
  };
  return log;
}

/** One JSON line — every string field must already be masked by toExecutionLog. */
export function formatExecutionLog(log: ExecutionLog): string {
  return JSON.stringify(log);
}
