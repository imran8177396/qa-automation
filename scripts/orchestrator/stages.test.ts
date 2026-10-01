import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildStages } from './stages';
import {
  CONTRACT_NAMED_STEPS,
  CONTRACT_STAGE_KEYS,
  ORCHESTRATOR_PHASE_NAMES,
  POST_EXECUTION_STAGE_KEYS,
  contractKeysInOrder,
} from './contract-flow';
import { UNIVERSAL_QA_STEPS } from './universal-qa-flow';
import {
  OPT_IN_ENGINE_DEFS,
  buildOrchestratorPhasePlan,
  selectEnabledTestEngines,
} from './phases';
import { overallExitCode } from './spawn-stage';
import { parseOrchestratorCli, resolveOrchestratorUrl, isLoopbackUrl } from './resolve-url';
import type { TestsConfig } from '../types';
import type { OrchestratorContext, StageResult } from './types';

function fixtureTests(overrides: Partial<TestsConfig> = {}): TestsConfig {
  const base: TestsConfig = {
    unit: { enabled: true },
    integration: { enabled: false, checks: [] },
    contract: { enabled: false, contracts: [], usePostmanRequests: false, executeNegative: false },
    database: { enabled: false, urlEnv: 'DATABASE_URL' },
    smoke: { enabled: false },
    sanity: { enabled: false, checks: [] },
    regression: { enabled: false, mode: 'selective' },
    performance: {
      enabled: true,
      load: { enabled: false },
      stress: { enabled: false },
      spike: { enabled: false },
      endurance: { enabled: false },
    },
    reliability: { enabled: false, healthUrl: '', healthUrlEnv: '', timeoutMs: 5000 },
    resilience: { enabled: false, dependencyUrl: '', dependencyUrlEnv: '', healthUrl: '', healthUrlEnv: '' },
    deployment: { enabled: false },
    localization: { enabled: false, locales: ['en-US'], timezones: ['UTC'] },
    ai: { enabled: false, endpointEnv: 'QA_AI_ENDPOINT' },
    productionVerification: { enabled: false },
  };
  return { ...base, ...overrides };
}

