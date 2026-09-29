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
import type { DiscoveryInventory } from '../discovery/inventory';
import { parsePlannedChecks, type PlannedCheck } from '../planning/types';
import { normalizeCrawlUrl } from '../lib/url-normalize';
import { buildInventory } from './inventory';
import { loadExecutionEvidence, loadSuiteExecutionNotes, playwrightResultsExist } from './evidence';
import { applyEvidence } from './match';
import { calculateCoverage } from './calculate';
import { plannedChecksToCoverageItems, summarizeScenarioInventory } from './planned-scenario-items';
import { renderCoverageFindings, renderCoverageMatrix, renderTestInventory, renderUncovered } from './markdown';
import { displayCoverageStatus } from './project-status';
import type { CoverageReport, CoverageStatus, CoverageSummary } from './types';
import {
  buildScreenCoverageMatrix,
  renderScreenCoverageMatrixMarkdown,
  type ScreenCoverageMatrixScreenInput,
} from './screen-coverage-matrix';
import { buildTestCaseTraces, type TestCaseTrace } from '../planning/traceability';
import { deduplicateTestCases, type DedupableTestCase } from '../planning/test-case-uniqueness';
import {
  buildCompletenessReport,
  renderCompletenessReport,
  type CompletenessReport,
} from './completeness-report';
import {
  buildCoverageSeparation,
  renderCoverageSeparation,
  type CoverageSeparationInput,
} from './coverage-separation';

/** Map a planned check into the uniqueness deduper without inventing fields. */
function plannedCheckToDedupable(check: PlannedCheck): DedupableTestCase {
  return {
    id: check.id,
    screenId: check.screenId,
    targetElementId: check.targetElementId,
    category: check.category,
    scenarioKind: check.scenarioKind,
    title: check.title,
    action: check.action,
    expect: check.expect,
    status: check.status,
    reason: check.reason,
    // purpose is scan evidence; method/url stay unset unless a future source provides them.
    elementType: check.purpose,
    controlLabel:
      typeof check.expect?.accessibleName === 'string' ? check.expect.accessibleName : undefined,
  };
}

/**
 * Real inputs only for the five separate measurements.
 * - knownScreenCount is never the discovered count (no independent census → discovery NOT_MEASURED).
 * - test generation from completeness when present; skip when absent.
 * - execution / pass rate from traces when present.
 * - requirement never invents a requirements file.
 */
function buildCoverageSeparationInput(opts: {
  completeness: CompletenessReport | null;
  traces: TestCaseTrace[] | null;
  generatedCaseCount: number | null;
}): CoverageSeparationInput {
  let completeness = opts.completeness;
  let traces = opts.traces;
  let generatedCaseCount = opts.generatedCaseCount;

  // Fall back to on-disk artifacts without crawling when this run did not rebuild them.
  if (completeness == null) {
    completeness = readJsonIfExists<CompletenessReport>(PATHS.completenessReportFile);
  }
  if (traces == null) {
    const fromDisk = readJsonIfExists<{ traces?: TestCaseTrace[] }>(PATHS.testCaseTraceFile);
    if (fromDisk?.traces && Array.isArray(fromDisk.traces)) {
      traces = fromDisk.traces;
    }
  }
  if (generatedCaseCount == null && traces != null) {
    generatedCaseCount = traces.length;
  }
  if (generatedCaseCount == null) {
    const unique = readJsonIfExists<{ caseCount?: number }>(PATHS.uniqueTestCasesFile);
    if (typeof unique?.caseCount === 'number' && Number.isFinite(unique.caseCount)) {
      generatedCaseCount = unique.caseCount;
    }
  }

  const input: CoverageSeparationInput = {
    // Do not pass discovered count as known — leave null unless an independent census exists.
    knownScreenCount: null,
    // No requirements array supplied — never invent requirements from a fake file.
    requirementCount: null,
    requirementsCovered: null,
  };

  if (completeness != null) {
    input.testableElementCount = completeness.testableElements;
    input.testableElementsWithCase = Math.max(
      0,
      completeness.testableElements - completeness.testableElementsWithoutTestCases
    );
  }

  if (generatedCaseCount != null && Number.isFinite(generatedCaseCount)) {
    input.generatedCaseCount = generatedCaseCount;
  }

  if (traces != null) {
    const executed = traces.filter((t) => t.execution === 'EXECUTED');
    input.executedCaseCount = executed.length;
    input.passedCaseCount = executed.filter((t) => t.result === 'PASS').length;
  }

  return input;
}

/**
 * Prefer discovery-inventory ScreenInventory rows; else ui.screenElements + pageMap titles.
 * Never invents Login/Dashboard/etc. Missing artifacts → [].
 */
