import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStages } from './stages';
import { CONTRACT_NAMED_STEPS, CONTRACT_STAGE_KEYS, contractKeysInOrder } from './contract-flow';
import { overallExitCode } from './spawn-stage';
import { parseOrchestratorCli, resolveOrchestratorUrl, isLoopbackUrl } from './resolve-url';
import type { OrchestratorContext, StageResult } from './types';

describe('orchestrator stages', () => {
  it('keeps the 20 named contract steps in order and splits Allure / Playwright / final report', () => {
    const stages = buildStages();
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
    assert.ok(CONTRACT_STAGE_KEYS.includes('performance'));
  });

  it('runs security, seo, and content as a concurrent page-scan group', () => {
    const stages = buildStages();
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

    const discovery = buildStages().find((stage) => stage.key === 'discovery');
    const inventory = buildStages().find((stage) => stage.key === 'inventory');
    const planning = buildStages().find((stage) => stage.key === 'coverage-planning');
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
