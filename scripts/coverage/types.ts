export const INVENTORY_KINDS = [
  'page',
  'route',
  'form',
  'field',
  'button',
  'link',
  'navigation',
  'dropdown',
  'checkbox',
  'radio',
  'toggle',
  'table',
  'ui-component',
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
] as const;

export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export const SCENARIO_IDS = [
  'page-load',
  'broken-link',
  'visibility',
  'enabled-state',
  'form-presence',
  'valid-input',
  'invalid-input',
  'empty-input',
  'required-validation',
  'boundary-values',
  'special-characters',
  'whitespace-input',
  'long-input',
  'unicode-input',
  'editability',
  'required-state',
  'accessible-name',
  'validation-state',
  'error-recovery',
  'click-behavior',
  'navigation',
  'form-submit',
  'api-smoke',
  'api-auth',
  'browser-execution',
  'viewport-matrix',
  'accessibility-scan',
  'visual-regression',
  'ui-api-correlation',
  'performance-profile',
  'security-baseline',
  'seo-baseline',
  'content-baseline',
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export type ScenarioDisposition =
  | 'executable'
  | 'blocked-safety'
  | 'requires-configuration'
  | 'not-implemented';

export interface AssignedScenario {
  id: ScenarioId;
  disposition: ScenarioDisposition;
  reason: string;
  tested: boolean;
  evidenceIds: string[];
}

export const COVERAGE_STATUSES = [
  'TESTED',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
  'NOT APPLICABLE',
  'UNTESTABLE',
  'UNCOVERED',
] as const;

export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

/** Interactive UI kinds — first-class Field/Button/Link/Form stay separate; this is the UI rollup. */
export const UI_ELEMENT_KINDS = [
  'field',
  'button',
  'link',
  'form',
  'dropdown',
  'checkbox',
  'radio',
  'toggle',
  'table',
  'ui-component',
  'navigation',
] as const satisfies readonly InventoryKind[];

/**
 * Contract dimensions (Part 17): Page, Route, UI, Field, Button, Link, Form,
 * Workflow, API, Browser, Responsive, Accessibility, Visual.
 */
export const REQUIRED_COVERAGE_DIMENSIONS = [
  { id: 'page', label: 'Page coverage', kinds: ['page'] as const },
  { id: 'route', label: 'Route coverage', kinds: ['route'] as const },
  { id: 'ui', label: 'UI coverage', kinds: UI_ELEMENT_KINDS },
  { id: 'field', label: 'Field coverage', kinds: ['field'] as const },
  { id: 'button', label: 'Button coverage', kinds: ['button'] as const },
  { id: 'link', label: 'Link coverage', kinds: ['link'] as const },
  { id: 'form', label: 'Form coverage', kinds: ['form'] as const },
  { id: 'workflow', label: 'Workflow coverage', kinds: ['workflow'] as const },
  { id: 'api', label: 'API coverage', kinds: ['api'] as const },
  { id: 'browser', label: 'Browser coverage', kinds: ['browser'] as const },
  { id: 'responsive', label: 'Responsive coverage', kinds: ['viewport'] as const },
  { id: 'accessibility', label: 'Accessibility coverage', kinds: ['accessibility'] as const },
  { id: 'visual', label: 'Visual coverage', kinds: ['visual'] as const },
] as const;

/** Extra discovered types — kept for inventory honesty, not a substitute for the 13. */
export const EXTRA_COVERAGE_DIMENSIONS = [
  { id: 'dropdown', label: 'Dropdown coverage', kinds: ['dropdown'] as const },
  { id: 'checkbox', label: 'Checkbox coverage', kinds: ['checkbox'] as const },
  { id: 'radio', label: 'Radio coverage', kinds: ['radio'] as const },
  { id: 'toggle', label: 'Toggle coverage', kinds: ['toggle'] as const },
  { id: 'table', label: 'Table coverage', kinds: ['table'] as const },
  { id: 'viewport', label: 'Viewport coverage', kinds: ['viewport'] as const },
] as const;

export const ADVANCED_DIMENSIONS = [...REQUIRED_COVERAGE_DIMENSIONS, ...EXTRA_COVERAGE_DIMENSIONS] as const;

export type AdvancedDimensionId = (typeof ADVANCED_DIMENSIONS)[number]['id'];

export const REQUIRED_COVERAGE_DIMENSION_IDS: readonly AdvancedDimensionId[] =
  REQUIRED_COVERAGE_DIMENSIONS.map((row) => row.id);

export type RequiredCoverageDimensionId = (typeof REQUIRED_COVERAGE_DIMENSIONS)[number]['id'];

export type CoverageHint = 'skipped' | 'not-applicable' | 'untestable';

export interface InventoryItem {
  id: string;
  kind: InventoryKind;
  name: string;
  page?: string;
  route?: string;
  locator?: string | null;
  elementType?: string;
  source: 'discovery' | 'config' | 'capability';
  applicableScenarios: AssignedScenario[];
  /** Explicit inventory hint — never used to drop the item from the report. */
  coverageHint?: CoverageHint;
  /** Discovery or suite status before mapping onto CoverageStatus. */
  projectStatus?: string;
}

export interface CoverageRecord {
  id: string;
  page: string;
  element: string;
  type: string;
  kind: InventoryKind;
  status: CoverageStatus;
  reason: string;
  recommendedTest: string;
}

export interface DimensionCoverage {
  id: AdvancedDimensionId;
  label: string;
  discovered: number;
  testable: number;
  covered: number;
  uncovered: number;
  coveragePercent: number;
  byStatus: Record<CoverageStatus, number>;
}

export interface ExecutionEvidence {
  id: string;
  source:
    | 'playwright'
    | 'postman'
    | 'planned-check'
    | 'visual'
    | 'responsive'
    | 'cross-browser'
    | 'accessibility'
    | 'workflow'
    | 'jmeter'
    | 'security'
    | 'seo'
    | 'content';
  title: string;
  file?: string;
  urlHints: string[];
  locatorHints: string[];
  browser?: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED' | 'UNKNOWN' | 'RECORDED';
  executed: boolean;
}

export interface KindCoverage {
  kind: InventoryKind;
  discovered: number;
  testable: number;
  tested: number;
  uncovered: number;
  executableScenarios: number;
  testedScenarios: number;
  itemCoveragePercent: number;
  scenarioCoveragePercent: number;
}

export interface CoverageTotals {
  discoveredItems: number;
  testableItems: number;
  /** Covered items (TESTED + FAILED). Not pass rate. */
  testedItems: number;
  /** Items with status TESTED only (executed and did not fail). */
  testedCount: number;
  /** Items with status FAILED (executed — still covered). */
  failedCount: number;
  /** Items with status BLOCKED (never treated as TESTED). */
  blockedCount: number;
  uncoveredItems: number;
  itemCoveragePercent: number;
  /**
   * Testable items plus BLOCKED items. Used only for scope coverage — the
   * original item-coverage denominator (testable-only) is unchanged.
   */
  scopeItems: number;
  /** Covered (TESTED + FAILED) ÷ (testable + BLOCKED). Not a quality gate. */
  scopeCoveragePercent: number;
  /**
   * True only when item coverage is 100%, BLOCKED is 0, UNCOVERED is 0, and
   * discovery is not a single-page login-only crawl. Sauce Demo cannot satisfy this.
   */
  complete: boolean;
  executableScenarios: number;
  testedScenarios: number;
  scenarioCoveragePercent: number;
  passedExecutions: number;
  failedExecutions: number;
  skippedExecutions: number;
  passRatePercent: number | null;
  byStatus: Record<CoverageStatus, number>;
}

export interface RiskArea {
  id: string;
  title: string;
  severity: 'high' | 'medium' | 'low';
  category: 'uncovered' | 'blocked' | 'failed';
  reason: string;
  itemIds: string[];
  itemCount: number;
}

export interface CoverageSummary {
  generatedAt: string;
  seedUrl: string | null;
  playwrightBaseUrl: string;
  formula: string;
  coverageIsNotPassRate: true;
  itemCoveragePercent: number;
  scopeCoveragePercent: number;
  testableItems: number;
  scopeItems: number;
  coveredItems: number;
  testedCount: number;
  failedCount: number;
  blockedCount: number;
  uncoveredCount: number;
  complete: boolean;
  passRatePercent: number | null;
  dimensions: DimensionCoverage[];
  riskAreas: RiskArea[];
}

export interface ExcludedInventoryItem {
  id: string;
  kind: InventoryKind;
  name: string;
  reason: string;
  coverageHint: CoverageHint | null;
}

export interface DimensionContribution {
  discovered: number;
  discoveredRaw: number;
  discoveredUnique: number;
  testable: number;
  covered: number;
  uncovered: number;
  excluded: Array<{ id: string; kind: InventoryKind; reason: string }>;
  coveragePercent: number;
}

export interface CoverageFigure {
  label: string;
  kinds: InventoryKind[];
  discovered: number;
  testable: number;
  covered: number;
  coveragePercent: number;
}

export interface CoverageFormula {
  testableItemDefinition: string;
  coverageDefinition: string;
  coverageIsNotPassRate: true;
  warning: string;
  denominatorAfterDedupe: true;
  howToRead: {
    numerator: string;
    denominator: string;
    passRate: string;
  };
  totals: {
    discoveredItems: number;
    testableItems: number;
    coveredItems: number;
    itemCoveragePercent: number;
    scopeItems: number;
    scopeCoveragePercent: number;
    passRatePercent: number | null;
  };
  scopeDefinition: string;
  figures: {
    elementCoverage: CoverageFigure;
    functionalAreaCoverage: CoverageFigure;
  };
  contributions: {
    pages: DimensionContribution;
    interactiveElements: DimensionContribution;
    endpoints: DimensionContribution;
    workflows: DimensionContribution;
  };
  excludedItems: ExcludedInventoryItem[];
}

export interface CoverageReport {
  generatedAt: string;
  seedUrl: string | null;
  playwrightBaseUrl: string;
  targetMismatch: boolean;
  notes: string[];
  totals: CoverageTotals;
  byKind: KindCoverage[];
  dimensions: DimensionCoverage[];
  formula: CoverageFormula;
  riskAreas: RiskArea[];
  records: CoverageRecord[];
  items: InventoryItem[];
  evidence: ExecutionEvidence[];
}
