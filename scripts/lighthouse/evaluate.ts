import type {
  LighthousePageMetrics,
  LighthouseThresholdComparison,
  LighthouseThresholds,
  LighthouseThresholdStatus,
} from './types';
import { NOT_AVAILABLE } from './types';

function asNumber(value: number | typeof NOT_AVAILABLE): number | null {
  return typeof value === 'number' ? value : null;
}

function compare(
  metric: string,
  limit: number | null | undefined,
  actual: number | typeof NOT_AVAILABLE
): LighthouseThresholdComparison {
  if (limit == null) {
    return { metric, limit: null, actual, status: 'NOT_AVAILABLE' };
  }
  const value = asNumber(actual);
  if (value == null) {
    return { metric, limit, actual: NOT_AVAILABLE, status: 'NOT_AVAILABLE' };
  }
  return { metric, limit, actual, status: value <= limit ? 'met' : 'breached' };
}

export function evaluateLighthouseThresholds(
  pages: LighthousePageMetrics[],
  thresholds: LighthouseThresholds | null | undefined
): {
  keys: LighthouseThresholds;
  status: LighthouseThresholdStatus;
  defined: boolean;
  note: string;
  comparisons: LighthouseThresholdComparison[];
} {
  const keys: LighthouseThresholds = {
    lcpMs: thresholds?.lcpMs ?? null,
    cls: thresholds?.cls ?? null,
    inpMs: thresholds?.inpMs ?? null,
    tbtMs: thresholds?.tbtMs ?? null,
    performanceScore: thresholds?.performanceScore ?? null,
    accessibilityScore: thresholds?.accessibilityScore ?? null,
    bestPracticesScore: thresholds?.bestPracticesScore ?? null,
    seoScore: thresholds?.seoScore ?? null,
  };

  const worst: Record<keyof LighthouseThresholds, number | typeof NOT_AVAILABLE> = {
    lcpMs: worstNumeric(pages.map((page) => page.lcpMs), 'max'),
    cls: worstNumeric(pages.map((page) => page.cls), 'max'),
    inpMs: worstNumeric(pages.map((page) => page.inpMs), 'max'),
    tbtMs: worstNumeric(pages.map((page) => page.tbtMs), 'max'),
    performanceScore: worstNumeric(pages.map((page) => page.performanceScore), 'min'),
    accessibilityScore: worstNumeric(pages.map((page) => page.accessibilityScore), 'min'),
    bestPracticesScore: worstNumeric(pages.map((page) => page.bestPracticesScore), 'min'),
    seoScore: worstNumeric(pages.map((page) => page.seoScore), 'min'),
  };

  const scoreCompare = (
    metric: keyof LighthouseThresholds,
    limit: number | null,
    actual: number | typeof NOT_AVAILABLE,
    higherIsBetter: boolean
  ): LighthouseThresholdComparison => {
    if (limit == null) return { metric, limit: null, actual, status: 'NOT_AVAILABLE' };
    const value = asNumber(actual);
    if (value == null) return { metric, limit, actual: NOT_AVAILABLE, status: 'NOT_AVAILABLE' };
    const passed = higherIsBetter ? value >= limit : value <= limit;
    return { metric, limit, actual, status: passed ? 'met' : 'breached' };
  };

  const comparisons: LighthouseThresholdComparison[] = [
    compare('lcpMs', keys.lcpMs, worst.lcpMs),
    compare('cls', keys.cls, worst.cls),
    compare('inpMs', keys.inpMs, worst.inpMs),
    compare('tbtMs', keys.tbtMs, worst.tbtMs),
    scoreCompare('performanceScore', keys.performanceScore ?? null, worst.performanceScore, true),
    scoreCompare('accessibilityScore', keys.accessibilityScore ?? null, worst.accessibilityScore, true),
    scoreCompare('bestPracticesScore', keys.bestPracticesScore ?? null, worst.bestPracticesScore, true),
    scoreCompare('seoScore', keys.seoScore ?? null, worst.seoScore, true),
  ];

  const evaluable = comparisons.filter((row) => row.status === 'met' || row.status === 'breached');
  const defined = evaluable.length > 0;
  const breached = evaluable.some((row) => row.status === 'breached');

  let status: LighthouseThresholdStatus;
  let note: string;
  if (!defined) {
    status = 'RECORDED';
    note =
      'Lighthouse threshold keys are unset (null). Measurements are RECORDED. No numeric SLAs were invented.';
  } else if (breached) {
    status = 'breached';
    note = 'Configured Lighthouse threshold keys were evaluated and at least one was breached.';
  } else {
    status = 'met';
    note = 'Configured Lighthouse threshold keys were evaluated and were met.';
  }

  return { keys, status, defined, note, comparisons };
}

function worstNumeric(
  values: Array<number | typeof NOT_AVAILABLE>,
  mode: 'max' | 'min'
): number | typeof NOT_AVAILABLE {
  const numbers = values.filter((value): value is number => typeof value === 'number');
  if (numbers.length === 0) return NOT_AVAILABLE;
  return mode === 'max' ? Math.max(...numbers) : Math.min(...numbers);
}
