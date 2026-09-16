import fs from 'fs';
import path from 'path';
import { readJsonIfExists } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import { PLAYWRIGHT_SUITE_OUTPUT_PATHS } from '../lib/playwright-suites';
import { allureResultsPresent, dirHasHtmlIndex, listPlaywrightHtmlReports } from '../lib/report-kinds';
import { resolveSuiteStatus, type SuiteStatus } from '../lib/suite-status';
import type { StageStatus } from './types';

export interface ExecutedItemCounts {
  executedCount: number;
  failedCount: number;
  passedCount: number;
  dryRun?: boolean;
  selectedCount?: number;
  recorded?: boolean;
}

interface PlaywrightStats {
  stats?: { expected?: number; unexpected?: number; skipped?: number };
}

interface CountHolder {
  executed?: number;
  selected?: number;
  dryRun?: boolean;
  analyzed?: number;
  pagesAnalyzed?: number;
  pages?: unknown[] | number;
  elements?: unknown[];
  findings?: unknown[];
    workflows?: unknown[];
  correlatedExecuted?: number;
  correlationUsed?: boolean;
  checks?: unknown[];
  items?: unknown[];
  samples?: unknown[];
  requestCount?: number;
  failures?: number;
  successful?: number;
  byFinalStatus?: { PASS?: number; FAIL?: number; NOT_EXECUTED?: number };
}

function playwrightCounts(filePath: string): ExecutedItemCounts | null {
  const raw = readJsonIfExists<PlaywrightStats>(filePath);
  if (!raw?.stats) return null;
  const passedCount = raw.stats.expected ?? 0;
  const failedCount = raw.stats.unexpected ?? 0;
  return { executedCount: passedCount + failedCount, failedCount, passedCount };
}

