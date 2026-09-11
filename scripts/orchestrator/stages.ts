import { stagePhaseForKey } from '../lib/stage-timeline';
import type { StageDefinition } from './types';

/** Twenty executable stages plus in-process result collection (stage 16). */
export function buildStages(): StageDefinition[] {
  const stages: Array<Omit<StageDefinition, 'phase'>> = [
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
      key: 'e2e',
      name: 'Playwright UI/E2E',
      script: 'scripts/run-playwright-e2e.ts',
      skip: (ctx) => (ctx.playwrightEnabled ? null : 'playwright.enabled is false'),
    },
    {
      id: 6,
      key: 'visual',
      name: 'Visual testing',
      script: 'scripts/run-visual.ts',
      skip: (ctx) => (ctx.playwrightEnabled ? null : 'playwright.enabled is false'),
    },
    {
      id: 7,
      key: 'responsive',
      name: 'Responsive testing',
      script: 'scripts/run-responsive.ts',
      skip: (ctx) => (ctx.playwrightEnabled ? null : 'playwright.enabled is false'),
    },
    {
      id: 8,
      key: 'cross-browser',
      name: 'Cross-browser testing',
      script: 'scripts/run-cross-browser.ts',
      skip: (ctx) => (ctx.playwrightEnabled ? null : 'playwright.enabled is false'),
    },
    {
      id: 9,
      key: 'accessibility',
      name: 'Accessibility testing',
      script: 'scripts/run-accessibility.ts',
      skip: (ctx) => (ctx.playwrightEnabled ? null : 'playwright.enabled is false'),
    },
    {
      id: 10,
      key: 'api',
      name: 'API testing',
      script: 'scripts/run-api.ts',
      skip: (ctx) => (ctx.postmanEnabled ? null : 'postman.enabled is false'),
    },
    {
      id: 11,
      key: 'performance',
      name: 'Performance liveness + Core Web Vitals',
      script: 'scripts/run-performance.ts',
      skip: (ctx) => (ctx.jmeterEnabled ? null : 'jmeter.enabled is false'),
    },
    {
      id: 12,
      key: 'security',
      name: 'Security QA',
      script: 'scripts/run-security.ts',
      skip: (ctx) => (ctx.securityEnabled ? null : 'security.enabled is false'),
      // Page-fetch based, no browser/JVM resource — safe to run alongside seo/content.
      parallelGroup: 'page-scan',
    },
    {
      id: 13,
      key: 'seo',
      name: 'SEO QA',
      script: 'scripts/run-seo.ts',
      skip: (ctx) => (ctx.seoEnabled ? null : 'seo.enabled is false'),
      parallelGroup: 'page-scan',
    },
    {
      id: 14,
      key: 'content',
      name: 'Content QA',
      script: 'scripts/run-content.ts',
      skip: (ctx) => (ctx.contentEnabled ? null : 'content.enabled is false'),
      parallelGroup: 'page-scan',
    },
    {
      id: 15,
      key: 'workflows',
      name: 'Combined UI+API workflows',
      script: 'scripts/run-workflows.ts',
      skip: (ctx) => (ctx.playwrightEnabled ? null : 'playwright.enabled is false'),
    },
    { id: 16, key: 'collect', name: 'Result collection', script: null },
    {
      id: 17,
      key: 'analyze',
      name: 'Failure analysis',
      script: 'scripts/analyze-failures.ts',
      skip: (ctx) => (ctx.failureAnalysisEnabled ? null : 'failureAnalysis.enabled is false'),
    },
    {
      id: 18,
      key: 'retest',
      name: 'Retesting where appropriate',
      script: 'scripts/retest.ts',
      args: ['--automation-only'],
      skip: (ctx) => (ctx.retestEnabled ? null : 'retest.enabled is false'),
    },
    { id: 19, key: 'coverage', name: 'Coverage analysis', script: 'scripts/coverage.ts' },
    {
      id: 20,
      key: 'report',
      name: 'Final report generation',
      script: 'scripts/reporting/generate-final-report.ts',
      skip: (ctx) => (ctx.reportEnabled ? null : 'report.enabled is false'),
    },
  ];
  return stages.map((stage) => ({ ...stage, phase: stagePhaseForKey(stage.key) }));
}
