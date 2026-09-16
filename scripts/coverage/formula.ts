import { normalizeCrawlUrl } from '../lib/url-normalize';
import {
  UI_ELEMENT_KINDS,
  type CoverageFormula,
  type CoverageRecord,
  type CoverageTotals,
  type DimensionContribution,
  type ExcludedInventoryItem,
  type InventoryItem,
  type InventoryKind,
} from './types';
import { isCoveredStatus, isTestable, percent } from './status';

export const TESTABLE_ITEM_DEFINITION =
  'A testable item is an inventoried page, route, interactive element, endpoint, workflow, or capability that has at least one scenario with disposition "executable". Items collapsed by URL normalization (trailing slash, sorted query, dropped sort/pagination/Apache C/O params) are counted once in the denominator.';

export const COVERAGE_DEFINITION =
  'Coverage = items with status TESTED or FAILED ÷ testable items after URL dedupe. Pass rate (passed executions ÷ executed executions) is not coverage.';

export const SCOPE_COVERAGE_DEFINITION =
  'Scope coverage = items with status TESTED or FAILED ÷ (testable items + BLOCKED items). The original item-coverage formula is unchanged. BLOCKED residual inventory (auth catalog, safety-gated submit) stays in this second denominator so a login-only crawl cannot be reported as 100% product coverage.';

export const COVERAGE_IS_NOT_PASS_RATE =
  'Coverage is not pass rate. A FAILED item still counts as covered. Passing tests that do not match a discovered item do not increase coverage.';

export const ELEMENT_COVERAGE_KINDS: readonly InventoryKind[] = UI_ELEMENT_KINDS;

export const FUNCTIONAL_AREA_COVERAGE_KINDS: readonly InventoryKind[] = [
  'page',
  'route',
  'workflow',
  'api',
  'browser',
  'viewport',
  'accessibility',
  'visual',
  'performance',
  'security',
  'seo',
  'content',
];

const PAGE_KINDS: readonly InventoryKind[] = ['page'];
const ELEMENT_KINDS = ELEMENT_COVERAGE_KINDS;
const ENDPOINT_KINDS: readonly InventoryKind[] = ['api'];
const WORKFLOW_KINDS: readonly InventoryKind[] = ['workflow'];

export interface FormulaMeta {
  pagesDiscoveredRaw?: number;
  pagesDiscoveredUnique?: number;
}

function uniqueUrlKey(url: string): string {
  try {
    return normalizeCrawlUrl(url);
  } catch {
    return url;
  }
}

function contribution(
  items: InventoryItem[],
  records: CoverageRecord[],
  kinds: readonly InventoryKind[],
  extra?: { discoveredRaw?: number; discoveredUnique?: number }
): DimensionContribution {
  const dimItems = items.filter((item) => kinds.includes(item.kind));
  const ids = new Set(dimItems.map((item) => item.id));
  const dimRecords = records.filter((row) => ids.has(row.id));
  const testable = dimItems.filter(isTestable);
  const covered = dimRecords.filter((row) => isCoveredStatus(row.status)).length;
  const excluded = dimItems
    .filter((item) => !isTestable(item))
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      reason: item.applicableScenarios[0]?.reason ?? item.coverageHint ?? 'Not testable',
    }));

  const uniqueFromUrls = new Set(
    dimItems.map((item) => uniqueUrlKey(item.page ?? item.route ?? item.id))
  ).size;

  return {
    discovered: dimItems.length,
    discoveredRaw: extra?.discoveredRaw ?? dimItems.length,
    discoveredUnique: extra?.discoveredUnique ?? uniqueFromUrls,
    testable: testable.length,
    covered,
    uncovered: dimRecords.filter((row) => row.status === 'UNCOVERED').length,
    excluded,
    coveragePercent: percent(covered, testable.length),
  };
}

function figure(items: InventoryItem[], records: CoverageRecord[], kinds: readonly InventoryKind[], label: string) {
  const dimItems = items.filter((item) => kinds.includes(item.kind));
  const ids = new Set(dimItems.map((item) => item.id));
  const dimRecords = records.filter((row) => ids.has(row.id));
  const testable = dimItems.filter(isTestable).length;
  const covered = dimRecords.filter((row) => isCoveredStatus(row.status)).length;
  return {
    label,
    kinds: [...kinds],
    discovered: dimItems.length,
    testable,
    covered,
    coveragePercent: percent(covered, testable),
  };
}

export function deriveCoverageFormula(
  items: InventoryItem[],
  records: CoverageRecord[],
  totals: CoverageTotals,
  meta: FormulaMeta = {}
): CoverageFormula {
  const excludedItems: ExcludedInventoryItem[] = items
    .filter((item) => !isTestable(item))
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      reason: item.applicableScenarios[0]?.reason ?? item.coverageHint ?? 'Not testable',
      coverageHint: item.coverageHint ?? null,
    }));

  const pageItems = items.filter((item) => item.kind === 'page');
  const pagesUnique = new Set(pageItems.map((item) => uniqueUrlKey(item.page ?? item.id))).size;

  return {
    testableItemDefinition: TESTABLE_ITEM_DEFINITION,
    coverageDefinition: COVERAGE_DEFINITION,
    coverageIsNotPassRate: true,
    warning: COVERAGE_IS_NOT_PASS_RATE,
    denominatorAfterDedupe: true,
    howToRead: {
      numerator: 'Covered count (TESTED + FAILED) per dimension',
      denominator: 'Testable unique items after URL normalization (P2-1 dedupe)',
      passRate: 'passed executions ÷ executed executions — reported separately, never used as coverage',
    },
    scopeDefinition: SCOPE_COVERAGE_DEFINITION,
    totals: {
      discoveredItems: totals.discoveredItems,
      testableItems: totals.testableItems,
      coveredItems: totals.testedItems,
      itemCoveragePercent: totals.itemCoveragePercent,
      scopeItems: totals.scopeItems,
      scopeCoveragePercent: totals.scopeCoveragePercent,
      passRatePercent: totals.passRatePercent,
    },
    figures: {
      elementCoverage: figure(items, records, ELEMENT_COVERAGE_KINDS, 'Element coverage'),
      functionalAreaCoverage: figure(items, records, FUNCTIONAL_AREA_COVERAGE_KINDS, 'Functional-area coverage'),
    },
    contributions: {
      pages: contribution(items, records, PAGE_KINDS, {
        discoveredRaw: meta.pagesDiscoveredRaw ?? pageItems.length,
        discoveredUnique: meta.pagesDiscoveredUnique ?? pagesUnique,
      }),
      interactiveElements: contribution(items, records, ELEMENT_KINDS),
      endpoints: contribution(items, records, ENDPOINT_KINDS),
      workflows: contribution(items, records, WORKFLOW_KINDS),
    },
    excludedItems,
  };
}