describe('orchestrator stages', () => {
  it('keeps the 20 named contract steps in order and splits Allure / Playwright / final report', () => {
    const stages = buildStages({ tests: fixtureTests() });
    assert.equal(CONTRACT_NAMED_STEPS.length, 20);
    const order = contractKeysInOrder(stages.map((stage) => stage.key));
    assert.deepEqual(order.violations, []);
    assert.equal(order.ok, true);
    assert.equal(stages[0]?.key, 'preflight');
    assert.equal(stages.at(-1)?.key, 'report');
    assert.equal(stages.find((stage) => stage.key === 'collect')?.script, null);
    assert.equal(stages.find((stage) => stage.key === 'coverage-planning')?.script, 'scripts/planning/write-planned-checks.ts');
    assert.equal(stages.find((stage) => stage.key === 'allure')?.script, 'scripts/reporting/generate-allure-report.ts');
    assert.equal(
      stages.find((stage) => stage.key === 'playwright-reports')?.script,
      'scripts/reporting/report-playwright.ts'
    );
    assert.equal(stages.find((stage) => stage.key === 'report')?.script, 'scripts/reporting/generate-final-report.ts');
    assert.equal(stages.find((stage) => stage.key === 'retest')?.args?.[0], '--automation-only');
    assert.ok(!(stages.find((stage) => stage.key === 'performance')?.args ?? []).includes('--authorize-heavy'));
    assert.equal(stages.find((stage) => stage.key === 'dependencies')?.phase, 'setup');
    assert.equal(stages.find((stage) => stage.key === 'discovery')?.phase, 'discovery');
    assert.equal(stages.find((stage) => stage.key === 'coverage-planning')?.phase, 'inventory');
    assert.equal(stages.find((stage) => stage.key === 'e2e')?.phase, 'execution');
    assert.equal(stages.find((stage) => stage.key === 'discovery')?.orchestratorPhase, 'DISCOVER');
    assert.equal(stages.find((stage) => stage.key === 'inventory')?.orchestratorPhase, 'INVENTORY');
    assert.equal(stages.find((stage) => stage.key === 'coverage-planning')?.orchestratorPhase, 'PLAN');
    assert.equal(stages.find((stage) => stage.key === 'e2e')?.orchestratorPhase, 'EXECUTE');
    assert.equal(stages.find((stage) => stage.key === 'collect')?.orchestratorPhase, 'NORMALIZE RESULTS');
    assert.equal(stages.find((stage) => stage.key === 'coverage')?.orchestratorPhase, 'COVERAGE');
    assert.equal(stages.find((stage) => stage.key === 'analyze')?.orchestratorPhase, 'FAILURE ANALYSIS');
    assert.equal(stages.find((stage) => stage.key === 'retest')?.orchestratorPhase, 'RETEST');
    assert.equal(stages.find((stage) => stage.key === 'report')?.orchestratorPhase, 'REPORT');
    assert.ok(CONTRACT_STAGE_KEYS.includes('performance'));
    assert.equal(UNIVERSAL_QA_STEPS.length, 31);
    assert.ok(stages.length < UNIVERSAL_QA_STEPS.length);
    assert.deepEqual([...POST_EXECUTION_STAGE_KEYS], [
      'coverage',
      'analyze',
      'retest',
      'allure',
      'playwright-reports',
      'report',
    ]);
    const coverageIdx = stages.findIndex((stage) => stage.key === 'coverage');
    const analyzeIdx = stages.findIndex((stage) => stage.key === 'analyze');
    const retestIdx = stages.findIndex((stage) => stage.key === 'retest');
    assert.ok(coverageIdx > 0 && coverageIdx < analyzeIdx && analyzeIdx < retestIdx);
  });

  it('keeps the 11 orchestrator phase names once and in order', () => {
    const plan = buildOrchestratorPhasePlan({ tests: fixtureTests() });
    assert.deepEqual(plan.phaseNames, [...ORCHESTRATOR_PHASE_NAMES]);
    assert.equal(plan.phases.length, 11);
    assert.deepEqual(
      plan.phases.map((phase) => phase.name),
      [...ORCHESTRATOR_PHASE_NAMES]
    );
    const unique = new Set(plan.phaseNames);
    assert.equal(unique.size, 11);
  });

  it('excludes disabled opt-in engines from execute commands but records them as not selected', () => {
    const tests = fixtureTests({
      smoke: { enabled: false },
      localization: { enabled: true, locales: ['en-US'], timezones: ['UTC'] },
      integration: { enabled: false, checks: [] },
    });
    const plan = buildOrchestratorPhasePlan({ tests });
    const selection = selectEnabledTestEngines(tests);

    assert.ok(!plan.executeCommands.some((row) => row.key === 'smoke'));
    assert.ok(!plan.executeStageKeys.includes('smoke'));
    assert.ok(!plan.executeCommands.some((row) => row.key === 'integration'));

    const smoke = selection.engines.find((row) => row.engineId === 'smoke');
    assert.ok(smoke);
    assert.equal(smoke.selected, false);
    assert.match(smoke.reason, /enabled is false/i);
    assert.ok(selection.notSelectedStageKeys.includes('smoke'));
    assert.ok(selection.notSelectedStageKeys.includes('integration'));

    const localization = selection.engines.find((row) => row.engineId === 'localization');
    assert.ok(localization);
    assert.equal(localization.selected, true);
    assert.ok(plan.executeCommands.some((row) => row.key === 'localization'));
    assert.equal(
      plan.executeCommands.find((row) => row.key === 'localization')?.script,
      'scripts/testing/run-localization.ts'
    );

    const stages = buildStages({ tests });
    assert.ok(stages.some((stage) => stage.key === 'localization'));
    assert.ok(!stages.some((stage) => stage.key === 'smoke'));
    assert.ok(!stages.some((stage) => stage.key === 'integration'));
  });

  it('selects enabled opt-in engines that already have runner commands (smoke)', () => {
    const tests = fixtureTests({
      smoke: { enabled: true },
      localization: { enabled: false, locales: ['en-US'], timezones: ['UTC'] },
    });
    const plan = buildOrchestratorPhasePlan({ tests });
    assert.ok(plan.executeCommands.some((row) => row.key === 'smoke'));
    assert.equal(
      plan.executeCommands.find((row) => row.key === 'smoke')?.script,
      'scripts/testing/run-smoke-tests.ts'
    );
    assert.ok(plan.selection.engines.find((row) => row.engineId === 'smoke')?.selected);
    assert.ok(buildStages({ tests }).some((stage) => stage.key === 'smoke'));
  });

  it('does not add a second orchestrator runner file', () => {
    const orchestratorDir = path.join(__dirname);
    const names = fs.readdirSync(orchestratorDir);
    assert.ok(!names.some((name) => /run-all-v2|orchestrator2/i.test(name)));
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'run-all.ts')));
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'run-all-v2.ts')));
  });

  it('lists every opt-in engine in the selection record even when disabled', () => {
    const selection = selectEnabledTestEngines(fixtureTests());
    for (const def of OPT_IN_ENGINE_DEFS) {
      const row = selection.engines.find((entry) => entry.engineId === def.id);
      assert.ok(row, `missing selection row for ${def.id}`);
      assert.equal(row.selected, false);
      assert.equal(row.source, 'opt-in');
    }
    for (const key of [
      'e2e',
      'accessibility',
      'api',
      'security',
      'workflows',
    ]) {
      assert.ok(selection.engines.find((row) => row.stageKey === key)?.selected);
    }
  });

  it('attaches per-stage timeouts so hung children cannot block the pipeline forever', () => {
    const stages = buildStages({ tests: fixtureTests() });
    for (const stage of stages) {
      assert.ok(typeof stage.timeoutMs === 'number' && stage.timeoutMs > 0, stage.key);
    }
    const responsive = stages.find((stage) => stage.key === 'responsive');
    assert.ok((responsive?.timeoutMs ?? 0) >= 60 * 60 * 1000);
  });

  it('includes smoke, regression, and localization when enabled (26 stages with default opt-ins)', () => {
    const stages = buildStages({
      tests: fixtureTests({
        smoke: { enabled: true },
        regression: { enabled: true, mode: 'selective' },
        localization: { enabled: true, locales: ['en-US'], timezones: ['UTC'] },
      }),
    });
    assert.equal(stages.length, 26);
    assert.ok(stages.some((stage) => stage.key === 'smoke'));
    assert.ok(stages.some((stage) => stage.key === 'regression'));
    assert.ok(stages.some((stage) => stage.key === 'localization'));
  });

  it('runs security, seo, and content as a concurrent page-scan group', () => {
    const stages = buildStages({ tests: fixtureTests() });
    const pageScanStages = stages.filter((stage) => stage.parallelGroup === 'page-scan');
    assert.deepEqual(
      pageScanStages.map((stage) => stage.key),
      ['security', 'seo', 'content']
    );
  });

  it('skips discovery-dependent stages when discovery is disabled', () => {
    const ctx = {
      discoveryEnabled: false,
      dependenciesEnabled: true,
      playwrightEnabled: true,
      postmanEnabled: true,
      jmeterEnabled: true,
      securityEnabled: true,
      seoEnabled: true,
      contentEnabled: true,
      failureAnalysisEnabled: true,
      retestEnabled: true,
      reportEnabled: true,
      exhaustiveExecution: true,
      url: 'http://127.0.0.1:4173/',
      failFast: false,
      extraArgs: [],
    } satisfies OrchestratorContext;

    const stages = buildStages({ tests: fixtureTests() });
    const discovery = stages.find((stage) => stage.key === 'discovery');
    const inventory = stages.find((stage) => stage.key === 'inventory');
    const planning = stages.find((stage) => stage.key === 'coverage-planning');
    assert.match(discovery?.skip?.(ctx) ?? '', /discovery/i);
    assert.match(inventory?.skip?.(ctx) ?? '', /discovery/i);
    assert.match(planning?.skip?.(ctx) ?? '', /discovery/i);
  });
});

