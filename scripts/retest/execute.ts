import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import { localBinPath, captureCommand } from '../lib/run-command';
import {
  combinedErrorMessage,
  loadPlaywrightJsonReport,
  walkPlaywrightSpecs,
} from '../lib/playwright-results';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import { toPosixRelative } from '../lib/playwright-suites';
import type { ClassifiedFailure } from '../failures/types';
import { snapshotDirectory, restoreDirectory, originalEvidenceDir } from './preserve';
import { resolveSpecFile } from './resolve-spec';
import { loadStageFindings, matchStageFinding, stageFindingStatus } from './stage-findings';
import {
  QUALITY_RETEST_SOURCES,
  type QualityRetestSource,
  type RetestOutcomeStatus,
  type RetestRunResult,
  type RetestRunner,
  type RetestRunnerInput,
  type RetestStageRunner,
  type StageRunResult,
} from './types';

const SOURCE_CONFIG: Record<string, { configFile: string }> = {
  playwright: { configFile: 'playwright.config.ts' },
  e2e: { configFile: 'playwright.config.ts' },
  'generated-check': { configFile: 'playwright.config.ts' },
  'cross-browser': { configFile: 'playwright.config.ts' },
  accessibility: { configFile: 'playwright.accessibility.config.ts' },
  workflows: { configFile: 'playwright.workflows.config.ts' },
  visual: { configFile: 'playwright.visual.config.ts' },
  responsive: { configFile: 'playwright.responsive.config.ts' },
};

const QUALITY_SCRIPTS: Record<QualityRetestSource, string> = {
  security: 'scripts/run-security.ts',
  seo: 'scripts/run-seo.ts',
  content: 'scripts/run-content.ts',
  dependencies: 'scripts/run-dependencies.ts',
};

const QUALITY_LIVE_DIRS: Record<QualityRetestSource, string> = {
  security: PATHS.reports.security,
  seo: PATHS.reports.seo,
  content: PATHS.reports.content,
  dependencies: PATHS.reports.dependencies,
};

const PLAYWRIGHT_RETEST_TIMEOUT_MS = 180_000;
const QUALITY_RETEST_TIMEOUT_MS = 180_000;

export function isQualityRetestSource(source: string): source is QualityRetestSource {
  return (QUALITY_RETEST_SOURCES as readonly string[]).includes(source);
}

export function configPathForSource(source: string): string | null {
  const mapped = SOURCE_CONFIG[source];
  if (!mapped) return null;
  const configPath = path.join(PATHS.root, mapped.configFile);
  return fs.existsSync(configPath) ? configPath : null;
}

