/**
 * Risk / change-impact selection via explicit mapping only.
 * Does not read git. Does not edit run-regression.ts execution. Does not invent scores.
 * Automatic inference (from file names, generative models, or dependency graphs) is not
 * the selection mechanism — only an explicit mapping table selects tests.
 */
export const RISK_PRIORITIZATION_STATUS = 'PARTIAL' as const;

export interface RiskMappingEntry {
  fileOrService: string;
  testIds: string[];
}

export interface PrioritizeInput {
  changedFiles?: string[];
  changedServices?: string[];
  mapping?: RiskMappingEntry[];
  allTestIds?: string[];
  /**
   * Legacy alias: when provided without changed files/services, treated as an
   * explicit selection (PARTIAL). Prefer mapping + changedFiles.
   */
  explicitSelection?: string[];
  /** @deprecated Prefer changedFiles. */
  changedPaths?: string[];
}

export interface PrioritizeResult {
  status: 'NOT_IMPLEMENTED' | 'PARTIAL';
  selected: string[];
  /** Alias kept for existing callers. */
  selectedTests: string[];
  reason: string;
  fallback?: 'full-regression';
}

/**
 * Change-impact selection:
 * - No changed files/services → NOT_IMPLEMENTED, selected [], reason names unimplemented analysis.
 * - Changed files present AND every file/service has a mapping → PARTIAL, mapped test ids only.
 * - Any changed file/service with no mapping → PARTIAL, fallback full-regression, selected = allTestIds.
 * Does not invent git diffs or scores. Does not mark every test as selected without mapping gaps.
 */
export function prioritize(input: PrioritizeInput = {}): PrioritizeResult {
  if (input.explicitSelection !== undefined) {
    const selected = [...input.explicitSelection];
    return {
      status: 'PARTIAL',
      selected,
      selectedTests: selected,
      reason: 'explicit selection only; no code-impact ranking',
    };
  }

  const changedFiles = [
    ...(input.changedFiles ?? []),
    ...(input.changedPaths ?? []),
  ];
  const changedServices = [...(input.changedServices ?? [])];
  const changed = [...changedFiles, ...changedServices];

  if (changed.length === 0) {
    return {
      status: 'NOT_IMPLEMENTED',
      selected: [],
      selectedTests: [],
      reason: 'change-impact analysis is not implemented',
    };
  }

  const mapping = input.mapping ?? [];
  const byKey = new Map(mapping.map((row) => [row.fileOrService, row.testIds]));
  const unmapped = changed.filter((key) => !byKey.has(key));

  if (unmapped.length > 0) {
    const selected = [...(input.allTestIds ?? [])];
    return {
      status: 'PARTIAL',
      selected,
      selectedTests: selected,
      fallback: 'full-regression',
      reason: 'mappings are incomplete; fall back to full regression',
    };
  }

  const selectedSet = new Set<string>();
  for (const key of changed) {
    for (const testId of byKey.get(key) ?? []) {
      selectedSet.add(testId);
    }
  }
  const selected = [...selectedSet];
  return {
    status: 'PARTIAL',
    selected,
    selectedTests: selected,
    reason: 'explicit mapping; no git diff was read',
  };
}

/** Repo-relative path prefix or exact file. Matched by prefix against changed files. */
export interface ChangeImpactMapping {
  path: string;
  module: string;
  service: string;
  feature: string;
  testIds: string[];
}

/**
 * Unified diff text OR a pre-parsed file list. Callers (including tests) pass a
 * string or string[]; this function does not call git.
 */
export interface ChangeImpactInput {
  gitDiff?: string;
  changedFiles?: string[];
  mapping?: ChangeImpactMapping[];
  allTestIds?: string[];
}

export interface ChangeImpactResult {
  status: 'PARTIAL' | 'NOT_IMPLEMENTED';
  changedFiles: string[];
  changedModules: string[];
  affectedServices: string[];
  affectedFeatures: string[];
  affectedTests: string[];
  unmappedFiles: string[];
  fallback: 'none' | 'full-regression';
  reason: string;
}

/** Future seam — not resolved by this module. */
export interface StaticDependencyGraph {
  from: string;
  to: string[];
}

