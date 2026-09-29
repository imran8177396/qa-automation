import fs from 'fs';
import path from 'path';
import { runSync } from './sync-from-config';
import { runPostman } from './runners/postman';
import { runPlaywright } from './runners/playwright';
import { runJmeter } from './runners/jmeter';
import { runLighthouse } from './lighthouse/run';
import { runUiPerformance } from './performance/run-ui';
import { loadConfig } from './lib/load-config';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { PATHS } from './lib/paths';
import { resolveNpmCommand, runCommand } from './lib/run-command';
import {
  executionModeUsage,
  exitCodeWhenNotSpawning,
  hasArgFlag,
  resolveExecutionMode,
  spawnableScripts,
  type ExecutionModePlan,
} from './cli/execution-mode';
import {
  formatGenerateTestsSummary,
  generateTestsExitCode,
  resolveGenerateTestsPlan,
} from './cli/generate-tests';
import { isGenerationInventory, type GenerationInventory } from './discovery/generation-contract';
import { writeJson } from './discovery/write-json';
import { toChangeAwareMappings } from './planning/change-aware-generation';
import { loadHumanOverridesDocument } from './planning/human-overrides';
import {
  loadPersistedTestCases,
  savePersistedTestCases,
} from './planning/test-case-identity';
import type { PipelineStep } from './types';