export function escapeGrep(title: string): string {
  return title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lastStatusForTitle(
  resultsPath: string,
  title: string,
  projectName?: string
): RetestOutcomeStatus | null {
  const report = loadPlaywrightJsonReport(resultsPath);
  if (!report) return null;
  const specs = walkPlaywrightSpecs(report.suites);
  const match = specs.find((spec) => spec.title === title);
  if (!match) return null;
  for (const test of match.tests ?? []) {
    if (
      projectName &&
      projectName !== NOT_AVAILABLE &&
      test.projectName &&
      test.projectName !== projectName
    ) {
      continue;
    }
    const results = test.results ?? [];
    const last = results[results.length - 1];
    const status = (last?.status ?? '').toLowerCase();
    if (status === 'passed' || status === 'pass' || status === 'expected') return 'PASS';
    if (status === 'failed' || status === 'fail' || status === 'timedout' || status === 'unexpected') {
      return 'FAIL';
    }
    if (combinedErrorMessage(last ?? {})) return 'FAIL';
  }
  return null;
}

function playwrightReportError(resultsPath: string): string | null {
  const report = loadPlaywrightJsonReport(resultsPath) as
    | (ReturnType<typeof loadPlaywrightJsonReport> & { errors?: Array<{ message?: string }> })
    | null;
  const message = report?.errors?.[0]?.message?.replace(/\s+/g, ' ').trim();
  return message || null;
}

function writeCapturedJson(resultsPath: string, stdout: string): boolean {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf('{');
  if (start < 0) return false;
  try {
    const parsed = JSON.parse(trimmed.slice(start));
    fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
    fs.writeFileSync(resultsPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function createPlaywrightRetestRunner(): RetestRunner {
  return {
    runSpec(input: RetestRunnerInput): RetestRunResult {
      const resolved = resolveSpecFile(input.specFile, input.source ?? '');
      if (!resolved) {
        return {
          status: 'NOT_EXECUTED',
          reason: `Spec file is missing (${input.specFile}). Original FAIL preserved.`,
          resultsPath: null,
        };
      }

      // Playwright treats backslash Windows paths as file-filter regexes ("No tests found").
      const specArg = toPosixRelative(resolved);

      fs.mkdirSync(input.outputDir, { recursive: true });
      fs.mkdirSync(path.dirname(input.resultsPath), { recursive: true });

      const args = [
        'test',
        specArg,
        `--config=${input.configPath}`,
        `--grep=${escapeGrep(input.title)}`,
        '--reporter=json',
        `--output=${input.outputDir}`,
      ];
      if (input.projectName && input.projectName !== NOT_AVAILABLE) {
        args.push(`--project=${input.projectName}`);
      }

      const suiteEnv =
        input.source === 'cross-browser'
          ? 'cross-browser'
          : input.source === 'accessibility'
            ? 'accessibility'
            : process.env.QA_PLAYWRIGHT_SUITE;

      const captured = captureCommand(localBinPath('playwright'), args, {
        cwd: PATHS.root,
        timeoutMs: PLAYWRIGHT_RETEST_TIMEOUT_MS,
        env: {
          ...process.env,
          QA_PLAYWRIGHT_HEADLESS: process.env.QA_PLAYWRIGHT_HEADLESS ?? 'true',
          ...(suiteEnv ? { QA_PLAYWRIGHT_SUITE: suiteEnv } : {}),
        },
      });

      const wrote = writeCapturedJson(input.resultsPath, captured.stdout);
      const resultsPath = toPosixRelative(input.resultsPath);
      if (!wrote) {
        return {
          status: 'NOT_EXECUTED',
          reason: 'Retest produced unreadable Playwright JSON. Original FAIL preserved.',
          resultsPath: null,
        };
      }

      const fromJson = lastStatusForTitle(input.resultsPath, input.title, input.projectName);
      if (fromJson) {
        return {
          status: fromJson,
          reason:
            fromJson === 'PASS'
              ? 'Retest passed. Original FAIL is preserved as FAIL → PASS (unstable).'
              : 'Retest failed. Original FAIL is preserved.',
          resultsPath,
        };
      }

      const launchError = playwrightReportError(input.resultsPath);
      return {
        status: 'NOT_EXECUTED',
        reason: launchError
          ? `${launchError} Original FAIL preserved.`
          : 'Retest JSON did not contain the original test title. Original FAIL preserved.',
        resultsPath,
      };
    },
  };
}

export function createQualityStageRunner(): RetestStageRunner {
  return {
    run(source: string): StageRunResult {
      if (!isQualityRetestSource(source)) {
        return {
          status: 'NOT_EXECUTED',
          reason: `Source "${source}" is not a quality-stage retest. Original FAIL preserved.`,
          resultsPath: null,
          findings: [],
        };
      }

      const script = QUALITY_SCRIPTS[source];
      const liveDir = QUALITY_LIVE_DIRS[source];
      const snapshot = path.join(originalEvidenceDir(), source);
      const runDir = path.join(PATHS.reports.retest, 'runs', source);
      const scriptPath = path.join(PATHS.root, script);

      if (!fs.existsSync(scriptPath)) {
        return {
          status: 'NOT_EXECUTED',
          reason: `Quality-stage script missing (${script}). Original FAIL preserved.`,
          resultsPath: null,
          findings: [],
        };
      }

      snapshotDirectory(liveDir, snapshot);
      try {
        captureCommand(localBinPath('tsx'), [scriptPath], {
          cwd: PATHS.root,
          timeoutMs: QUALITY_RETEST_TIMEOUT_MS,
          env: { ...process.env },
        });
        snapshotDirectory(liveDir, runDir);
      } finally {
        restoreDirectory(snapshot, liveDir);
      }

      const resultsPath = path.join(runDir, 'summary.json');
      if (!fs.existsSync(resultsPath)) {
        return {
          status: 'NOT_EXECUTED',
          reason: `Quality-stage retest for ${source} did not write summary.json. Original FAIL preserved.`,
          resultsPath: null,
          findings: [],
        };
      }

      return {
        status: 'RAN',
        reason: `Quality-stage ${source} re-ran; original reports/${source} restored.`,
        resultsPath: toPosixRelative(resultsPath),
        findings: loadStageFindings(resultsPath),
      };
    },
  };
}

export function mapQualityRetest(row: ClassifiedFailure, stage: StageRunResult): RetestRunResult {
  if (stage.status !== 'RAN') {
    return { status: 'NOT_EXECUTED', reason: stage.reason, resultsPath: stage.resultsPath };
  }
  const matched = matchStageFinding(row, stage.findings);
  const mapped = stageFindingStatus(matched);
  return {
    status: mapped.status,
    reason: mapped.reason,
    resultsPath: stage.resultsPath,
  };
}

export function executeClassifiedFailure(
  row: ClassifiedFailure,
  options: {
    runner?: RetestRunner;
    stageRunner?: RetestStageRunner;
    stageCache?: Map<string, StageRunResult>;
  } = {}
): RetestRunResult {
  if (isQualityRetestSource(row.source)) {
    const cache = options.stageCache ?? new Map<string, StageRunResult>();
    let staged = cache.get(row.source);
    if (!staged) {
      const stageRunner = options.stageRunner ?? createQualityStageRunner();
      staged = stageRunner.run(row.source);
      cache.set(row.source, staged);
    }
    return mapQualityRetest(row, staged);
  }

  const configPath = configPathForSource(row.source);
  if (!configPath) {
    return {
      status: 'NOT_EXECUTED',
      reason: `Retest execution is not wired for source "${row.source}". Original FAIL preserved.`,
      resultsPath: null,
    };
  }

  const specFile = row.evidence?.specFile ?? NOT_AVAILABLE;
  if (!specFile || specFile === NOT_AVAILABLE) {
    return {
      status: 'NOT_EXECUTED',
      reason: 'Spec file is NOT_AVAILABLE. Original FAIL preserved.',
      resultsPath: null,
    };
  }

  const runner = options.runner ?? createPlaywrightRetestRunner();
  return runner.runSpec({
    specFile,
    title: row.title,
    configPath,
    outputDir: path.join(PATHS.reports.retest, 'output', row.id),
    resultsPath: path.join(PATHS.reports.retest, 'runs', `${row.id}.json`),
    projectName: row.evidence?.projectName ?? NOT_AVAILABLE,
    source: row.source,
  });
}
