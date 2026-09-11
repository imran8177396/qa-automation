export const INVENTORY_KINDS = [
  'page',
  'route',
  'form',
  'field',
  'button',
  'link',
  'navigation',
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

export const ADVANCED_DIMENSIONS = [
  { id: 'page', label: 'Page coverage', kinds: ['page'] },
  { id: 'route', label: 'Route coverage', kinds: ['route'] },
  { id: 'ui-element', label: 'UI element coverage', kinds: ['field', 'button', 'link', 'form', 'ui-component', 'navigation'] },
  { id: 'field', label: 'Field coverage', kinds: ['field'] },
  { id: 'button', label: 'Button coverage', kinds: ['button'] },
  { id: 'link', label: 'Link coverage', kinds: ['link'] },
  { id: 'form', label: 'Form coverage', kinds: ['form'] },
  { id: 'workflow', label: 'Workflow coverage', kinds: ['workflow'] },
  { id: 'api', label: 'API coverage', kinds: ['api'] },
  { id: 'browser', label: 'Browser coverage', kinds: ['browser'] },
  { id: 'responsive', label: 'Responsive coverage', kinds: ['viewport'] },
  { id: 'accessibility', label: 'Accessibility coverage', kinds: ['accessibility'] },
  { id: 'visual', label: 'Visual coverage', kinds: ['visual'] },
] as const;

export type AdvancedDimensionId = (typeof ADVANCED_DIMENSIONS)[number]['id'];

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
  testedItems: number;
  uncoveredItems: number;
  itemCoveragePercent: number;
  executableScenarios: number;
  testedScenarios: number;
  scenarioCoveragePercent: number;
  passedExecutions: number;
  failedExecutions: number;
  skippedExecutions: number;
  passRatePercent: number | null;
  byStatus: Record<CoverageStatus, number>;
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
    passRatePercent: number | null;
  };
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
  records: CoverageRecord[];
  items: InventoryItem[];
  evidence: ExecutionEvidence[];
}
