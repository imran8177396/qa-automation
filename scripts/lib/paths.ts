import path from 'path';

export const ROOT = path.resolve(__dirname, '../..');

/** Section 2.6 source — generated-check suite JSON only. Suites no longer share reports/playwright/results.json. */
export const generatedCheckResultsPath = path.join(
  ROOT,
  'reports',
  'playwright',
  'generated-check',
  'results.json'
);

export const PATHS = {
  root: ROOT,
  config: path.join(ROOT, 'qa.config.json'),
  generatedEnv: path.join(ROOT, 'config', 'generated.env'),
  postmanCollection: path.join(ROOT, 'tests', 'api', 'postman', 'collections', 'qa-automation-api.json'),
  postmanEnvironment: path.join(ROOT, 'tests', 'api', 'postman', 'environments', 'local.json'),
  postmanExport: path.join(ROOT, 'postman', 'QA-Automation-API.postman_collection.json'),
  postmanExportEnvironment: path.join(
    ROOT,
    'postman',
    'QA-Automation-API.postman_environment.json'
  ),
  jmeterPlan: path.join(ROOT, 'tests', 'performance', 'load-test.jmx'),
  jmeterSummary: path.join(ROOT, 'reports', 'jmeter', 'summary.json'),
  jmeterFindings: path.join(ROOT, 'reports', 'jmeter', 'findings.md'),
  jmeterResults: path.join(ROOT, 'reports', 'jmeter', 'results.jtl'),
  lighthouseSummary: path.join(ROOT, 'reports', 'lighthouse', 'summary.json'),
  lighthouseFindings: path.join(ROOT, 'reports', 'lighthouse', 'findings.md'),
  generatedCheckResultsPath,
  reports: {
    root: path.join(ROOT, 'reports'),
    postman: path.join(ROOT, 'reports', 'postman'),
    jmeter: path.join(ROOT, 'reports', 'jmeter'),
    lighthouse: path.join(ROOT, 'reports', 'lighthouse'),
    playwright: path.join(ROOT, 'reports', 'playwright'),
    visual: path.join(ROOT, 'reports', 'visual'),
    responsive: path.join(ROOT, 'reports', 'responsive'),
    crossBrowser: path.join(ROOT, 'reports', 'cross-browser'),
    accessibility: path.join(ROOT, 'reports', 'accessibility'),
    workflows: path.join(ROOT, 'reports', 'workflows'),
    security: path.join(ROOT, 'reports', 'security'),
    dependencies: path.join(ROOT, 'reports', 'dependencies'),
    seo: path.join(ROOT, 'reports', 'seo'),
    content: path.join(ROOT, 'reports', 'content'),
    failures: path.join(ROOT, 'reports', 'failures'),
    retest: path.join(ROOT, 'reports', 'retest'),
    summary: path.join(ROOT, 'reports', 'summary'),
    orchestrator: path.join(ROOT, 'reports', 'orchestrator'),
    discovery: path.join(ROOT, 'reports', 'discovery'),
    quality: path.join(ROOT, 'reports', 'quality'),
  },
  visualBaselinesDir: path.join(ROOT, 'visual-baselines'),
  discoveryFile: path.join(ROOT, 'reports', 'discovery', 'discovery.json'),
  inventoryFile: path.join(ROOT, 'reports', 'discovery', 'inventory.json'),
  plannedChecksFile: path.join(ROOT, 'reports', 'discovery', 'planned-checks.json'),
  uiChecksFile: path.join(ROOT, 'reports', 'discovery', 'ui-checks.json'),
  gatedCheckOutcomesFile: path.join(ROOT, 'reports', 'discovery', 'gated-check-outcomes.json'),
  seoFile: path.join(ROOT, 'reports', 'discovery', 'seo.json'),
  generatedSpecsDir: path.join(ROOT, 'tests', 'e2e', 'generated'),
  fixturesSiteDir: path.join(ROOT, 'fixtures', 'site'),
  discoveryDir: path.join(ROOT, 'discovery'),
  pageMapFile: path.join(ROOT, 'discovery', 'page-map.json'),
  uiInventoryFile: path.join(ROOT, 'discovery', 'ui-inventory.json'),
  workflowInventoryFile: path.join(ROOT, 'discovery', 'workflow-inventory.json'),
  apiInventoryFile: path.join(ROOT, 'discovery', 'api-inventory.json'),
  coverageJsonFile: path.join(ROOT, 'reports', 'coverage', 'coverage.json'),
  testInventoryDoc: path.join(ROOT, 'docs', 'test-inventory.md'),
  coverageMatrixDoc: path.join(ROOT, 'docs', 'coverage-matrix.md'),
  uncoveredItemsDoc: path.join(ROOT, 'docs', 'uncovered-test-items.md'),
  docsQaTestResultsInput: path.join(ROOT, 'docs', 'input', 'qa-test-results'),
  docsQaTestResultsOutput: path.join(ROOT, 'docs', 'output', 'qa-test-results'),
  docsQaTestResultsLatest: path.join(ROOT, 'docs', 'output', 'qa-test-results', 'latest.json'),
};

/** Dated professional pack folders for one run. Never delete sibling timestamp folders. */
export function qaTestResultsStampDirs(timestamp: string): { input: string; output: string } {
  return {
    input: path.join(PATHS.docsQaTestResultsInput, timestamp),
    output: path.join(PATHS.docsQaTestResultsOutput, timestamp),
  };
}