function arrayCount(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function numberCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Read executed-item counts from a stage's known artifact. Returns null when
 * the artifact is absent — callers must not invent a count.
 */
export function readStageExecutedCounts(key: string): ExecutedItemCounts | null {
  switch (key) {
    case 'preflight': {
      const raw = readJsonIfExists<CountHolder>(path.join(PATHS.reports.root, 'preflight.json'));
      const executedCount = arrayCount(raw?.checks);
      return executedCount == null ? null : { executedCount, failedCount: 0, passedCount: executedCount };
    }
    case 'discovery': {
      const raw = readJsonIfExists<CountHolder>(PATHS.discoveryFile);
      const executedCount = arrayCount(raw?.pages);
      return executedCount == null ? null : { executedCount, failedCount: 0, passedCount: executedCount };
    }
    case 'inventory': {
      const raw = readJsonIfExists<CountHolder>(PATHS.inventoryFile);
      const executedCount = arrayCount(raw?.elements);
      return executedCount == null ? null : { executedCount, failedCount: 0, passedCount: executedCount };
    }
    case 'coverage-planning': {
      const raw = readJsonIfExists<unknown[]>(PATHS.plannedChecksFile);
      const executedCount = arrayCount(raw);
      return executedCount == null ? null : { executedCount, failedCount: 0, passedCount: executedCount };
    }
    case 'e2e': {
      const e2e = playwrightCounts(PLAYWRIGHT_SUITE_OUTPUT_PATHS.e2e);
      const generated = playwrightCounts(PLAYWRIGHT_SUITE_OUTPUT_PATHS['generated-check']);
      if (!e2e && !generated) return null;
      return {
        executedCount: (e2e?.executedCount ?? 0) + (generated?.executedCount ?? 0),
        failedCount: (e2e?.failedCount ?? 0) + (generated?.failedCount ?? 0),
        passedCount: (e2e?.passedCount ?? 0) + (generated?.passedCount ?? 0),
      };
    }
    case 'visual':
      return playwrightCounts(PLAYWRIGHT_SUITE_OUTPUT_PATHS.visual);
    case 'responsive': {
      const raw = readJsonIfExists<CountHolder>(path.join(PATHS.reports.responsive, 'findings.json'));
      const executedCount = arrayCount(raw?.findings);
      return executedCount == null ? null : { executedCount, failedCount: 0, passedCount: executedCount };
    }
    case 'cross-browser':
      return playwrightCounts(PLAYWRIGHT_SUITE_OUTPUT_PATHS['cross-browser']);
    case 'accessibility': {
      const raw = readJsonIfExists<CountHolder>(path.join(PATHS.reports.accessibility, 'summary.json'));
      const executedCount = numberCount(raw?.pagesAnalyzed);
      return executedCount == null ? null : { executedCount, failedCount: 0, passedCount: executedCount };
    }
    case 'api': {
      const raw = readJsonIfExists<{
        run?: { summary?: { tests?: { executed?: number; failed?: number; passed?: number } } };
      }>(path.join(PATHS.reports.postman, 'report.json'));
      const tests = raw?.run?.summary?.tests;
      if (!tests || typeof tests.executed !== 'number') return null;
      return {
        executedCount: tests.executed,
        failedCount: tests.failed ?? 0,
        passedCount: tests.passed ?? Math.max(0, tests.executed - (tests.failed ?? 0)),
      };
    }
    case 'performance': {
      const raw = readJsonIfExists<CountHolder>(PATHS.jmeterSummary);
      const executedCount = numberCount(raw?.requestCount) ?? arrayCount(raw?.samples);
      if (executedCount == null) return null;
      const failedCount = numberCount(raw?.failures) ?? 0;
      const passedCount = numberCount(raw?.successful) ?? Math.max(0, executedCount - failedCount);
      return { executedCount, failedCount, passedCount };
    }
    case 'security': {
      const raw = readJsonIfExists<CountHolder>(path.join(PATHS.reports.security, 'summary.json'));
      const executedCount = numberCount(raw?.pagesAnalyzed) ?? arrayCount(raw?.findings);
      return executedCount == null ? null : { executedCount, failedCount: 0, passedCount: executedCount };
    }
    case 'dependencies': {
      // Mirrors the 'security' case: executedCount is scope scanned, not a
      // pass/fail tally — the process exit code (processFailed) carries FAIL.
      const raw = readJsonIfExists<{ packagesScanned?: number; filesScanned?: number }>(
        path.join(PATHS.reports.dependencies, 'summary.json')
      );
      if (!raw) return null;
      const executedCount = (raw.packagesScanned ?? 0) + (raw.filesScanned ?? 0);
      return executedCount <= 0 ? null : { executedCount, failedCount: 0, passedCount: executedCount };
    }
    case 'seo': {
      const raw = readJsonIfExists<CountHolder>(path.join(PATHS.reports.seo, 'summary.json'));
      const executedCount = numberCount(raw?.pagesAnalyzed);
      return executedCount == null ? null : { executedCount, failedCount: 0, passedCount: executedCount };
    }
    case 'content': {
      const raw = readJsonIfExists<CountHolder>(path.join(PATHS.reports.content, 'summary.json'));
      const executedCount = numberCount(raw?.pagesAnalyzed);
      return executedCount == null ? null : { executedCount, failedCount: 0, passedCount: executedCount };
    }
    case 'workflows': {
      const raw = readJsonIfExists<CountHolder>(path.join(PATHS.reports.workflows, 'summary.json'));
      if (!raw) return null;
      const correlatedExecuted = numberCount(raw.correlatedExecuted);
      if (correlatedExecuted != null) {
        return {
          executedCount: correlatedExecuted,
          failedCount: 0,
          passedCount: correlatedExecuted,
          recorded: raw.correlationUsed === false && (arrayCount(raw.workflows) ?? 0) > 0,
          selectedCount: arrayCount(raw.workflows) ?? 0,
        };
      }
      const executedCount = arrayCount(raw.workflows);
      return executedCount == null ? null : { executedCount, failedCount: 0, passedCount: executedCount };
    }
    case 'analyze': {
      const raw = readJsonIfExists<CountHolder>(path.join(PATHS.reports.failures, 'summary.json'));
      const executedCount = numberCount(raw?.analyzed);
      if (executedCount == null) return null;
      return { executedCount: 0, failedCount: 0, passedCount: 0, recorded: true, selectedCount: executedCount };
    }
    case 'retest': {
      const raw = readJsonIfExists<CountHolder>(path.join(PATHS.reports.retest, 'summary.json'));
      if (!raw) return { executedCount: 0, failedCount: 0, passedCount: 0 };
      return {
        executedCount: numberCount(raw.executed) ?? 0,
        failedCount: numberCount(raw.byFinalStatus?.FAIL) ?? 0,
        passedCount: numberCount(raw.byFinalStatus?.PASS) ?? 0,
        dryRun: raw.dryRun === true,
        selectedCount: numberCount(raw.selected) ?? 0,
        recorded: raw.dryRun !== true && (numberCount(raw.selected) ?? 0) > 0,
      };
    }
    case 'coverage': {
      const raw = readJsonIfExists<{ items?: unknown[]; totals?: { testableItems?: number } }>(PATHS.coverageJsonFile);
      const executedCount = arrayCount(raw?.items) ?? numberCount(raw?.totals?.testableItems);
      return executedCount == null ? null : { executedCount, failedCount: 0, passedCount: executedCount };
    }
    case 'allure': {
      if (!allureResultsPresent(PATHS.allureResults)) {
        return { executedCount: 0, failedCount: 0, passedCount: 0 };
      }
      if (dirHasHtmlIndex(PATHS.allureReport)) {
        return { executedCount: 1, failedCount: 0, passedCount: 1 };
      }
      return { executedCount: 0, failedCount: 0, passedCount: 0 };
    }
    case 'playwright-reports': {
      const suites = listPlaywrightHtmlReports(PATHS.reports.playwright);
      if (suites.length === 0) return { executedCount: 0, failedCount: 0, passedCount: 0 };
      return { executedCount: suites.length, failedCount: 0, passedCount: suites.length };
    }
    case 'report': {
      const md = path.join(PATHS.reports.summary, 'final-qa-report.md');
      const raw = readJsonIfExists<{ professionalError?: string | null }>(
        path.join(PATHS.reports.summary, 'final-qa-report.json')
      );
      if (!raw && !fs.existsSync(md)) return null;
      return { executedCount: 1, failedCount: 0, passedCount: 1 };
    }
    default:
      return null;
  }
}

export function resolveStageOutcome(input: {
  key: string;
  processStatus: StageStatus;
  processFailed: boolean;
}): { status: SuiteStatus; executedCount?: number } {
  if (input.processStatus === 'INVALID') {
    return { status: 'INVALID' };
  }
  if (input.processStatus === 'NOT_EXECUTED') {
    return { status: 'NOT_EXECUTED', executedCount: 0 };
  }

  if (input.key === 'allure') {
    if (!allureResultsPresent(PATHS.allureResults)) {
      return { status: 'NOT_EXECUTED', executedCount: 0 };
    }
    if (dirHasHtmlIndex(PATHS.allureReport) && !input.processFailed) {
      return { status: 'PASS', executedCount: 1 };
    }
    return { status: 'BLOCKED' };
  }

  const counts = readStageExecutedCounts(input.key);
  if (!counts) {
    if (input.processFailed) return { status: 'FAIL' };
    return { status: 'PASS' };
  }

  return {
    status: resolveSuiteStatus({
      executedCount: counts.executedCount,
      failedCount: counts.failedCount,
      passedCount: counts.passedCount,
      dryRun: counts.dryRun,
      selectedCount: counts.selectedCount,
      recorded: counts.recorded,
      processFailed: input.processFailed,
    }),
    executedCount: counts.executedCount,
  };
}