/** Future seam — not resolved by this module. */
export interface RuntimeDependencyGraph {
  from: string;
  to: string[];
}

/** Same data ChangeImpactMapping already carries (service + path). */
export interface ServiceOwnership {
  service: string;
  paths: string[];
}

/** Same data ChangeImpactMapping already carries (feature + testIds). */
export interface TestFeatureMapping {
  feature: string;
  testIds: string[];
}

const DIFF_PLUS_PLUS_PLUS = /^\+\+\+ b\/(.+)$/gm;
const DIFF_GIT_HEADER = /^diff --git a\/.+ b\/(.+)$/gm;

function parseChangedFilesFromDiff(gitDiff: string): string[] {
  const files = new Set<string>();
  for (const re of [DIFF_PLUS_PLUS_PLUS, DIFF_GIT_HEADER]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(gitDiff)) !== null) {
      const file = match[1]?.trim();
      if (file && file !== '/dev/null') {
        files.add(file);
      }
    }
  }
  return [...files];
}

function resolveChangedFiles(input: ChangeImpactInput): string[] | null {
  if (input.changedFiles !== undefined) {
    return [...input.changedFiles];
  }
  if (input.gitDiff !== undefined) {
    return parseChangedFilesFromDiff(input.gitDiff);
  }
  return null;
}

function distinctPreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function matchingRows(
  changedFiles: string[],
  mapping: ChangeImpactMapping[],
): { matched: ChangeImpactMapping[]; unmappedFiles: string[] } {
  const matched: ChangeImpactMapping[] = [];
  const matchedKeys = new Set<ChangeImpactMapping>();
  const unmappedFiles: string[] = [];

  for (const file of changedFiles) {
    const rows = mapping.filter((row) => file.startsWith(row.path));
    if (rows.length === 0) {
      unmappedFiles.push(file);
      continue;
    }
    for (const row of rows) {
      if (!matchedKeys.has(row)) {
        matchedKeys.add(row);
        matched.push(row);
      }
    }
  }
  return { matched, unmappedFiles };
}

/**
 * Explicit mapping-table change-impact pipeline.
 * Does not execute git. Does not invent diffs. Does not infer tests from file names alone.
 */
export function analyzeChangeImpact(input: ChangeImpactInput = {}): ChangeImpactResult {
  const resolved = resolveChangedFiles(input);
  if (resolved === null) {
    return {
      status: 'NOT_IMPLEMENTED',
      changedFiles: [],
      changedModules: [],
      affectedServices: [],
      affectedFeatures: [],
      affectedTests: [],
      unmappedFiles: [],
      fallback: 'none',
      reason: 'change-impact analysis is not implemented',
    };
  }

  const changedFiles = distinctPreserveOrder(resolved);
  const mapping = input.mapping ?? [];
  const { matched, unmappedFiles } = matchingRows(changedFiles, mapping);

  const changedModules = distinctPreserveOrder(matched.map((row) => row.module));
  const affectedServices = distinctPreserveOrder(matched.map((row) => row.service));
  const affectedFeatures = distinctPreserveOrder(matched.map((row) => row.feature));
  const mappedTests = distinctPreserveOrder(matched.flatMap((row) => row.testIds));

  if (unmappedFiles.length > 0) {
    if (input.allTestIds !== undefined) {
      return {
        status: 'PARTIAL',
        changedFiles,
        changedModules,
        affectedServices,
        affectedFeatures,
        affectedTests: [...input.allTestIds],
        unmappedFiles,
        fallback: 'full-regression',
        reason:
          'mappings are incomplete; selection fell back to full regression',
      };
    }
    return {
      status: 'PARTIAL',
      changedFiles,
      changedModules,
      affectedServices,
      affectedFeatures,
      affectedTests: mappedTests,
      unmappedFiles,
      fallback: 'full-regression',
      reason:
        'mappings are incomplete; full test list was not provided so only mapped tests are listed and fallback is required',
    };
  }

  return {
    status: 'PARTIAL',
    changedFiles,
    changedModules,
    affectedServices,
    affectedFeatures,
    affectedTests: mappedTests,
    unmappedFiles: [],
    fallback: 'none',
    reason: 'explicit mapping; git diff was not executed by this function',
  };
}

