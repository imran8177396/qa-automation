export const PERFORMANCE_PROFILES = ['liveness', 'load', 'stress', 'spike', 'soak'] as const;

export type CanonicalPerformanceProfile = (typeof PERFORMANCE_PROFILES)[number];

/** `smoke` is a deprecated alias for `liveness` and is normalized at the runner boundary. */
export type PerformanceProfile = CanonicalPerformanceProfile | 'smoke';

export interface PerformanceProfilePlan {
  threads: number;
  rampUpSeconds: number;
  loopCount: number;
  durationSeconds?: number;
}

/**
 * Optional acceptance limits. Keys may be present with null values.
 * Null / omitted values are NOT_AVAILABLE — never treated as invented SLAs.
 */
export interface JmeterThresholds {
  maxErrorRatePercent?: number | null;
  maxAvgMs?: number | null;
  maxP95Ms?: number | null;
}

export interface PerformanceMetrics {
  requestCount: number;
  failures: number;
  successful: number;
  errorRatePercent: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  /** Average JMeter Latency (TTFB). Null when the Latency column is absent. */
  ttfbMs: number | null;
  throughputPerSec: number | null;
  avgLatencyMs: number | null;
  avgConnectMs: number | null;
}

export interface PerformanceSample {
  label: string;
  success: boolean;
  responseMessage?: string;
  /** Sample URL from JTL, or `NOT_AVAILABLE` when the column is absent/empty. */
  url: string;
  thread: string;
  responseCode?: string;
  elapsedMs?: number;
  ttfbMs?: number | null;
  timestampMs?: number;
}

export interface ThresholdComparison {
  metric: string;
  limit: number | null;
  actual: number | null;
  passed: boolean | null;
  status: 'met' | 'breached' | 'NOT_AVAILABLE';
}

export type PerformanceThresholdStatus = 'met' | 'breached' | 'RECORDED' | 'NOT_AVAILABLE';

export interface PerformanceThresholdResult {
  status: PerformanceThresholdStatus;
  defined: boolean;
  note: string;
  comparisons: ThresholdComparison[];
}

export type PerformanceRunStatus = 'RECORDED' | 'NOT_EXECUTED' | 'BLOCKED' | 'breached' | 'met' | 'NOT_AVAILABLE';

export interface PerformanceSummary {
  ranAt: string;
  profile: CanonicalPerformanceProfile;
  /** Liveness (and its smoke alias) is never a PASS verdict. */
  status: PerformanceRunStatus;
  heavy: boolean;
  authorized: boolean;
  skipped: boolean;
  skipReason: string | null;
  blocked: boolean;
  blockReason: string | null;
  jmeterAvailable: boolean;
  target: string;
  host: string;
  method: string;
  path: string;
  plan: string;
  threads: number;
  rampUpSeconds: number;
  loopCount: number;
  durationSeconds: number | null;
  metrics: PerformanceMetrics | null;
  samples: PerformanceSample[];
  thresholds: PerformanceThresholdResult;
}
