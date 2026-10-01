/**
 * One-command full QA run for Command Prompt / npm run qa:full.
 * Runs the entire qa:all pipeline, refreshes the report layer, prints a plain
 * English summary, and exits with:
 *   0 = pipeline completed all stages and QA verdict is not FAIL
 *   1 = pipeline could not complete (missing URL, tools, or incomplete stages)
 *   2 = pipeline completed all stages but overall QA verdict is FAIL
 *
 * Never invents a demo URL. Does not weaken assertions or hide failures.
 */
import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { loadConfig } from './lib/load-config';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { readLastTargetUrl } from './lib/last-target';
import { applyQaRuntimeEnv } from './lib/runtime-env';
import { ensurePlaywrightBrowsersInstalled } from './lib/ensure-playwright-browsers';
import { resolveNpmCommand, runCommand } from './lib/run-command';
import {
  parseOrchestratorCli,
  readExistingSeedUrl,
  resolveOrchestratorUrl,
  stripWebsiteTargetArgs,
} from './orchestrator/resolve-url';
import { buildStages } from './orchestrator/stages';
import {
  formatOrchestratorStalenessBanner,
  writeReconciledOrchestratorSummary,
  type ReconciledOrchestratorSummary,
} from './orchestrator/reconcile-orchestrator-summary';
import { readJsonIfExists } from './discovery/write-json';
import type { OrchestratorSummary } from './orchestrator/types';

export type WrapperExitCode = 0 | 1 | 2;

function printBanner(title: string): void {
  console.log('');
  console.log('============================================================');
  console.log(title);
  console.log('============================================================');
}

function resolveTargetUrl(argv: string[]): string {
  const parsed = parseOrchestratorCli(argv);
  const config = loadConfig();
  return resolveOrchestratorUrl({
    cliUrl: parsed.url,
    playwrightEnvUrl: process.env.QA_PLAYWRIGHT_BASE_URL,
    envUrl: process.env.QA_WEBSITE_URL,
    lastTargetUrl: readLastTargetUrl(),
    websiteUrl: config.urls.website,
    playwrightBaseUrl: config.playwright.baseURL,
    existingSeed: readExistingSeedUrl(),
  }).trim();
}

function ensureDependencies(): boolean {
  const nodeModules = path.join(PATHS.root, 'node_modules');
  if (fs.existsSync(nodeModules)) {
    logSuccess('node_modules present — skipping npm install');
    return true;
  }
  const npm = resolveNpmCommand();
  if (!npm) {
    logError('npm not found on PATH — install Node.js 18+ first');
    return false;
  }
  const lock = path.join(PATHS.root, 'package-lock.json');
  const args = fs.existsSync(lock) ? ['ci'] : ['install'];
  logStep(`Installing dependencies (npm ${args.join(' ')})`);
  const result = runCommand(npm, args, { cwd: PATHS.root, env: process.env });
  if (result.status !== 0) {
    logError(`npm ${args.join(' ')} failed with exit ${result.status ?? 'null'}`);
    return false;
  }
  return true;
}

function runNpmScript(script: string, scriptArgs: string[] = []): number {
  const npm = resolveNpmCommand();
  if (!npm) {
    logError('npm not found');
    return 1;
  }
  const args = scriptArgs.length > 0 ? ['run', script, '--', ...scriptArgs] : ['run', script];
  logStep(`npm ${args.join(' ')}`);
  const result = runCommand(npm, args, { cwd: PATHS.root, env: process.env });
  return result.status ?? 1;
}

function latestQaPackDir(): string | null {
  const root = path.join(PATHS.root, 'docs', 'output', 'qa-test-results');
  if (!fs.existsSync(root)) return null;
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/.test(name))
    .sort();
  if (dirs.length === 0) return null;
  return path.join(root, dirs[dirs.length - 1]!);
}