function resolveScreensForMatrix(
  pageMap: PageMap | null,
  ui: UiInventory | null
): ScreenCoverageMatrixScreenInput[] {
  const discoveryInv = readJsonIfExists<DiscoveryInventory>(PATHS.discoveryInventoryFile);
  if (discoveryInv?.inventories && discoveryInv.inventories.length > 0) {
    return discoveryInv.inventories.map((inv) => ({
      screenId: inv.screenId,
      url: inv.url ?? inv.route,
      title: inv.title,
      elements: (inv.elements ?? []).map((el) => ({
        elementId: el.elementId,
        type: typeof el.type === 'string' ? el.type : undefined,
        decorative:
          el.metadata?.decorative === true ||
          el.type === 'decorative' ||
          el.metadata?.elementKind === 'decorative',
      })),
    }));
  }

  if (ui?.screenElements && ui.screenElements.length > 0) {
    const titleById = new Map((pageMap?.screens ?? []).map((s) => [s.id, s.title]));
    return ui.screenElements.map((group) => ({
      screenId: group.screenId,
      url: group.url,
      title: titleById.get(group.screenId),
      elements: (group.elements ?? []).map((el) => ({
        elementId: el.elementId,
        type:
          typeof el.type === 'string'
            ? el.type
            : typeof el.elementKind === 'string'
              ? el.elementKind
              : undefined,
        decorative: el.elementKind === 'decorative' || el.type === 'decorative',
      })),
    }));
  }

  if (pageMap?.screens && pageMap.screens.length > 0) {
    return pageMap.screens.map((s) => ({
      screenId: s.id,
      url: s.url,
      title: s.title,
      elements: [],
    }));
  }

  return [];
}

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

  const plannedRaw = readJsonIfExists<unknown>(PATHS.plannedChecksFile);
  const scenarioSummary = summarizeScenarioInventory(plannedRaw ?? []);
  if (scenarioSummary.total > 0) {
    notes.push(
      `Scenario inventory (planned-checks.json): ${scenarioSummary.total} rows (${scenarioSummary.planned} PLANNED, ${scenarioSummary.gated} gated). Unexecuted PLANNED rows are not TESTED — coverage is not 100% from planning alone.`
    );
  }

  const baseItems = buildInventory({ pageMap, ui, workflows, api }, config);
  const scenarioItems = plannedChecksToCoverageItems(plannedRaw ?? []);
  const items = applyEvidence([...baseItems, ...scenarioItems], evidence);
  const report = calculateCoverage(items, evidence, {
    seedUrl: pageMap?.seedUrl ?? ui?.seedUrl ?? null,
    playwrightBaseUrl: resolveConfiguredPlaywrightBaseUrl(),
    notes,
    pagesDiscoveredRaw,
    pagesDiscoveredUnique,
    config,
    testTypeDimensions: { loadEngineSummariesFromDisk: true },
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

  // Screen matrix + test-case traces: plan inventory only. Skip writes when planned-checks.json is absent.
  // Does not invent screens/elements/PASS; empty screen source → matrix rows [] and no element gaps.
  // Dedup equivalent rows for matrix/trace counts; planned-checks.json stays the full pre-dedupe audit.
  let completenessForSeparation: CompletenessReport | null = null;
  let tracesForSeparation: TestCaseTrace[] | null = null;
  let generatedCaseCountForSeparation: number | null = null;

  if (plannedRaw != null) {
    const plannedChecks = parsePlannedChecks(plannedRaw);
    const dedupables: DedupableTestCase[] = plannedChecks.map(plannedCheckToDedupable);
    const { kept: uniqueCases, removed: uniqueRemoved, keptIndexes } = deduplicateTestCases(dedupables);
    const uniquePlannedChecks = keptIndexes.map((i) => plannedChecks[i]!);
    writeJson(PATHS.uniqueTestCasesFile, {
      generatedAt: new Date().toISOString(),
      removed: uniqueRemoved,
      caseCount: uniqueCases.length,
      cases: uniqueCases,
      rawPlannedChecksRetained: true,
      note:
        'Deduped unique test cases. reports/discovery/planned-checks.json still contains the full pre-dedupe audit rows.',
    });
    notes.push(
      `Unique test cases: ${uniqueCases.length} kept, ${uniqueRemoved} duplicate(s) removed — planned-checks.json retains pre-dedupe rows.`
    );

    const screensForMatrix = resolveScreensForMatrix(pageMap, ui);
    const matrix = buildScreenCoverageMatrix({
      screens: screensForMatrix,
      checks: uniquePlannedChecks,
    });
    writeJson(PATHS.screenCoverageMatrixFile, matrix);
    fs.writeFileSync(
      PATHS.screenCoverageMatrixDoc,
      renderScreenCoverageMatrixMarkdown(matrix.rows),
      'utf8'
    );
    notes.push(
      `Screen coverage matrix: ${matrix.rows.length} discovered screen row(s) — unique plan inventory counts only, not executed coverage %.`
    );

    // Traceability beside the matrix. Screens from inventory when present; else checks only
    // (empty screens → no invented element gaps). Never fabricates PASS from planned status.
    const traceResult = buildTestCaseTraces({
      projectId: 'default',
      screens: screensForMatrix.map((s) => ({
        screenId: s.screenId,
        elements: (s.elements ?? []).map((el) => ({
          elementId: el.elementId,
          type: el.type,
          decorative: el.decorative,
        })),
      })),
      checks: uniquePlannedChecks.map((c) => ({
        id: c.id,
        screenId: c.screenId,
        targetElementId: c.targetElementId,
        scenarioKind: c.scenarioKind,
        category: c.category,
        status: c.status,
        expect: c.expect,
      })),
    });
    writeJson(PATHS.testCaseTraceFile, traceResult);
    notes.push(
      `Test-case traceability: ${traceResult.traces.length} trace(s), ${traceResult.gaps.length} gap(s) — unexecuted rows stay NOT_EXECUTED.`
    );
    tracesForSeparation = traceResult.traces;
    generatedCaseCountForSeparation = uniqueCases.length;

    // Completeness beside matrix/traces. Same screens/elements; unique-case count preferred.
    // rawGeneratedTestCases = full planned-check length (pre-dedupe). Skip when plannedRaw absent.
    const completenessElements = screensForMatrix.flatMap((s) =>
      (s.elements ?? []).map((el) => ({
        elementId: el.elementId,
        screenId: s.screenId,
        decorative: el.decorative === true,
      }))
    );
    const testCaseScreenIds = uniquePlannedChecks
      .map((c) => c.screenId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const testCaseElementIds = uniquePlannedChecks
      .map((c) => c.targetElementId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const completeness = buildCompletenessReport({
      screens: screensForMatrix.map((s) => ({ screenId: s.screenId })),
      elements: completenessElements,
      testCaseScreenIds,
      testCaseElementIds,
      // Prefer unique-case count so duplicates are not inflated.
      generatedTestCases: uniqueCases.length,
      rawGeneratedTestCases: plannedChecks.length,
    });
    writeJson(PATHS.completenessReportFile, completeness);
    fs.writeFileSync(PATHS.completenessReportDoc, renderCompletenessReport(completeness), 'utf8');
    notes.push(
      `Discovery completeness: ${completeness.discoveredScreens} screen(s), ${completeness.discoveredElements} element(s), ${completeness.generatedTestCases} unique case(s) (${completeness.rawGeneratedTestCases ?? plannedChecks.length} raw planned) — ${completeness.gaps.length} gap(s).`
    );
    completenessForSeparation = completeness;
    report.notes = notes;
  }

  // Five separate measurements — never claim 100% from generation alone.
  // knownScreenCount stays null (discovered count is not an independent census).
  // Requirement stays NOT_MEASURED unless a requirements array is supplied (never invent one).
  const separationInput = buildCoverageSeparationInput({
    completeness: completenessForSeparation,
    traces: tracesForSeparation,
    generatedCaseCount: generatedCaseCountForSeparation,
  });
  const separation = buildCoverageSeparation(separationInput);
  writeJson(PATHS.coverageSeparationFile, separation);
  fs.writeFileSync(PATHS.coverageSeparationDoc, renderCoverageSeparation(separation), 'utf8');
  notes.push(
    'Coverage separation: discovery / test generation / execution / pass rate / requirement are separate — generation is not execution or pass rate.'
  );
  report.notes = notes;

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
    testTypeDimensions: report.testTypeDimensions,
    overallTestTypeCoveragePct: report.overallTestTypeCoveragePct,
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
    testTypeDimensions: report.testTypeDimensions,
    // Overall = mean of MEASURED coveragePct only; null when none measured.
    overallTestTypeCoveragePct: report.overallTestTypeCoveragePct,
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
  logStep('Test-type dimensions (inventory/engine — not pass rate)');
  const overall =
    report.overallTestTypeCoveragePct == null ? 'null (none measured)' : `${report.overallTestTypeCoveragePct}%`;
  console.log(`overall (MEASURED mean) ${overall}`);
  for (const row of report.testTypeDimensions) {
    const pct = row.coveragePct == null ? 'n/a' : `${row.coveragePct}%`;
    console.log(
      `${row.dimension.padEnd(16)} ${row.status.padEnd(24)} testable=${row.testable} tested=${row.tested} failed=${row.failed} coverage=${pct}${row.reason ? ` — ${row.reason}` : ''}`
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
  if (fs.existsSync(PATHS.screenCoverageMatrixFile)) {
    logSuccess(`screen-coverage-matrix  ${PATHS.screenCoverageMatrixFile}`);
  }
  if (fs.existsSync(PATHS.testCaseTraceFile)) {
    logSuccess(`test-case-trace         ${PATHS.testCaseTraceFile}`);
  }
  if (fs.existsSync(PATHS.uniqueTestCasesFile)) {
    logSuccess(`unique-test-cases       ${PATHS.uniqueTestCasesFile}`);
  }
  if (fs.existsSync(PATHS.completenessReportFile)) {
    logSuccess(`completeness-report     ${PATHS.completenessReportFile}`);
  }
  if (fs.existsSync(PATHS.coverageSeparationFile)) {
    logSuccess(`coverage-separation     ${PATHS.coverageSeparationFile}`);
  }
}