/** Project mapping rows into ownership / feature views — no second store. */
export function mappingToOwnership(mapping: ChangeImpactMapping[]): {
  ownership: ServiceOwnership[];
  features: TestFeatureMapping[];
} {
  const ownershipByService = new Map<string, Set<string>>();
  const featuresByName = new Map<string, Set<string>>();

  for (const row of mapping) {
    let paths = ownershipByService.get(row.service);
    if (!paths) {
      paths = new Set();
      ownershipByService.set(row.service, paths);
    }
    paths.add(row.path);

    let testIds = featuresByName.get(row.feature);
    if (!testIds) {
      testIds = new Set();
      featuresByName.set(row.feature, testIds);
    }
    for (const id of row.testIds) {
      testIds.add(id);
    }
  }

  return {
    ownership: [...ownershipByService.entries()].map(([service, paths]) => ({
      service,
      paths: [...paths],
    })),
    features: [...featuresByName.entries()].map(([feature, testIds]) => ({
      feature,
      testIds: [...testIds],
    })),
  };
}

export function resolveStaticDependencyGraph(): {
  status: 'NOT_IMPLEMENTED';
  reason: string;
} {
  return {
    status: 'NOT_IMPLEMENTED',
    reason: 'static dependency graph is not implemented',
  };
}

export function resolveRuntimeDependencyGraph(): {
  status: 'NOT_IMPLEMENTED';
  reason: string;
} {
  return {
    status: 'NOT_IMPLEMENTED',
    reason: 'runtime dependency graph is not implemented',
  };
}

// ---------------------------------------------------------------------------
// Risk-based test priority (selection + transparent dimensions — no quality score)
// ---------------------------------------------------------------------------

export const TEST_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type TestPriority = (typeof TEST_PRIORITIES)[number];

export const RISK_SELECTION_PROFILES = ['critical', 'critical-high', 'full'] as const;
export type RiskSelectionProfile = (typeof RISK_SELECTION_PROFILES)[number];

export interface PrioritizedTest {
  testId: string;
  priority: TestPriority;
  /** Caller-supplied number only — never invented, never folded into a quality score. */
  riskScore?: number;
  /** Flag only; does not boost or change priority by itself. */
  businessCritical?: boolean;
}

export interface RiskSelectionResult {
  profile: RiskSelectionProfile;
  selected: PrioritizedTest[];
  /** Not selected by the profile — were NOT executed; must not be marked FAIL. */
  skipped: PrioritizedTest[];
  /** testIds where businessCritical === true (input order). No hidden priority boost. */
  businessCritical: string[];
}

export interface PriorityExecutionRow {
  testId: string;
  priority: TestPriority;
  status: string;
  reason?: string;
  /** false when omitted by the risk profile (NOT_TESTED). */
  executed: boolean;
}

export interface PriorityExecutionResult {
  profile: RiskSelectionProfile;
  selected: PrioritizedTest[];
  skipped: PrioritizedTest[];
  businessCritical: string[];
  results: PriorityExecutionRow[];
}

/**
 * Transparent counts only — never a qualityScore / grade / health / weighted index.
 * coveragePct / performanceRegressions / securityFindings stay null unless extras supply them.
 */
export interface QualityDimensions {
  testsExecuted: number;
  testsPassed: number;
  testsFailed: number;
  criticalFailures: number;
  coveragePct: number | null;
  performanceRegressions: number | null;
  securityFindings: number | null;
}

export interface DimensionResultRow {
  testId: string;
  priority: TestPriority;
  status: string;
}

export interface DimensionExtras {
  coveragePct?: number;
  performanceRegressions?: number;
  securityFindings?: number;
}

const PRIORITY_SET = new Set<string>(TEST_PRIORITIES);
const PROFILE_SET = new Set<string>(RISK_SELECTION_PROFILES);

const PROFILE_ALLOWED: Record<RiskSelectionProfile, ReadonlySet<TestPriority>> = {
  critical: new Set<TestPriority>(['critical']),
  'critical-high': new Set<TestPriority>(['critical', 'high']),
  full: new Set<TestPriority>(['critical', 'high', 'medium', 'low']),
};

