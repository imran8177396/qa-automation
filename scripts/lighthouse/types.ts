export const NOT_AVAILABLE = 'NOT_AVAILABLE';
export const NOT_EXECUTED = 'NOT_EXECUTED';

/**
 * Threshold keys only. Values stay null until the project sets SLAs.
 * Never invent industry-standard numbers.
 */
export interface LighthouseThresholds {
  lcpMs?: number | null;
  cls?: number | null;
  inpMs?: number | null;
  tbtMs?: number | null;
  performanceScore?: number | null;
  accessibilityScore?: number | null;
  bestPracticesScore?: number | null;
  seoScore?: number | null;
}

export type LighthouseRunStatus = 'RECORDED' | 'NOT_EXECUTED';
export type LighthouseThresholdStatus = 'RECORDED' | 'NOT_AVAILABLE' | 'met' | 'breached';

export interface LighthousePageMetrics {
  url: string;
  status: LighthouseRunStatus | 'ERROR';
  reason: string | null;
  lcpMs: number | typeof NOT_AVAILABLE;
  cls: number | typeof NOT_AVAILABLE;
  inpMs: number | typeof NOT_AVAILABLE;
  tbtMs: number | typeof NOT_AVAILABLE;
  performanceScore: number | typeof NOT_AVAILABLE;
  accessibilityScore: number | typeof NOT_AVAILABLE;
  bestPracticesScore: number | typeof NOT_AVAILABLE;
  seoScore: number | typeof NOT_AVAILABLE;
}

export interface LighthouseThresholdComparison {
  metric: string;
  limit: number | null;
  actual: number | typeof NOT_AVAILABLE;
  status: LighthouseThresholdStatus;
}

export interface LighthouseSummary {
  ranAt: string;
  source: 'lighthouse';
  label: 'Core Web Vitals / Lighthouse';
  separateFromJmeter: true;
  status: LighthouseRunStatus;
  skipReason: string | null;
  pageSource: string | null;
  chromePath: string | null;
  lighthouseCommand: string | null;
  pages: LighthousePageMetrics[];
  thresholds: {
    keys: LighthouseThresholds;
    status: LighthouseThresholdStatus;
    defined: boolean;
    note: string;
    comparisons: LighthouseThresholdComparison[];
  };
}

export interface UniquePageSet {
  urls: string[];
  source: string;
}
