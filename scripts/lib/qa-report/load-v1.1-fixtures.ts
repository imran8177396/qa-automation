/**
 * Test-only loader for isolated v1.1 report-defect fixtures.
 * Does not read or write the live reports/ directory.
 */
import fs from 'fs';
import path from 'path';
import type { SeoAnalysisResult, SeoFinding, SeoSeverity, SeoSuiteSummary } from '../../seo/types';
import type { StageTimeline, StageTimelineRow } from '../stage-timeline';
import type { PlaywrightSuiteSummary } from '../playwright-suite-summary';

export const V11_FIXTURE_DIR = path.join(__dirname, 'fixtures', 'v1.1');

export function readV11Json<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(V11_FIXTURE_DIR, rel), 'utf8')) as T;
}

export interface V11SeoSeed {
  pageCount: number;
  pagePrefix: string;
  template: {
    rule: string;
    severity: SeoSeverity;
    detail: string;
  };
}

/** Expand the v1.1 seed into suite + discovery copies (61 × 2 = 122 raw). */
export function expandV11SeoDuplicates(seed: V11SeoSeed): {
  suite: SeoFinding[];
  discovery: SeoFinding[];
} {
  const suite: SeoFinding[] = [];
  const discovery: SeoFinding[] = [];
  for (let i = 1; i <= seed.pageCount; i += 1) {
    const page = `${seed.pagePrefix}${i}`;
    suite.push({
      id: `SEO-${String(i).padStart(4, '0')}`,
      page,
      rule: seed.template.rule,
      severity: seed.template.severity,
      detail: seed.template.detail,
    });
    discovery.push({
      id: `SEO-D-${String(i).padStart(4, '0')}`,
      page,
      rule: seed.template.rule,
      severity: seed.template.severity,
      detail: seed.template.detail,
    });
  }
  return { suite, discovery };
}

export function loadV11SeoSuiteSummary(): SeoSuiteSummary {
  return readV11Json<SeoSuiteSummary>('seo/suite-summary.json');
}

export function loadV11SeoDiscovery(): SeoAnalysisResult {
  return readV11Json<SeoAnalysisResult>('seo/discovery.json');
}

export function loadV11SeoSeed(): V11SeoSeed {
  return readV11Json<V11SeoSeed>('seo/seed.json');
}

export function loadV11WorkflowSummary(): {
  passed?: boolean;
  workflows?: Array<{ id: string; name: string; uiPath: string; api: string }>;
  note?: string;
} {
  return readV11Json('workflows/summary.json');
}

export function loadV11ResponsiveSummary(): {
  target: string;
  targetOrigin: string;
  configuredBaseUrl: string;
  originStatus: string;
  passed: boolean;
} {
  return readV11Json('responsive/summary.json');
}

export function loadV11ResponsiveSuiteSummary(): PlaywrightSuiteSummary {
  return readV11Json<PlaywrightSuiteSummary>('playwright/responsive-suite-summary.json');
}

export function loadV11GeneratedCheckSuiteSummary(): PlaywrightSuiteSummary {
  return readV11Json<PlaywrightSuiteSummary>('playwright/generated-check-suite-summary.json');
}

export function loadV11CollisionPaths(): Record<string, string> {
  return readV11Json<Record<string, string>>('playwright/collision-paths.json');
}

export function loadV11Timeline(): StageTimeline {
  const raw = readV11Json<{ generatedAt: string; stages: StageTimelineRow[] }>('orchestrator/timeline.json');
  return {
    generatedAt: raw.generatedAt,
    stages: raw.stages,
    ordering: {
      ok: false,
      discoveryCompletedAt: raw.stages.find((row) => row.key === 'discovery')?.completedAt ?? 'NOT_AVAILABLE',
      firstExecutionStartedAt: raw.stages.find((row) => row.phase === 'execution')?.startedAt ?? 'NOT_AVAILABLE',
      violations: [],
    },
  };
}

export function loadV11ConflictingPassRates(): Array<{
  scope: string;
  passed: number;
  failed: number;
  skipped: number;
}> {
  return readV11Json<{ rates: Array<{ scope: string; passed: number; failed: number; skipped: number }> }>(
    'quality/conflicting-pass-rates.json'
  ).rates;
}

export function loadV11DanglingRef(): { prose: string; unemittedValidId: string } {
  return readV11Json('quality/dangling-ref.json');
}