function assertValidPriority(priority: string, testId: string): asserts priority is TestPriority {
  if (!PRIORITY_SET.has(priority)) {
    throw new Error(
      `Unknown test priority ${JSON.stringify(priority)} for ${testId}; ` +
        `allowed: ${TEST_PRIORITIES.join(', ')}. Do not coerce unknown priorities to low.`,
    );
  }
}

function assertValidProfile(profile: string): asserts profile is RiskSelectionProfile {
  if (!PROFILE_SET.has(profile)) {
    throw new Error(
      `Unknown risk selection profile ${JSON.stringify(profile)}; ` +
        `allowed: ${RISK_SELECTION_PROFILES.join(', ')}`,
    );
  }
}

/**
 * Select tests by risk profile. Preserves input order (stable). Does not reorder by riskScore.
 * businessCritical: true does not change selection — those ids are listed separately.
 * Unknown priority strings throw (never coerced to low).
 */
export function selectByPriority(
  tests: PrioritizedTest[],
  profile: RiskSelectionProfile,
): RiskSelectionResult {
  assertValidProfile(profile);
  const allowed = PROFILE_ALLOWED[profile];
  const selected: PrioritizedTest[] = [];
  const skipped: PrioritizedTest[] = [];
  const businessCritical: string[] = [];

  for (const test of tests) {
    assertValidPriority(test.priority, test.testId);
    if (test.businessCritical === true) {
      businessCritical.push(test.testId);
    }
    if (allowed.has(test.priority)) {
      selected.push(test);
    } else {
      skipped.push(test);
    }
  }

  return { profile, selected, skipped, businessCritical };
}

/**
 * Run only tests selected by the risk profile.
 * Skipped tests are recorded as NOT_TESTED with reason — never FAIL, never PASS.
 * Selected statuses are whatever runOne returns (FAIL stays FAIL).
 * Not wired into run-all.ts.
 */
export async function executeByPriority(
  tests: PrioritizedTest[],
  profile: RiskSelectionProfile,
  runOne: (test: PrioritizedTest) => Promise<{ status: string }>,
): Promise<PriorityExecutionResult> {
  const selection = selectByPriority(tests, profile);
  const selectedIds = new Set(selection.selected.map((t) => t.testId));
  const results: PriorityExecutionRow[] = [];

  for (const test of tests) {
    if (!selectedIds.has(test.testId)) {
      results.push({
        testId: test.testId,
        priority: test.priority,
        status: 'NOT_TESTED',
        reason: `not selected by risk profile ${profile}`,
        executed: false,
      });
      continue;
    }
    const outcome = await runOne(test);
    results.push({
      testId: test.testId,
      priority: test.priority,
      status: outcome.status,
      executed: true,
    });
  }

  return {
    profile: selection.profile,
    selected: selection.selected,
    skipped: selection.skipped,
    businessCritical: selection.businessCritical,
    results,
  };
}

/**
 * Transparent dimension counts. Does not compute a quality score or block a release.
 * evaluateReleaseGate remains separate and only blocks when blockRelease is true.
 */
export function summarizeDimensions(
  results: DimensionResultRow[],
  extras?: DimensionExtras,
): QualityDimensions {
  let testsExecuted = 0;
  let testsPassed = 0;
  let testsFailed = 0;
  let criticalFailures = 0;

  for (const row of results) {
    assertValidPriority(row.priority, row.testId);
    if (row.status === 'NOT_TESTED') {
      continue;
    }
    testsExecuted += 1;
    if (row.status === 'PASS') {
      testsPassed += 1;
    } else if (row.status === 'FAIL') {
      testsFailed += 1;
      if (row.priority === 'critical') {
        criticalFailures += 1;
      }
    }
  }

  return {
    testsExecuted,
    testsPassed,
    testsFailed,
    criticalFailures,
    coveragePct: extras?.coveragePct !== undefined ? extras.coveragePct : null,
    performanceRegressions:
      extras?.performanceRegressions !== undefined ? extras.performanceRegressions : null,
    securityFindings: extras?.securityFindings !== undefined ? extras.securityFindings : null,
  };
}
