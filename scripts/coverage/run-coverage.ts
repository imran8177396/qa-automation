import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import { loadConfig } from '../lib/load-config';
import { resolveConfiguredPlaywrightBaseUrl } from '../lib/suite-origin';
import { readJsonIfExists, writeJson } from '../discovery/write-json';
import { logStep, logSuccess, logWarn } from '../lib/logger';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';
import type { WorkflowInventory } from '../discovery/workflows';
import type { ApiInventory } from '../discovery/api-observe';
import type { DiscoveryResult } from '../discovery/types';
import { normalizeCrawlUrl } from '../lib/url-normalize';
import { buildInventory } from './inventory';
import { loadExecutionEvidence, loadSuiteExecutionNotes, playwrightResultsExist } from './evidence';
import { applyEvidence } from './match';
import { calculateCoverage } from './calculate';
import { renderCoverageFindings, renderCoverageMatrix, renderTestInventory, renderUncovered } from './markdown';
import { displayCoverageStatus } from './project-status';
import type { CoverageReport, CoverageStatus, CoverageSummary } from './types';

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
    'Coverage is covered (TESTED + FAILED) ÷ testable items. Pass rate is not coverage. Every inventory item is listed. BLOCKED is never TESTED. FAILED is never uncovered.'
  );
  notes.push(
    'Project statuses NOT_TESTED / REQUIRES_CONFIGURATION / NOT_EXECUTED / NOT_DISCOVERED map to BLOCKED / SKIPPED WITH REASON / NOT APPLICABLE / UNCOVERED with a reason — never omitted.'
  );
  notes.push(...loadSuiteExecutionNotes());

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
    playwrightBaseUrl: resolveConfiguredPlaywrightBaseUrl(),
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

  fs.mkdirSync(path.dirname(PATHS.testInventoryDoc), { recursive: true });
  fs.mkdirSync(path.dirname(PATHS.coverageJsonFile), { recursive: true });
  if (!report.totals.complete) {
    notes.push(
      `Do not claim 100% product coverage. Item coverage is ${report.totals.itemCoveragePercent}% of testable/executable items (${report.totals.testedItems}/${report.totals.testableItems}). Scope coverage is ${report.totals.scopeCoveragePercent}% including BLOCKED (${report.totals.testedItems}/${report.totals.scopeItems}). A login-only crawl cannot cover authenticated catalog, product XHR, or correlated workflows.`
    );
    report.notes = notes;
  }

  const summary: CoverageSummary = {
    generatedAt: report.generatedAt,
    seedUrl: report.seedUrl,
    playwrightBaseUrl: report.playwrightBaseUrl,
    formula: report.formula.coverageDefinition,
    coverageIsNotPassRate: true,
    itemCoveragePercent: report.totals.itemCoveragePercent,
    scopeCoveragePercent: report.totals.scopeCoveragePercent,
    testableItems: report.totals.testableItems,
    scopeItems: report.totals.scopeItems,
    coveredItems: report.totals.testedItems,
    testedCount: report.totals.testedCount,
    failedCount: report.totals.failedCount,
    blockedCount: report.totals.blockedCount,
    uncoveredCount: report.totals.uncoveredItems,
    complete: report.totals.complete,
    passRatePercent: report.totals.passRatePercent,
    dimensions: report.dimensions,
    riskAreas: report.riskAreas,
  };

  fs.writeFileSync(PATHS.testInventoryDoc, renderTestInventory(report), 'utf8');
  fs.writeFileSync(PATHS.coverageMatrixDoc, renderCoverageMatrix(report), 'utf8');
  fs.writeFileSync(PATHS.uncoveredItemsDoc, renderUncovered(report), 'utf8');
  fs.writeFileSync(PATHS.coverageFindingsDoc, renderCoverageFindings(report), 'utf8');
  writeJson(PATHS.coverageJsonFile, report);
  writeJson(PATHS.coverageSummaryFile, summary);
  writeJson(PATHS.coverageRiskAreasFile, {
    generatedAt: report.generatedAt,
    seedUrl: report.seedUrl,
    riskAreas: report.riskAreas,
  });
  writeJson(PATHS.coverageDimensionsFile, {
    generatedAt: report.generatedAt,
    seedUrl: report.seedUrl,
    dimensions: report.dimensions,
  });

  return report;
}

export function printCoverageSummary(report: CoverageReport): void {
  logStep('Coverage summary');
  const t = report.totals;
  console.log(`testable items     ${t.testableItems}`);
  console.log(`tested count       ${t.testedCount}  (TESTED only)`);
  console.log(`failed count       ${t.failedCount}  (executed — still covered)`);
  console.log(`blocked count      ${t.blockedCount}  (never TESTED)`);
  console.log(`uncovered count    ${t.uncoveredItems}`);
  console.log(`covered items      ${t.testedItems}  (TESTED + FAILED)`);
  console.log(`item coverage      ${t.itemCoveragePercent}%   (${t.testedItems}/${t.testableItems} testable)`);
  console.log(`scope coverage     ${t.scopeCoveragePercent}%   (${t.testedItems}/${t.scopeItems} testable+blocked)`);
  console.log(`complete           ${t.complete ? 'yes' : 'no'}  (do not claim 100% product coverage without evidence)`);
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
    if (count > 0) console.log(`status ${displayCoverageStatus(label as CoverageStatus).padEnd(22)} ${count}`);
  }
  logStep('Advanced coverage dimensions (covered ÷ testable)');
  for (const row of report.dimensions) {
    console.log(
      `${row.label.padEnd(24)} ${row.coveragePercent}%  (${row.covered}/${row.testable} testable; ${row.discovered} discovered; TESTED ${row.byStatus.TESTED} FAILED ${row.byStatus.FAILED} BLOCKED ${row.byStatus.BLOCKED} UNCOVERED ${row.uncovered})`
    );
  }
  logStep(`Risk areas (${report.riskAreas.length})`);
  if (report.riskAreas.length === 0) {
    console.log('none derived from inventory + evidence');
  } else {
    for (const row of report.riskAreas) {
      console.log(`[${row.severity}] ${row.category.padEnd(9)} ${row.title} (${row.itemCount}) — ${row.reason}`);
    }
  }
  if (report.targetMismatch) {
    logWarn(`Target mismatch: discovery ${report.seedUrl} vs Playwright ${report.playwrightBaseUrl}`);
  }
  for (const note of report.notes) logWarn(note);
  logSuccess(`test-inventory.md       ${PATHS.testInventoryDoc}`);
  logSuccess(`coverage-matrix.md      ${PATHS.coverageMatrixDoc}`);
  logSuccess(`uncovered-test-items.md ${PATHS.uncoveredItemsDoc}`);
  logSuccess(`coverage.json           ${PATHS.coverageJsonFile}`);
  logSuccess(`summary.json            ${PATHS.coverageSummaryFile}`);
  logSuccess(`risk-areas.json         ${PATHS.coverageRiskAreasFile}`);
  logSuccess(`dimensions.json         ${PATHS.coverageDimensionsFile}`);
  logSuccess(`findings.md             ${PATHS.coverageFindingsDoc}`);
}
