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

export type UiPerformanceCheckStatus = 'APPLICABLE' | 'NOT_APPLICABLE';

export interface UiPerformanceCheckPlan {
  id: string;
  name: string;
  status: UiPerformanceCheckStatus;
  reason: string;
}

export interface UiPerformancePageDef {
  path: string;
  name: string;
  url: string;
  source: 'discovery' | 'fixture' | 'homepage-fallback';
}

export interface UiNetworkEntry {
  url: string;
  method: string;
  resourceType: string;
  status: number | null;
  timingMs: number | null;
}

export interface UiNavigationTiming {
  ttfbMs: number | null;
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
  durationMs: number | null;
  transferSize: number | null;
  dnsMs: number | null;
  connectMs: number | null;
  requestMs: number | null;
}

export interface UiPaintTiming {
  firstPaintMs: number | null;
  firstContentfulPaintMs: number | null;
}

export interface UiResourceTimingRow {
  name: string;
  initiatorType: string;
  durationMs: number | null;
  transferSize: number | null;
}

/**
 * Playwright-measured page timings. Web Vitals are recorded only when the
 * browser exposes them. Missing values stay NOT_AVAILABLE — never invented.
 * Official CWV / category scores belong to Lighthouse, not this artifact.
 */
export interface UiTimingMeasurement {
  url: string;
  pageName: string;
  httpStatus: number | null;
  navigation: UiNavigationTiming | null;
  paint: UiPaintTiming;
  lcpMs: number | null;
  cls: number | null;
  inpMs: null;
  resourceCount: number;
  xhrOrFetchCount: number;
  resources: UiResourceTimingRow[];
  network: UiNetworkEntry[];
}

export type UiPerformanceRunStatus = 'RECORDED' | 'NOT_EXECUTED';

export interface UiPerformanceSummary {
  ranAt: string;
  source: 'playwright-ui';
  label: 'Playwright UI page / navigation / resource timing';
  separateFromJmeter: true;
  separateFromLighthouse: true;
  status: UiPerformanceRunStatus;
  skipReason: string | null;
  pageSource: string | null;
  target: string | null;
  httpStatus: number | null;
  measurement: UiTimingMeasurement | null;
  applicability: UiPerformanceCheckPlan[];
  thresholds: {
    status: 'RECORDED' | 'NOT_AVAILABLE';
    defined: boolean;
    note: string;
  };
}

export interface PerformanceStageSummary {
  ranAt: string;
  command: string;
  authorizeHeavy: boolean;
  profile: CanonicalPerformanceProfile;
  heavyProfiles: CanonicalPerformanceProfile[];
  ui: { status: UiPerformanceRunStatus | 'NOT_EXECUTED'; artifact: string };
  jmeter: { status: PerformanceRunStatus; profile: CanonicalPerformanceProfile; heavy: boolean; artifact: string };
  lighthouse: { status: 'RECORDED' | 'NOT_EXECUTED'; artifact: string };
}