function parseRequestedSteps(argv: string[]): PipelineStep[] | null {
  const stepArg = argv.find((arg) => arg.startsWith('--step='));
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

function printPlan(plan: ExecutionModePlan): void {
  console.log(JSON.stringify(plan, null, 2));
}

function readDiffFile(argv: string[]): string | undefined {
  const eq = argv.find((arg) => arg.startsWith('--diff-file='));
  const pathValue = eq
    ? eq.slice('--diff-file='.length)
    : (() => {
        const idx = argv.findIndex((arg) => arg === '--diff-file');
        return idx >= 0 ? argv[idx + 1] : undefined;
      })();
  if (!pathValue) return undefined;
  const resolved = path.isAbsolute(pathValue)
    ? pathValue
    : path.join(PATHS.root, pathValue);
  return fs.readFileSync(resolved, 'utf8');
}

function spawnNpmScripts(plan: ExecutionModePlan): number {
  const npm = resolveNpmCommand();
  if (!npm) {
    logError('npm CLI not found on PATH');
    return 1;
  }

  const toRun = spawnableScripts(plan);
  // When items[] is empty but npmScripts is set (smoke/regression/full), spawn those.
  const scripts =
    toRun.length > 0
      ? toRun.map((row) => row.npmScript)
      : plan.npmScripts;

  if (scripts.length === 0) {
    logError(
      plan.reason ||
        'no spawnable scripts in plan (BLOCKED / NOT_TESTED items are not executed)'
    );
    return 1;
  }

  let failed = false;
  for (const npmScript of scripts) {
    const item = plan.items.find((row) => row.npmScript === npmScript);
    if (
      item &&
      (item.status === 'BLOCKED' ||
        item.status === 'NOT_TESTED' ||
        item.status === 'NOT_IMPLEMENTED' ||
        item.status === 'REQUIRES_CONFIGURATION')
    ) {
      logWarn(`skip ${npmScript} (${item.status}: ${item.reason ?? ''})`);
      failed = true;
      continue;
    }

    const extra = plan.scriptArgs[npmScript] ?? [];
    logStep(`npm run ${npmScript}`);
    const result = runCommand(npm, ['run', npmScript, ...extra], {
      cwd: PATHS.root,
    });
    if ((result.status ?? 1) !== 0) {
      failed = true;
      logError(`${npmScript} exited ${result.status ?? 'null'}`);
    } else {
      logSuccess(`${npmScript} exited 0`);
    }
  }

  const skipped = plan.items.filter(
    (row) =>
      row.status === 'BLOCKED' ||
      row.status === 'NOT_TESTED' ||
      row.status === 'NOT_IMPLEMENTED'
  );
  if (skipped.length > 0) {
    logWarn(
      `selected items not executed: ${skipped
        .map((row) => `${row.npmScript}=${row.status}`)
        .join(', ')}`
    );
    failed = true;
  }

  return failed ? 1 : 0;
}

async function runLegacyPipeline(argv: string[]): Promise<void> {
  const config = loadConfig();
  const requestedSteps = parseRequestedSteps(argv);
  // Legacy --step path only — bare qa without --mode/--step never reaches here.
  const steps = requestedSteps!;

  logStep(`${config.project.name} — starting pipeline`);
  console.log(`Steps: ${steps.join(' → ')}`);

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

function loadGenerationInventoryOrNull(): GenerationInventory | null {
  if (!fs.existsSync(PATHS.generationInventoryFile)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(PATHS.generationInventoryFile, 'utf8')) as unknown;
    return isGenerationInventory(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Load changeImpact.mappings for --generate-tests --changed (may be []). */
function loadChangeAwareMappingsFromConfig() {
  try {
    const config = loadConfig();
    return toChangeAwareMappings(config.changeImpact?.mappings ?? []);
  } catch {
    return [];
  }
}

function runGenerateTestsPath(argv: string[]): number {
  const overridesLoad = loadHumanOverridesDocument(PATHS.generatedOverrides);
  if (!overridesLoad.ok) {
    console.error(`REQUIRES_CONFIGURATION: ${overridesLoad.reason}`);
    console.error('invalid qa.generated-overrides.json; not writing generated-tests.json');
    return 1;
  }

  const inventory = loadGenerationInventoryOrNull();
  const gitDiff = (() => {
    try {
      return readDiffFile(argv);
    } catch {
      return undefined;
    }
  })();

  // Missing identity file → null (start a new registry). Corrupt → throw (do not wipe).
  const previousIdentities = loadPersistedTestCases(PATHS.testCaseIdentitiesFile);

  const plan = resolveGenerateTestsPlan(argv, {
    inventory,
    overrides: overridesLoad.document,
    previousIdentities,
    changeAwareMappings: loadChangeAwareMappingsFromConfig(),
    ...(gitDiff !== undefined ? { gitDiff } : {}),
  });

  const code = generateTestsExitCode(plan);
  if (code !== 0) {
    console.error(plan.reason);
    for (const note of plan.notes) {
      console.error(note);
    }
    console.log(formatGenerateTestsSummary(plan));
    return code;
  }

  if (plan.persistedIdentities !== undefined) {
    savePersistedTestCases(PATHS.testCaseIdentitiesFile, plan.persistedIdentities);
    logSuccess(`wrote ${PATHS.testCaseIdentitiesFile}`);
  }

  if (plan.filter.changed && plan.status === 'UPDATED') {
    // Change-aware artifact: regenerated + preserved; do not claim all cases were regenerated.
    writeJson(PATHS.generatedTestsFile, {
      status: plan.status,
      regenerated: plan.regenerated ?? [],
      preserved: plan.preserved ?? [],
      unmappedFiles: plan.unmappedFiles ?? [],
      reason: plan.reason,
      execution: 'NOT_EXECUTED',
      note: 'Change-aware generation; tests not executed; no PASS claimed.',
    });
  } else {
    writeJson(PATHS.generatedTestsFile, {
      generatedAt: new Date().toISOString(),
      filter: plan.filter,
      caseCount: plan.kept.length,
      cases: plan.kept,
      execution: 'NOT_EXECUTED',
      note: 'Generated from discovery inventory; tests not executed; no PASS claimed.',
    });
  }
  console.log(formatGenerateTestsSummary(plan));
  logSuccess(`wrote ${PATHS.generatedTestsFile}`);
  return 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((arg) => arg !== '--');
  const hasGenerateTests = hasArgFlag(argv, 'generate-tests');
  const hasMode = hasArgFlag(argv, 'mode');
  const hasStep = argv.some((arg) => arg.startsWith('--step='));

  // --generate-tests is handled before --mode so the resolver can reject the combination.
  if (hasGenerateTests) {
    process.exit(runGenerateTestsPath(argv));
  }

  if (hasMode) {
    const gitDiff = readDiffFile(argv);
    const plan = resolveExecutionMode(argv, {
      ...(gitDiff !== undefined ? { gitDiff } : {}),
    });

    printPlan(plan);

    const explicitPlan = hasArgFlag(argv, 'plan');
    // Explicit --plan keeps plan-only exit rules. Non-spawn without --plan is never success.
    if (explicitPlan || !plan.spawn) {
      console.log(`mode=${plan.mode ?? '(none)'}; plan only; tests not executed`);
      process.exit(exitCodeWhenNotSpawning(plan, explicitPlan));
    }

    const code = spawnNpmScripts(plan);
    process.exit(code);
  }

  if (hasStep) {
    await runLegacyPipeline(argv);
    return;
  }

  // No --mode, --generate-tests, or --step: do not silently run the pipeline / qa:all.
  console.error(executionModeUsage());
  console.error(
    'REQUIRES_CONFIGURATION: pass --mode=<mode>, --generate-tests, or legacy --step=<sync|api|e2e|load>'
  );
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