function findPdfInPack(packDir: string | null): string | null {
  if (!packDir || !fs.existsSync(packDir)) return null;
  const pdfs = fs.readdirSync(packDir).filter((name) => name.toLowerCase().endsWith('.pdf'));
  return pdfs[0] ? path.join(packDir, pdfs[0]) : null;
}

function latestHistoryMaster(): { html: string | null; json: string | null; folder: string | null } {
  const history = PATHS.reports.history;
  if (!fs.existsSync(history)) return { html: null, json: null, folder: null };
  const folders = fs
    .readdirSync(history, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (folders.length === 0) return { html: null, json: null, folder: null };
  const folder = path.join(history, folders[folders.length - 1]!);
  const html = path.join(folder, 'MASTER-QA-REPORT.html');
  const json = path.join(folder, 'MASTER-QA-REPORT.json');
  return {
    folder,
    html: fs.existsSync(html) ? html : null,
    json: fs.existsSync(json) ? json : null,
  };
}

export function decideWrapperExitCode(input: {
  pipelineComplete: boolean;
  overallStatus: string | null;
}): WrapperExitCode {
  if (!input.pipelineComplete) return 1;
  if ((input.overallStatus ?? '').toUpperCase() === 'FAIL') return 2;
  return 0;
}

function printEndSummary(input: {
  url: string;
  reconciled: ReconciledOrchestratorSummary;
  original: OrchestratorSummary | null;
  pipelineExit: number;
  wrapperExit: WrapperExitCode;
}): void {
  const { reconciled, original, url, wrapperExit } = input;
  printBanner('QA RUN COMPLETE — SUMMARY');
  console.log(`Target URL:        ${url || '(none)'}`);
  console.log(`Overall verdict:   ${reconciled.overallStatus}`);
  console.log(
    `Stages recorded:   ${reconciled.staleness.recordedStageCount} / ${reconciled.staleness.expectedStageCount} (original summary)`
  );
  console.log(`Reconciled stages: ${reconciled.stages.length} / ${reconciled.staleness.expectedStageCount}`);
  console.log(`Stale/partial:     ${reconciled.staleness.partial || reconciled.staleness.stale ? 'YES — see note' : 'no'}`);
  if (reconciled.staleness.partial || reconciled.staleness.stale) {
    console.log(formatOrchestratorStalenessBanner(reconciled.staleness));
  }
  console.log('');
  console.log('Per-stage status:');
  for (const stage of reconciled.stages) {
    const duration =
      typeof stage.durationMs === 'number' && stage.durationMs > 0
        ? ` (${Math.round(stage.durationMs / 1000)}s)`
        : '';
    const reason = stage.reason ? ` — ${stage.reason}` : '';
    console.log(`  ${String(stage.id).padStart(2)}. ${stage.key.padEnd(20)} ${stage.status}${duration}${reason}`);
  }
  console.log('');
  const pack = latestQaPackDir();
  const pdf = findPdfInPack(pack);
  const master = latestHistoryMaster();
  console.log('Open these reports:');
  console.log(`  Final QA report:     ${path.join(PATHS.reports.summary, 'final-qa-report.md')}`);
  console.log(`  Report index:        ${path.join(PATHS.reports.summary, 'report-index.json')}`);
  console.log(`  Orchestrator:        ${path.join(PATHS.reports.orchestrator, 'summary.json')}`);
  console.log(`  Reconciled summary:  ${PATHS.orchestratorReconciledSummary}`);
  console.log(`  Allure HTML:         ${path.join(PATHS.allureReport, 'index.html')}`);
  console.log(`  Playwright index:    see reports/summary/report-index.json (playwright suites)`);
  if (master.html) console.log(`  MASTER-QA-REPORT:    ${master.html}`);
  if (pack) console.log(`  Doc pack folder:     ${pack}`);
  if (pdf) console.log(`  PDF report:          ${pdf}`);
  else console.log('  PDF report:          (not found — Chromium may still be missing)');
  console.log('');
  console.log('Exit codes: 0 = pipeline completed (verdict not FAIL), 1 = pipeline incomplete, 2 = pipeline completed but verdict FAIL');
  console.log(`This run exit: ${wrapperExit}`);
  if (original?.exitCode != null) {
    console.log(`(qa:all process exit was ${input.pipelineExit}; quality gate / stage FAIL does not hide results)`);
  }
  console.log('');
}

export async function runQaFull(argv: string[] = process.argv.slice(2)): Promise<WrapperExitCode> {
  process.chdir(PATHS.root);
  applyQaRuntimeEnv(process.env);

  printBanner('ONE-COMMAND FULL QA RUN');
  console.log(`Project root: ${PATHS.root}`);

  const npm = resolveNpmCommand();
  if (!npm) {
    logError('npm not found — install Node.js 18+ (includes npm) and reopen Command Prompt');
    return 1;
  }
  logSuccess(`Node ${process.version}`);
  logSuccess(`npm via ${npm}`);
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    console.log(`PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH}`);
  }
  if (process.env.NODE_OPTIONS) {
    console.log(`NODE_OPTIONS=${process.env.NODE_OPTIONS}`);
  }

  if (!ensureDependencies()) return 1;

  const browsers = ensurePlaywrightBrowsersInstalled();
  if (!browsers.installed) {
    logError(browsers.detail);
    return 1;
  }
  logSuccess(`Playwright browsers: ${browsers.detail}`);

  const url = resolveTargetUrl(argv);
  if (!url) {
    logError(
      'No website URL resolved. Pass a URL, e.g.:\n' +
        '  run-qa.cmd https://www.example.com/\n' +
        '  npm run qa:full -- https://www.example.com/\n' +
        'Or set QA_WEBSITE_URL / QA_PLAYWRIGHT_BASE_URL, or reuse a previous last-target after one successful --url run.\n' +
        'This framework never invents a demo URL.'
    );
    return 1;
  }
  logStep(`Target: ${url}`);

  const expectedStages = buildStages();
  logStep(`Expected orchestrator stages: ${expectedStages.length}`);

  const passthrough = stripWebsiteTargetArgs(argv);
  const qaAllExit = runNpmScript('qa:all', ['--url', url, ...passthrough]);
  logStep(`qa:all finished with exit ${qaAllExit}`);

  // Always refresh report layer (do not clean). Failures here are recorded but do not erase suite results.
  printBanner('REFRESHING REPORT LAYER');
  runNpmScript('report:allure');
  runNpmScript('report:playwright');
  runNpmScript('report:final');
  runNpmScript('report:master');
  runNpmScript('report:all');

  const reconciled = writeReconciledOrchestratorSummary({ expectedStages });
  const original = readJsonIfExists<OrchestratorSummary>(
    path.join(PATHS.reports.orchestrator, 'summary.json')
  );
  const recorded = original?.stages?.length ?? 0;
  const pipelineComplete =
    recorded >= expectedStages.length &&
    !reconciled.staleness.partial &&
    reconciled.stages.length >= expectedStages.length;

  const wrapperExit = decideWrapperExitCode({
    pipelineComplete,
    overallStatus: reconciled.overallStatus ?? original?.overallStatus ?? null,
  });

  printEndSummary({
    url: reconciled.url || url,
    reconciled,
    original,
    pipelineExit: qaAllExit,
    wrapperExit,
  });

  if (!pipelineComplete) {
    logError(
      `Pipeline incomplete: recorded ${recorded}/${expectedStages.length} in summary.json (reconciled ${reconciled.stages.length}).`
    );
  } else if (wrapperExit === 2) {
    logWarn('Pipeline completed all stages; overall QA verdict is FAIL (site/application defects are reported honestly).');
  } else {
    logSuccess('Pipeline completed all stages.');
  }

  return wrapperExit;
}

async function main(): Promise<void> {
  const code = await runQaFull(process.argv.slice(2));
  process.exit(code);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