describe('resolveOrchestratorUrl', () => {
  it('prefers CLI url over config', () => {
    const url = resolveOrchestratorUrl({
      cliUrl: 'http://127.0.0.1:4173/',
      websiteUrl: 'https://example.com',
      playwrightBaseUrl: 'http://127.0.0.1:4173',
    });
    assert.equal(url, 'http://127.0.0.1:4173/');
  });

  it('uses loopback playwright baseURL before public website', () => {
    const url = resolveOrchestratorUrl({
      websiteUrl: 'https://example.com',
      playwrightBaseUrl: 'http://127.0.0.1:4173',
    });
    assert.equal(url, 'http://127.0.0.1:4173/');
  });

  it('uses persisted last-target before discovery seed and config', () => {
    const url = resolveOrchestratorUrl({
      lastTargetUrl: 'https://persisted.example/',
      existingSeed: 'https://seed.example/',
      websiteUrl: 'https://www.saucedemo.com/',
      playwrightBaseUrl: 'https://www.saucedemo.com',
    });
    assert.equal(url, 'https://persisted.example/');
  });
});

describe('parseOrchestratorCli', () => {
  it('parses --url and --fail-fast', () => {
    const parsed = parseOrchestratorCli(['--url=http://127.0.0.1:4173/', '--fail-fast', '--max-pages=5']);
    assert.equal(parsed.url, 'http://127.0.0.1:4173/');
    assert.equal(parsed.failFast, true);
    assert.equal(parsed.keepArtifacts, false);
    assert.deepEqual(parsed.extraArgs, ['--max-pages=5']);
  });

  it('parses --keep-artifacts and strips it from extraArgs', () => {
    const parsed = parseOrchestratorCli(['--keep-artifacts', '--url=https://talkingmindz.com/']);
    assert.equal(parsed.keepArtifacts, true);
    assert.equal(parsed.url, 'https://talkingmindz.com/');
    assert.deepEqual(parsed.extraArgs, []);
  });
});

