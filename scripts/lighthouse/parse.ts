import { NOT_AVAILABLE, type LighthousePageMetrics } from './types';

interface LighthouseAudit {
  numericValue?: number;
  score?: number | null;
}

interface LighthouseCategory {
  score?: number | null;
}

export interface LighthouseJson {
  requestedUrl?: string;
  finalUrl?: string;
  categories?: Record<string, LighthouseCategory | undefined>;
  audits?: Record<string, LighthouseAudit | undefined>;
}

function numericOrUnavailable(value: number | null | undefined): number | typeof NOT_AVAILABLE {
  if (value == null || Number.isNaN(value)) return NOT_AVAILABLE;
  return value;
}

function scoreOrUnavailable(value: number | null | undefined): number | typeof NOT_AVAILABLE {
  if (value == null || Number.isNaN(value)) return NOT_AVAILABLE;
  return Math.round(value * 100);
}

export function parseLighthouseJson(json: LighthouseJson, fallbackUrl: string): LighthousePageMetrics {
  const audits = json.audits ?? {};
  const categories = json.categories ?? {};
  const url = json.finalUrl || json.requestedUrl || fallbackUrl;

  return {
    url,
    status: 'RECORDED',
    reason: null,
    lcpMs: numericOrUnavailable(audits['largest-contentful-paint']?.numericValue),
    cls: numericOrUnavailable(audits['cumulative-layout-shift']?.numericValue),
    inpMs: numericOrUnavailable(audits['interaction-to-next-paint']?.numericValue),
    tbtMs: numericOrUnavailable(audits['total-blocking-time']?.numericValue),
    performanceScore: scoreOrUnavailable(categories.performance?.score),
    accessibilityScore: scoreOrUnavailable(categories.accessibility?.score),
    bestPracticesScore: scoreOrUnavailable(categories['best-practices']?.score),
    seoScore: scoreOrUnavailable(categories.seo?.score),
  };
}

export function parseLighthouseOutput(raw: string, fallbackUrl: string): LighthousePageMetrics {
  const parsed = JSON.parse(raw) as LighthouseJson;
  return parseLighthouseJson(parsed, fallbackUrl);
}
