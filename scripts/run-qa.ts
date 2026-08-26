import { runSync } from './sync-from-config';
import { runPostman } from './runners/postman';
import { runPlaywright } from './runners/playwright';
import { runJmeter } from './runners/jmeter';
import { loadConfig } from './lib/load-config';
import { logError, logStep, logSuccess } from './lib/logger';
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
    case 'load':
      return runJmeter(config);
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

  for (const step of steps) {
    const passed = await runStep(step, config);
    if (!passed && config.pipeline.failFast) {
      logError(`Pipeline failed at step: ${step}`);
      process.exit(1);
    }
  }

  logSuccess('Pipeline finished');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
