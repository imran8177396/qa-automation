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
import type { RetestOutcomeStatus, RetestRunResult, RetestRunner, RetestRunnerInput } from './types';

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

export function configPathForSource(source: string): string | null {
  const mapped = SOURCE_CONFIG[source];
  if (!mapped) return null;
  const configPath = path.join(PATHS.root, mapped.configFile);
  return fs.existsSync(configPath) ? configPath : null;
}

export function escapeGrep(title: string): string {
  return title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lastStatusForTitle(resultsPath: string, title: string): RetestOutcomeStatus | null {
  const report = loadPlaywrightJsonReport(resultsPath);
  if (!report) return null;
  const specs = walkPlaywrightSpecs(report.suites);
  const match = specs.find((spec) => spec.title === title);
  if (!match) return null;
  for (const test of match.tests ?? []) {
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
      if (!fs.existsSync(input.specFile) && !fs.existsSync(path.join(PATHS.root, input.specFile))) {
        return {
          status: 'NOT_EXECUTED',
          reason: `Spec file is missing (${input.specFile}). Original FAIL preserved.`,
          resultsPath: null,
        };
      }

      const specArg = fs.existsSync(input.specFile) ? input.specFile : path.join(PATHS.root, input.specFile);
      fs.mkdirSync(input.outputDir, { recursive: true });

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

      const captured = captureCommand(localBinPath('playwright'), args, {
        cwd: PATHS.root,
        env: {
          ...process.env,
          QA_PLAYWRIGHT_HEADLESS: process.env.QA_PLAYWRIGHT_HEADLESS ?? 'true',
        },
      });

      const wrote = writeCapturedJson(input.resultsPath, captured.stdout);
      if (!wrote) {
        return {
          status: 'NOT_EXECUTED',
          reason: 'Retest produced unreadable Playwright JSON. Original FAIL preserved.',
          resultsPath: null,
        };
      }

      const fromJson = lastStatusForTitle(input.resultsPath, input.title);
      if (fromJson) {
        return {
          status: fromJson,
          reason:
            fromJson === 'PASS'
              ? 'Retest passed. Original FAIL is preserved as FAIL → PASS (unstable).'
              : 'Retest failed. Original FAIL is preserved.',
          resultsPath: input.resultsPath,
        };
      }

      return {
        status: 'NOT_EXECUTED',
        reason: 'Retest JSON did not contain the original test title. Original FAIL preserved.',
        resultsPath: input.resultsPath,
      };
    },
  };
}
