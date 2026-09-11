import fs from 'fs';
import { PATHS } from '../lib/paths';
import { loadConfig } from '../lib/load-config';
import { readJsonIfExists, writeJson } from '../discovery/write-json';
import { logStep, logSuccess, logWarn } from '../lib/logger';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';
import type { WorkflowInventory } from '../discovery/workflows';
import type { ApiInventory } from '../discovery/api-observe';
import type { DiscoveryResult } from '../discovery/types';
import { normalizeCrawlUrl } from '../lib/url-normalize';
import { buildInventory } from './inventory';
import { loadExecutionEvidence, playwrightResultsExist } from './evidence';
import { applyEvidence } from './match';
import { calculateCoverage } from './calculate';
import { renderCoverageMatrix, renderTestInventory, renderUncovered } from './markdown';
import type { CoverageReport } from './types';

export function runCoverage(): CoverageReport {
  const config = loadConfig();
  const notes: string[] = [];

  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  const discovery = readJsonIfExists<DiscoveryResult>(PATHS.discoveryFile);
  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const workflows = readJsonIfExists<WorkflowInventory>(PATHS.workflowInventoryFile);
  const api = readJsonIfExists<ApiInventory>(PATHS.apiInventoryFile);

  const uniqueFromMap = new Set(
    (pageMap?.pages ?? []).map((page) => {
      try {
        return normalizeCrawlUrl(page.url);
      } catch {
        return page.url;
      }
    })
  ).size;
  const pagesDiscoveredRaw =
    discovery?.pagesDiscoveredRaw ?? pageMap?.pagesDiscoveredRaw ?? pageMap?.pages.length ?? 0;
  const pagesDiscoveredUnique =
    discovery?.pagesDiscoveredUnique ?? pageMap?.pagesDiscoveredUnique ?? uniqueFromMap;

  notes.push(
    'Coverage is covered (TESTED + FAILED) ÷ testable discovered items. Pass rate is not coverage. Every inventory item is listed.'
  );

  if (!pageMap && !ui) {
    notes.push(
      'Discovery inventories were not found under discovery/. Run `npm run discover -- <url>` before treating page/UI coverage as complete.'
    );
  }

  const evidence = loadExecutionEvidence();
  if (evidence.length === 0) {
    notes.push(
      'No Playwright, visual, or Postman execution artifacts were found. Items are not marked tested without execution evidence.'
    );
  }
  if (!playwrightResultsExist()) {
    notes.push(
      'reports/playwright/e2e/results.json and reports/playwright/generated-check/results.json are missing — browser combinations have no execution evidence.'
    );
  }

  const items = applyEvidence(buildInventory({ pageMap, ui, workflows, api }, config), evidence);
  const report = calculateCoverage(items, evidence, {
    seedUrl: pageMap?.seedUrl ?? ui?.seedUrl ?? null,
    playwrightBaseUrl: config.playwright.baseURL,
    notes,
    pagesDiscoveredRaw,
    pagesDiscoveredUnique,
  });

  if (report.targetMismatch) {
    notes.push(
      `Discovery seed (${report.seedUrl}) and Playwright baseURL (${report.playwrightBaseUrl}) differ. Coverage counts executions that match the discovered host, not the configured baseURL alone.`
    );
    report.notes = notes;
  }

  fs.writeFileSync(PATHS.testInventoryDoc, renderTestInventory(report), 'utf8');
  fs.writeFileSync(PATHS.coverageMatrixDoc, renderCoverageMatrix(report), 'utf8');
  fs.writeFileSync(PATHS.uncoveredItemsDoc, renderUncovered(report), 'utf8');
  writeJson(PATHS.coverageJsonFile, report);

  return report;
}

export function printCoverageSummary(report: CoverageReport): void {
  logStep('Coverage summary');
  const t = report.totals;
  console.log(`testable items     ${t.testableItems}`);
  console.log(`covered items      ${t.testedItems}  (TESTED + FAILED)`);
  console.log(`uncovered items    ${t.uncoveredItems}`);
  console.log(`item coverage      ${t.itemCoveragePercent}%   (${t.testedItems}/${t.testableItems})`);
  console.log(`scenario coverage  ${t.scenarioCoveragePercent}%   (${t.testedScenarios}/${t.executableScenarios})`);
  console.log(
    `pass rate          ${t.passRatePercent == null ? 'no executions' : `${t.passRatePercent}%`}  (not coverage)`
  );
  const element = report.formula.figures.elementCoverage;
  const functional = report.formula.figures.functionalAreaCoverage;
  console.log(
    `element coverage   ${element.coveragePercent}%  (${element.covered}/${element.testable})`
  );
  console.log(
    `functional-area    ${functional.coveragePercent}%  (${functional.covered}/${functional.testable})`
  );
  console.log(
    `pages raw/unique   ${report.formula.contributions.pages.discoveredRaw}/${report.formula.contributions.pages.discoveredUnique}`
  );
  for (const [label, count] of Object.entries(t.byStatus)) {
    if (count > 0) console.log(`status ${label.padEnd(16)} ${count}`);
  }
  logStep('Advanced coverage dimensions (covered ÷ testable)');
  for (const row of report.dimensions) {
    console.log(
      `${row.label.padEnd(24)} ${row.coveragePercent}%  (${row.covered}/${row.testable} testable; ${row.discovered} discovered)`
    );
  }
  if (report.targetMismatch) {
    logWarn(`Target mismatch: discovery ${report.seedUrl} vs Playwright ${report.playwrightBaseUrl}`);
  }
  for (const note of report.notes) logWarn(note);
  logSuccess(`test-inventory.md       ${PATHS.testInventoryDoc}`);
  logSuccess(`coverage-matrix.md      ${PATHS.coverageMatrixDoc}`);
  logSuccess(`uncovered-test-items.md ${PATHS.uncoveredItemsDoc}`);
  logSuccess(`coverage.json           ${PATHS.coverageJsonFile}`);
}
