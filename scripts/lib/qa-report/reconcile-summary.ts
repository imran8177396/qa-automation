import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths';
import type { QaConfig } from '../../types';

export interface SummaryToolResult {
  name: string;
  tool: string;
  passed: boolean;
  report?: string;
}

export interface SummaryFile {
  ranAt: string;
  results: SummaryToolResult[];
}

interface PlaywrightJsonReport {
  stats?: {
    startTime?: string;
    unexpected?: number;
    skipped?: number;
  };
}

interface PlaywrightRow {
  status: string;
}

interface PostmanReport {
  run?: {
    meta?: { started?: number };
    summary?: {
      executedRequests?: { executed: number; errors: number };
      tests?: { failed: number; executed: number };
    };
  };
}

interface JmeterStats {
  samples: unknown[];
  errors: number;
}

export function playwrightPassedFromArtifacts(
  playwright: PlaywrightJsonReport | null,
  pwRows: PlaywrightRow[]
): boolean | null {
  if (playwright?.stats?.unexpected !== undefined) {
    return playwright.stats.unexpected === 0;
  }

  if (pwRows.length === 0) {
    return null;
  }

  return pwRows.every((row) => row.status === 'PASS' || row.status === 'SKIPPED');
}

export function postmanPassedFromArtifacts(postman: PostmanReport | null): boolean | null {
  const summary = postman?.run?.summary;
  if (!summary) {
    return null;
  }

  const requestErrors = summary.executedRequests?.errors ?? 0;
  const assertionFailures = summary.tests?.failed ?? 0;
  const executed = summary.executedRequests?.executed ?? 0;

  if (executed === 0) {
    return null;
  }

  return requestErrors === 0 && assertionFailures === 0;
}

export function jmeterPassedFromArtifacts(jmeter: JmeterStats | null): boolean | null {
  if (!jmeter) {
    return null;
  }

  if (jmeter.samples.length === 0) {
    return null;
  }

  return jmeter.errors === 0;
}

function defaultToolResults(config: QaConfig): SummaryToolResult[] {
  const results: SummaryToolResult[] = [];

  if (config.playwright.enabled) {
    results.push({
      name: 'E2E / UI',
      tool: 'Playwright',
      passed: false,
      report: PATHS.reports.playwright,
    });
  }

  if (config.postman.enabled) {
    results.push({
      name: 'API',
      tool: 'Postman CLI',
      passed: false,
      report: path.join(PATHS.reports.postman, 'report.json'),
    });
  }

  if (config.jmeter.enabled) {
    results.push({
      name: 'Performance',
      tool: 'JMeter',
      passed: false,
      report: path.join(PATHS.reports.jmeter, 'html'),
    });
  }

  return results;
}

function resolvePassed(
  tool: string,
  summaryValue: boolean | undefined,
  artifactValue: boolean | null
): boolean {
  if (artifactValue !== null) {
    return artifactValue;
  }

  return summaryValue ?? false;
}

export function reconcileSummary(
  config: QaConfig,
  summary: SummaryFile | null,
  playwright: PlaywrightJsonReport | null,
  pwRows: PlaywrightRow[],
  postman: PostmanReport | null,
  jmeter: JmeterStats | null
): SummaryFile {
  const baseResults =
    summary?.results?.length ? summary.results : defaultToolResults(config);

  const playwrightArtifact = playwrightPassedFromArtifacts(playwright, pwRows);
  const postmanArtifact = postmanPassedFromArtifacts(postman);
  const jmeterArtifact = jmeterPassedFromArtifacts(jmeter);

  const results = baseResults.map((item) => {
    switch (item.tool) {
      case 'Playwright':
        return {
          ...item,
          passed: resolvePassed(item.tool, item.passed, playwrightArtifact),
          report: item.report ?? PATHS.reports.playwright,
        };
      case 'Postman CLI':
        return {
          ...item,
          passed: resolvePassed(item.tool, item.passed, postmanArtifact),
          report: item.report ?? path.join(PATHS.reports.postman, 'report.json'),
        };
      case 'JMeter':
        return {
          ...item,
          passed: resolvePassed(item.tool, item.passed, jmeterArtifact),
          report: item.report ?? path.join(PATHS.reports.jmeter, 'html'),
        };
      default:
        return item;
    }
  });

  const ranAtCandidates = [
    summary?.ranAt ? Date.parse(summary.ranAt) : Number.NaN,
    playwright?.stats?.startTime ? Date.parse(playwright.stats.startTime) : Number.NaN,
    postman?.run?.meta?.started ?? Number.NaN,
  ];

  const jtlPath = path.join(PATHS.reports.jmeter, 'results.jtl');
  if (fs.existsSync(jtlPath)) {
    ranAtCandidates.push(fs.statSync(jtlPath).mtimeMs);
  }

  const validTimes = ranAtCandidates.filter((value) => !Number.isNaN(value));
  const ranAt = new Date(validTimes.length > 0 ? Math.max(...validTimes) : Date.now()).toISOString();

  return { ranAt, results };
}

export function writeSummaryFile(summary: SummaryFile): string {
  const summaryPath = path.join(PATHS.reports.root, 'summary.json');
  fs.mkdirSync(PATHS.reports.root, { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summaryPath;
}
