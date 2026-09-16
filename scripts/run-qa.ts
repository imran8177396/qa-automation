import { runSync } from './sync-from-config';
import { runPostman } from './runners/postman';
import { runPlaywright } from './runners/playwright';
import { runJmeter } from './runners/jmeter';
import { runLighthouse } from './lighthouse/run';
import { runUiPerformance } from './performance/run-ui';
import { loadConfig } from './lib/load-config';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { cleanRunArtifacts, shouldKeepArtifacts } from './lib/clean-run-artifacts';
import type { PipelineStep } from './types';

function parseRequestedSteps(): PipelineStep[] | null {
  const stepArg = process.argv.find((arg) => arg.startsWith('--step='));
  if (!stepArg) {
    return null;
  }

  const value = stepArg.split('=')[1] as PipelineStep;
  if (value === 'sync' || value === 'api' || value === 'e2e' || value === 'load') {
    return [value];
  }

  throw new Error(`Unknown step "${value}". Use sync, api, e2e, or load.`);
}

async function runStep(step: PipelineStep, config: ReturnType<typeof loadConfig>): Promise<boolean> {
  switch (step) {
    case 'sync':
      await runSync();
      return true;
    case 'api':
      return runPostman(config);
    case 'e2e':
      return runPlaywright(config);
    case 'load': {
      const uiOk = await runUiPerformance(config);
      const jmeterOk = await runJmeter(config);
      const lighthouseOk = await runLighthouse(config);
      return uiOk && jmeterOk && lighthouseOk;
    }
    default:
      return false;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const requestedSteps = parseRequestedSteps();
  const steps = requestedSteps ?? config.pipeline.steps;

  logStep(`${config.project.name} — starting pipeline`);
  console.log(`Steps: ${steps.join(' → ')}`);
  if (!requestedSteps) {
    if (shouldKeepArtifacts()) {
      logWarn('Keeping previous run artifacts (--keep-artifacts)');
    } else {
      logStep('Cleaning previous test artifacts and cache');
      const { removed } = cleanRunArtifacts();
      logSuccess(
        removed.length === 0
          ? 'No previous run artifacts were present'
          : `Removed ${removed.length} previous artifact path(s)`
      );
    }
  }

  let anyFailed = false;
  for (const step of steps) {
    const passed = await runStep(step, config);
    if (!passed) {
      anyFailed = true;
      if (config.pipeline.failFast) {
        logError(`Pipeline failed at step: ${step}`);
        process.exit(1);
      }
    }
  }

  if (anyFailed) {
    logError('Pipeline finished with failures');
    process.exit(1);
  }

  logSuccess('Pipeline finished');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
