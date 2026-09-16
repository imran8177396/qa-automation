import { INVENTORY_KINDS, type CoverageReport, type CoverageTotals, type InventoryItem, type KindCoverage } from './types';
import type { ExecutionEvidence } from './types';
import { calculateDimensions } from './dimensions';
import { deriveCoverageFormula } from './formula';
import { deriveRiskAreas } from './risk-areas';
import { uiExecutionPassRate } from '../lib/pass-rate';
import { classifyItem, emptyByStatus, isCoveredStatus, isTestable, percent, toCoverageRecord } from './status';

export function isTested(item: InventoryItem): boolean {
  return item.applicableScenarios.some((scenario) => scenario.disposition === 'executable' && scenario.tested);
}

export function isUncovered(item: InventoryItem, evidence: ExecutionEvidence[] = []): boolean {
  return classifyItem(item, evidence).status === 'UNCOVERED';
}

export function calculateCoverage(
  items: InventoryItem[],
  evidence: ExecutionEvidence[],
  meta: {
    seedUrl: string | null;
    playwrightBaseUrl: string;
    notes: string[];
    pagesDiscoveredRaw?: number;
    pagesDiscoveredUnique?: number;
  }
): CoverageReport {
  const testableItems = items.filter(isTestable);
  const executableScenarios = items.flatMap((item) =>
    item.applicableScenarios.filter((scenario) => scenario.disposition === 'executable')
  );
  const testedScenarios = executableScenarios.filter((scenario) => scenario.tested);

  const passed = evidence.filter((row) => row.executed && row.status === 'PASS').length;
  const failed = evidence.filter((row) => row.executed && row.status === 'FAIL').length;
  const skipped = evidence.filter((row) => row.status === 'SKIPPED').length;
  const records = items.map((item) => toCoverageRecord(item, evidence));
  const byStatus = emptyByStatus();
  for (const row of records) byStatus[row.status] += 1;
  const coveredItems = records.filter((row) => isCoveredStatus(row.status)).length;

  const uncoveredItems = records.filter((row) => row.status === 'UNCOVERED').length;
  const testedCount = byStatus.TESTED;
  const failedCount = byStatus.FAILED;
  const blockedCount = byStatus.BLOCKED;
  const scopeItems = testableItems.length + blockedCount;
  const discoveryPages = items.filter(
    (item) => item.kind === 'page' && item.source === 'discovery' && !item.id.startsWith('CAT-')
  ).length;
  const loginOnlyCrawl = discoveryPages <= 1;
  const totals: CoverageTotals = {
    discoveredItems: items.filter((item) => item.source === 'discovery').length,
    testableItems: testableItems.length,
    testedItems: coveredItems,
    testedCount,
    failedCount,
    blockedCount,
    uncoveredItems,
    itemCoveragePercent: percent(coveredItems, testableItems.length),
    scopeItems,
    scopeCoveragePercent: percent(coveredItems, scopeItems),
    complete:
      testableItems.length > 0 &&
      uncoveredItems === 0 &&
      blockedCount === 0 &&
      coveredItems === testableItems.length &&
      !loginOnlyCrawl,
    executableScenarios: executableScenarios.length,
    testedScenarios: testedScenarios.length,
    scenarioCoveragePercent: percent(testedScenarios.length, executableScenarios.length),
    passedExecutions: passed,
    failedExecutions: failed,
    skippedExecutions: skipped,
    passRatePercent: uiExecutionPassRate({ passed, failed, skipped }).value,
    byStatus,
  };

  const byKind: KindCoverage[] = INVENTORY_KINDS.map((kind) => {
    const kindItems = items.filter((item) => item.kind === kind);
    const testable = kindItems.filter(isTestable);
    const kindRecords = records.filter((row) => row.kind === kind);
    const tested = kindRecords.filter((row) => isCoveredStatus(row.status)).length;
    const exec = kindItems.flatMap((item) =>
      item.applicableScenarios.filter((scenario) => scenario.disposition === 'executable')
    );
    const execTested = exec.filter((scenario) => scenario.tested);
    return {
      kind,
      discovered: kindItems.length,
      testable: testable.length,
      tested,
      uncovered: kindItems.filter((item) => isUncovered(item, evidence)).length,
      executableScenarios: exec.length,
      testedScenarios: execTested.length,
      itemCoveragePercent: percent(tested, testable.length),
      scenarioCoveragePercent: percent(execTested.length, exec.length),
    };
  }).filter((row) => row.discovered > 0);

  let seedHost: string | null = null;
  let baseHost: string | null = null;
  try {
    if (meta.seedUrl) seedHost = new URL(meta.seedUrl).host;
  } catch {
    seedHost = null;
  }
  try {
    baseHost = new URL(meta.playwrightBaseUrl).host;
  } catch {
    baseHost = null;
  }

  const dimensions = calculateDimensions(items, records);
  const riskAreas = deriveRiskAreas(items, records);

  return {
    generatedAt: new Date().toISOString(),
    seedUrl: meta.seedUrl,
    playwrightBaseUrl: meta.playwrightBaseUrl,
    targetMismatch: Boolean(seedHost && baseHost && seedHost !== baseHost),
    notes: meta.notes,
    totals,
    byKind,
    dimensions,
    formula: deriveCoverageFormula(items, records, totals, {
      pagesDiscoveredRaw: meta.pagesDiscoveredRaw,
      pagesDiscoveredUnique: meta.pagesDiscoveredUnique,
    }),
    riskAreas,
    records,
    items,
    evidence,
  };
}
