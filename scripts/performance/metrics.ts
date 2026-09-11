import fs from 'fs';
import { isLivenessProfile } from './profiles';
import type {
  JmeterThresholds,
  PerformanceMetrics,
  PerformanceProfile,
  PerformanceSample,
  PerformanceThresholdResult,
  ThresholdComparison,
} from './types';

export const NOT_AVAILABLE = 'NOT_AVAILABLE';

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

/** Nearest-rank percentile. Empty input is NOT_AVAILABLE (null). */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function columnIndex(header: string[], ...names: string[]): number {
  const wanted = names.map((name) => name.toLowerCase());
  return header.findIndex((col) => wanted.includes(col.trim().toLowerCase()));
}

function cell(cols: string[], index: number): string {
  if (index < 0) return '';
  return (cols[index] ?? '').trim();
}

function numericCell(cols: string[], index: number): number | null {
  const raw = cell(cols, index);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function hasHeader(firstLine: string): boolean {
  const cols = parseCsvLine(firstLine).map((col) => col.trim().toLowerCase());
  return cols.includes('elapsed') || cols.includes('label') || cols.includes('timestamp');
}

function throughputPerSec(timestampsMs: number[], elapsedMs: number[], requestCount: number): number | null {
  if (requestCount === 0 || timestampsMs.length === 0) return null;
  let end = timestampsMs[0] ?? 0;
  for (let i = 0; i < timestampsMs.length; i += 1) {
    const finish = (timestampsMs[i] ?? 0) + (elapsedMs[i] ?? 0);
    if (finish > end) end = finish;
  }
  const start = Math.min(...timestampsMs);
  const durationSec = (end - start) / 1000;
  if (!(durationSec > 0)) return null;
  return requestCount / durationSec;
}

export function parseJmeterJtl(filePath: string): { metrics: PerformanceMetrics; samples: PerformanceSample[] } | null {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return null;

  const headed = hasHeader(lines[0] ?? '');
  const header = headed ? parseCsvLine(lines[0] ?? '').map((col) => col.trim()) : [];
  const dataLines = headed ? lines.slice(1) : lines;
  if (dataLines.length === 0) return null;

  const elapsedIdx = headed ? columnIndex(header, 'elapsed') : 1;
  const labelIdx = headed ? columnIndex(header, 'label') : 2;
  const codeIdx = headed ? columnIndex(header, 'responseCode', 'responsecode') : 3;
  const messageIdx = headed ? columnIndex(header, 'responseMessage', 'responsemessage') : 4;
  const threadIdx = headed ? columnIndex(header, 'threadName', 'threadname') : 5;
  const successIdx = headed ? columnIndex(header, 'success') : 7;
  const urlIdx = headed ? columnIndex(header, 'URL', 'url') : -1;
  const latencyIdx = headed ? columnIndex(header, 'Latency', 'latency') : -1;
  const connectIdx = headed ? columnIndex(header, 'Connect', 'connect') : -1;
  const timestampIdx = headed ? columnIndex(header, 'timeStamp', 'timestamp') : 0;

  const elapsed: number[] = [];
  const latencies: number[] = [];
  const connects: number[] = [];
  const timestamps: number[] = [];
  const samples: PerformanceSample[] = [];
  let failures = 0;

  for (const line of dataLines) {
    const cols = parseCsvLine(line);
    if (cols.length < 4) continue;
    const successRaw = cell(cols, successIdx).toLowerCase();
    const success = successRaw === 'true' || successRaw === '1';
    const ms = numericCell(cols, elapsedIdx);
    if (ms != null) elapsed.push(ms);
    const ttfb = numericCell(cols, latencyIdx);
    if (ttfb != null) latencies.push(ttfb);
    const connect = numericCell(cols, connectIdx);
    if (connect != null) connects.push(connect);
    const timestamp = numericCell(cols, timestampIdx);
    if (timestamp != null) timestamps.push(timestamp);
    if (!success) failures += 1;

    const urlRaw = cell(cols, urlIdx);
    const threadRaw = cell(cols, threadIdx);
    samples.push({
      label: cell(cols, labelIdx) || 'request',
      success,
      responseMessage: cell(cols, messageIdx) || undefined,
      url: urlRaw || NOT_AVAILABLE,
      thread: threadRaw || NOT_AVAILABLE,
      responseCode: cell(cols, codeIdx) || undefined,
      elapsedMs: ms ?? undefined,
      ttfbMs: ttfb,
      timestampMs: timestamp ?? undefined,
    });
  }

  if (samples.length === 0) return null;

  const requestCount = samples.length;
  const successful = requestCount - failures;
  const avg = mean(elapsed);

  return {
    samples,
    metrics: {
      requestCount,
      failures,
      successful,
      errorRatePercent: requestCount === 0 ? 0 : (failures / requestCount) * 100,
      avgMs: avg == null ? 0 : Math.round(avg),
      minMs: elapsed.length ? Math.min(...elapsed) : 0,
      maxMs: elapsed.length ? Math.max(...elapsed) : 0,
      p50Ms: percentile(elapsed, 50),
      p90Ms: percentile(elapsed, 90),
      p95Ms: percentile(elapsed, 95),
      p99Ms: percentile(elapsed, 99),
      ttfbMs: mean(latencies) == null ? null : Math.round(mean(latencies) as number),
      throughputPerSec: throughputPerSec(timestamps, elapsed, requestCount),
      avgLatencyMs: mean(latencies) == null ? null : Math.round(mean(latencies) as number),
      avgConnectMs: mean(connects) == null ? null : Math.round(mean(connects) as number),
    },
  };
}

function comparison(
  metric: string,
  limit: number | null | undefined,
  actual: number | null | undefined
): ThresholdComparison {
  if (limit == null) {
    return { metric, limit: null, actual: actual ?? null, passed: null, status: 'NOT_AVAILABLE' };
  }
  if (actual == null) {
    return { metric, limit, actual: null, passed: null, status: 'NOT_AVAILABLE' };
  }
  const passed = actual <= limit;
  return { metric, limit, actual, passed, status: passed ? 'met' : 'breached' };
}

export function evaluateThresholds(
  metrics: PerformanceMetrics | null,
  thresholds: JmeterThresholds | null | undefined,
  profile?: PerformanceProfile
): PerformanceThresholdResult {
  if (!metrics) {
    return {
      status: 'NOT_AVAILABLE',
      defined: false,
      note: 'No metrics were collected — thresholds were not evaluated.',
      comparisons: [],
    };
  }

  const comparisons: ThresholdComparison[] = [
    comparison('errorRatePercent', thresholds?.maxErrorRatePercent, metrics.errorRatePercent),
    comparison('p95Ms', thresholds?.maxP95Ms, metrics.p95Ms),
  ];
  if (thresholds?.maxAvgMs != null) {
    comparisons.push(comparison('avgMs', thresholds.maxAvgMs, metrics.avgMs));
  }

  const evaluable = comparisons.filter((row) => row.status === 'met' || row.status === 'breached');
  const breached = evaluable.some((row) => row.status === 'breached');
  const anyDefined = evaluable.length > 0;

  let status: PerformanceThresholdResult['status'];
  let note: string;

  if (isLivenessProfile(profile)) {
    status = 'RECORDED';
    note =
      'Liveness profile (few samples) cannot support a PASS verdict. Measurements are RECORDED. Threshold keys are listed; null values stay NOT_AVAILABLE.';
  } else if (!anyDefined) {
    status = 'RECORDED';
    note =
      'Threshold keys are present or omitted without numeric SLAs. Measurements are RECORDED. Status is not PASS.';
  } else if (breached) {
    status = 'breached';
    note = 'Configured performance thresholds were evaluated from JTL metrics and at least one was breached.';
  } else {
    status = 'met';
    note = 'Configured performance thresholds were evaluated from JTL metrics and were met.';
  }

  return {
    status,
    defined: anyDefined,
    note,
    comparisons,
  };
}
