import fs from 'fs';
import { readJsonIfExists, writeJson } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import { HEAVY_PERFORMANCE_PROFILES } from './plans';
import type { PerformanceStageSummary, PerformanceSummary, UiPerformanceSummary } from './types';

/** Minimal lighthouse shape — avoids importing lighthouse/types into jmeter-only callers. */
interface LighthouseSummaryLike {
  status?: 'RECORDED' | 'NOT_EXECUTED';
}

function jmeterWebsiteNote(summary: PerformanceSummary | null): string | undefined {
  if (!summary) return undefined;
  if (summary.targetSource !== 'website') return undefined;
  return 'Liveness against the website under test, no API URL configured; status RECORDED, not PASS';
}

/**
 * Refresh reports/performance/stage.json from the current UI / JMeter / Lighthouse
 * summaries on disk. Shared by `npm run test:performance` and standalone
 * JMeter entry points so a direct JMeter run does not leave a stale stage file.
 */
export function writePerformanceStageSummary(input?: {
  command?: string;
  authorizeHeavy?: boolean;
  profile?: string;
}): PerformanceStageSummary {
  const ui = readJsonIfExists<UiPerformanceSummary>(PATHS.uiPerformanceSummary);
  const jmeter = readJsonIfExists<PerformanceSummary>(PATHS.jmeterSummary);
  const lighthouse = readJsonIfExists<LighthouseSummaryLike>(PATHS.lighthouseSummary);
  const stage: PerformanceStageSummary = {
    ranAt: new Date().toISOString(),
    command: input?.command ?? 'npm run test:performance',
    authorizeHeavy: Boolean(input?.authorizeHeavy),
    profile: input?.profile ?? jmeter?.profile ?? 'liveness',
    heavyProfiles: [...HEAVY_PERFORMANCE_PROFILES],
    ui: {
      status: ui?.status ?? 'NOT_EXECUTED',
      artifact: 'reports/performance/summary.json',
    },
    jmeter: {
      status: jmeter?.status ?? 'NOT_EXECUTED',
      profile: jmeter?.profile ?? input?.profile ?? 'liveness',
      heavy: Boolean(jmeter?.heavy),
      artifact: 'reports/jmeter/summary.json',
      targetSource: jmeter?.targetSource,
      note: jmeterWebsiteNote(jmeter),
    },
    lighthouse: {
      status: lighthouse?.status ?? 'NOT_EXECUTED',
      artifact: 'reports/lighthouse/summary.json',
    },
  };
  fs.mkdirSync(PATHS.reports.performance, { recursive: true });
  writeJson(PATHS.performanceStageSummary, stage);
  return stage;
}
