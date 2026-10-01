import { loadConfig } from '../lib/load-config';
import { stagePhaseForKey } from '../lib/stage-timeline';
import type { TestsConfig } from '../types';
import {
  orchestratorPhaseForStageKey,
  selectedOptInEngineDefs,
  type OrchestratorPhaseName,
} from './phases';
import { timeoutMsForStageKey } from './stage-timeouts';
import type { StageDefinition } from './types';

/**
 * qa:all child-process stages. The 20 named contract steps appear in order;
 * extra existing stages (dependencies, content, workflows, collect) still run.
 * Steps 11–12 are one command (`run-performance.ts`, no --authorize-heavy).
 * Opt-in engines (tests.*.enabled) are appended into EXECUTE when selected.
 *
 * Post-EXECUTE order follows the 11-phase flow:
 * NORMALIZE (collect) → COVERAGE → FAILURE ANALYSIS → RETEST → REPORT.
 */
export function buildStages(options?: { tests?: TestsConfig }): StageDefinition[] {
  const tests = options?.tests ?? loadConfig().tests;
  const optIns = selectedOptInEngineDefs(tests);

  const stages: Array<Omit<StageDefinition, 'phase' | 'orchestratorPhase'>> = [
    { id: 1, key: 'preflight', name: 'Preflight / environment', script: 'scripts/preflight.ts' },
    {
      id: 2,
      key: 'dependencies',
      name: 'Dependency & secrets QA',
      script: 'scripts/run-dependencies.ts',
      skip: (ctx) => (ctx.dependenciesEnabled ? null : 'dependencies.enabled is false'),
    },
    {
      id: 3,
      key: 'discovery',
      name: 'Discovery',
      script: 'scripts/discover.ts',
      skip: (ctx) => (ctx.discoveryEnabled ? null : 'discovery.enabled is false'),
    },
    {
      id: 4,
      key: 'inventory',
      name: 'Inventory generation',
      script: 'scripts/orchestrator/generate-inventory.ts',
      skip: (ctx) => (ctx.discoveryEnabled ? null : 'discovery.enabled is false'),
    },
    {
      id: 5,
      key: 'coverage-planning',
      name: 'Coverage planning',
      script: 'scripts/planning/write-planned-checks.ts',
      skip: (ctx) => (ctx.discoveryEnabled ? null : 'discovery.enabled is false'),
    },
    {
      id: 6,
      key: 'e2e',
      name: 'Playwright UI/E2E',
      script: 'scripts/run-playwright-e2e.ts',
      skip: (ctx) => (ctx.playwrightEnabled ? null : 'playwright.enabled is false'),
    },
    {
      id: 7,
      key: 'visual',
      name: 'Visual testing',
      script: 'scripts/run-visual.ts',
      skip: (ctx) => (ctx.playwrightEnabled ? null : 'playwright.enabled is false'),
    },
    {
      id: 8,
      key: 'responsive',
      name: 'Responsive testing',
      script: 'scripts/run-responsive.ts',
      skip: (ctx) => (ctx.playwrightEnabled ? null : 'playwright.enabled is false'),
    },
    {
      id: 9,
      key: 'cross-browser',
      name: 'Cross-browser testing',
      script: 'scripts/run-cross-browser.ts',
      skip: (ctx) => (ctx.playwrightEnabled ? null : 'playwright.enabled is false'),
    },
    {
      id: 10,
      key: 'accessibility',
      name: 'Accessibility testing',
      script: 'scripts/run-accessibility.ts',
      skip: (ctx) => (ctx.playwrightEnabled ? null : 'playwright.enabled is false'),
    },
    {
      id: 11,
      key: 'api',
      name: 'Postman API',
      script: 'scripts/run-api.ts',
      skip: (ctx) => (ctx.postmanEnabled ? null : 'postman.enabled is false'),
    },
    {
      id: 12,
      key: 'performance',
      name: 'UI performance + JMeter smoke (liveness only)',
      script: 'scripts/run-performance.ts',
      skip: (ctx) =>
        ctx.jmeterEnabled || ctx.playwrightEnabled
          ? null
          : 'jmeter.enabled and playwright.enabled are false',
    },
    {
      id: 13,
      key: 'security',
      name: 'Security QA',
      script: 'scripts/run-security.ts',
      skip: (ctx) => (ctx.securityEnabled ? null : 'security.enabled is false'),
      // Page-fetch based, no browser/JVM resource — safe to run alongside seo/content.
      parallelGroup: 'page-scan',
    },
    {
      id: 14,
      key: 'seo',
      name: 'SEO QA',
      script: 'scripts/run-seo.ts',
      skip: (ctx) => (ctx.seoEnabled ? null : 'seo.enabled is false'),
      parallelGroup: 'page-scan',
    },
    {
      id: 15,
      key: 'content',
      name: 'Content QA',
      script: 'scripts/run-content.ts',
      skip: (ctx) => (ctx.contentEnabled ? null : 'content.enabled is false'),
      parallelGroup: 'page-scan',
    },
    {
      id: 16,
      key: 'workflows',
      name: 'Combined UI+API workflows',
      script: 'scripts/run-workflows.ts',
      skip: (ctx) => (ctx.playwrightEnabled ? null : 'playwright.enabled is false'),
    },
  ];

  let nextId = 17;
  for (const optIn of optIns) {
    stages.push({
      id: nextId,
      key: optIn.key,
      name: optIn.name,
      script: optIn.script,
    });
    nextId += 1;
  }

  stages.push(
    { id: nextId, key: 'collect', name: 'Result collection', script: null },
    { id: nextId + 1, key: 'coverage', name: 'Coverage analysis', script: 'scripts/coverage.ts' },
    {
      id: nextId + 2,
      key: 'analyze',
      name: 'Failure analysis',
      script: 'scripts/analyze-failures.ts',
      skip: (ctx) => (ctx.failureAnalysisEnabled ? null : 'failureAnalysis.enabled is false'),
    },
    {
      id: nextId + 3,
      key: 'retest',
      name: 'Retesting where appropriate',
      script: 'scripts/retest.ts',
      args: ['--automation-only'],
      skip: (ctx) => (ctx.retestEnabled ? null : 'retest.enabled is false'),
    },
    {
      id: nextId + 4,
      key: 'allure',
      name: 'Allure report',
      script: 'scripts/reporting/generate-allure-report.ts',
      skip: (ctx) => (ctx.reportEnabled ? null : 'report.enabled is false'),
    },
    {
      id: nextId + 5,
      key: 'playwright-reports',
      name: 'Playwright reports',
      script: 'scripts/reporting/report-playwright.ts',
      skip: (ctx) => (ctx.reportEnabled ? null : 'report.enabled is false'),
    },
    {
      id: nextId + 6,
      key: 'report',
      name: 'Final QA summary',
      script: 'scripts/reporting/generate-final-report.ts',
      skip: (ctx) => (ctx.reportEnabled ? null : 'report.enabled is false'),
    }
  );

  return stages.map((stage) => ({
    ...stage,
    phase: stagePhaseForKey(stage.key),
    orchestratorPhase: orchestratorPhaseForStageKey(stage.key) as OrchestratorPhaseName,
    timeoutMs: stage.timeoutMs ?? timeoutMsForStageKey(stage.key),
  }));
}