describe('overallExitCode', () => {
  it('returns 1 when any stage failed', () => {
    const rows: StageResult[] = [
      {
        id: 1,
        key: 'preflight',
        name: 'Preflight',
        status: 'PASS',
        exitCode: 0,
        startedAt: '',
        finishedAt: '',
        completedAt: '',
        durationMs: 0,
      },
      {
        id: 2,
        key: 'discovery',
        name: 'Discovery',
        status: 'FAIL',
        exitCode: 1,
        startedAt: '',
        finishedAt: '',
        completedAt: '',
        durationMs: 0,
      },
    ];
    assert.equal(overallExitCode(rows), 1);
  });

  it('does not fail the pipeline when stages are only NOT_EXECUTED', () => {
    const rows: StageResult[] = [
      {
        id: 5,
        key: 'visual',
        name: 'Visual testing',
        status: 'NOT_EXECUTED',
        exitCode: null,
        startedAt: '',
        finishedAt: '',
        completedAt: '',
        durationMs: 0,
        executedCount: 0,
      },
    ];
    assert.equal(overallExitCode(rows), 0);
  });
});

describe('isLoopbackUrl', () => {
  it('detects localhost hosts', () => {
    assert.equal(isLoopbackUrl('http://127.0.0.1:4173/'), true);
    assert.equal(isLoopbackUrl('http://localhost:4173/'), true);
    assert.equal(isLoopbackUrl('https://example.com/'), false);
  });
});
