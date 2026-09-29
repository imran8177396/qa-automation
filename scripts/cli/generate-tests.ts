/**
 * Generate-tests plan resolution for `npm run qa -- --generate-tests ...`.
 * Pure planning + in-memory filtering — does not spawn browsers, crawl, or read the network.
 * Does not replace --mode or run qa:all.
 */
import {
  parseChangedFilesFromDiff,
} from '../core/platform/risk';
import type { GenerationInventory } from '../discovery/generation-contract';
import {
  selectCasesForChange,
  toChangeAwareMappings,
  type ChangeAwareGenerationMapping,
  type ChangeAwareGenerationStatus,
} from '../planning/change-aware-generation';
import { runGenerationPipeline } from '../planning/generation-pipeline';
import type { OverrideDocument } from '../planning/human-overrides';
import type { PersistedTestCase } from '../planning/test-case-identity';
import type { UniqueTestCase } from '../planning/test-case-uniqueness';
import {
  hasArgFlag,
  parseArgValue,
  type ExecutionModeStatus,
} from './execution-mode';

/** Categories accepted by `--category=` for generate-tests (not registry categories). */
const GENERATE_TEST_CATEGORIES = ['negative', 'edge'] as const;

export type GenerateTestCategory = (typeof GENERATE_TEST_CATEGORIES)[number];

/** Plan status includes change-aware generation outcomes (UPDATED / UNMAPPED). */
export type GenerateTestsStatus =
  | ExecutionModeStatus
  | ChangeAwareGenerationStatus;

export interface GenerateTestsFilter {
  /** When set, keep cases whose screenId equals this id. */
  screenId: string | null;
  /** When set, keep negative or edge (incl. boundary alias). */
  category: GenerateTestCategory | null;
  /** When true, keep only priority === critical (never upgrades unspecified). */
  critical: boolean;
  /** When true, no screen/category/critical filter. */
  full: boolean;
  /** When true, change-impact path (honest NOT_IMPLEMENTED unless mapped). */
  changed: boolean;
}

export interface GenerateTestsPlan {
  generateTests: boolean;
  /** Always false — generation never spawns suite runners. */
  spawn: boolean;
  status: GenerateTestsStatus;
  reason: string;
  notes: string[];
  filter: GenerateTestsFilter;
  kept: UniqueTestCase[];
  /** Screen ids present on the supplied inventory (empty when inventory missing). */
  screenIdsInInventory: string[];
  /** Present when previousIdentities was supplied and reconcile ran. */
  persistedIdentities?: PersistedTestCase[];
  /** Present when previousIdentities was supplied and reconcile ran. */
  deprecatedIdentities?: PersistedTestCase[];
  /** Change-aware: cases selected for regeneration (item 39). */
  regenerated?: UniqueTestCase[];
  /** Change-aware: unaffected cases kept as-is (item 39). */
  preserved?: UniqueTestCase[];
  /** Change-aware: files with no usable pathPrefix mapping (item 39). */
  unmappedFiles?: string[];
}

export interface ResolveGenerateTestsOptions {
  /**
   * Injected generation inventory. Pass `null` when the discovery file is absent.
   * The pure resolver never reads PATHS.generationInventoryFile or last-target files.
   */
  inventory?: GenerationInventory | null;
  /**
   * Injected regression-shaped mapping rows (`path` / optional generation fields).
   * Converted via toChangeAwareMappings when changeAwareMappings is omitted.
   */
  changeImpactMappings?: Array<{
    path?: string;
    pathPrefix?: string;
    screenIds?: string[];
    elementIds?: string[];
    testCaseIds?: string[];
  }>;
  /**
   * Generation-specific pathPrefix → screen/element/testCase mappings.
   * When omitted, derived from changeImpactMappings via toChangeAwareMappings
   * (path → pathPrefix; regression testIds are not treated as testCaseIds).
   */
  changeAwareMappings?: ChangeAwareGenerationMapping[];
  /** Injected gitDiff text (from --diff-file content) without spawning git. */
  gitDiff?: string;
  /**
   * Injected human overrides (from qa.generated-overrides.json when present).
   * Pure resolver never reads the file — callers load and pass the document.
   */
  overrides?: OverrideDocument | null;
  /**
   * Previous identity registry. When provided (including null), pipeline reconciles
   * and returns persistedIdentities for the caller to save. Undefined = skip.
   */
  previousIdentities?: PersistedTestCase[] | null;
  /** Optional project id stamped onto identity keys. */
  projectId?: string;
  /** Fixed ISO now for identity firstSeen/lastSeen (tests). */
  identityNow?: string;
}

function generateTestsUsage(): string {
  return [
    'Usage: npm run qa -- --generate-tests [filters]',
    '',
    'Flags:',
    '  --generate-tests              Generate unique cases from discovery inventory (not qa:all)',
    '  --screen=<id>                 Keep cases for one screen id (equals form required)',
    '  --category=negative|edge      Keep cases by category / scenarioKind',
    '  --critical                    Keep cases with priority critical only',
    '  --changed                     Change-aware generation (--files=a,b and/or --diff-file=<path>)',
    '  --files=a,b                   Changed paths for --changed (no git spawn)',
    '  --diff-file=<path>            Unified diff text for --changed; caller supplies git diff output',
    '  --full                        No screen/category/critical filter (same as bare --generate-tests)',
    '',
    'Cannot be combined with --mode. Does not crawl; requires discovery/generation-inventory.json.',
    'Does not spawn git — pass --files or --diff-file with git diff output from the caller.',
  ].join('\n');
}

function emptyFilter(overrides: Partial<GenerateTestsFilter> = {}): GenerateTestsFilter {
  return {
    screenId: null,
    category: null,
    critical: false,
    full: false,
    changed: false,
    ...overrides,
  };
}

function planResult(
  partial: Omit<GenerateTestsPlan, 'generateTests' | 'spawn'> & {
    spawn?: boolean;
  }
): GenerateTestsPlan {
  return {
    generateTests: true,
    spawn: partial.spawn ?? false,
    status: partial.status,
    reason: partial.reason,
    notes: partial.notes,
    filter: partial.filter,
    kept: partial.kept,
    screenIdsInInventory: partial.screenIdsInInventory,
    ...(partial.persistedIdentities !== undefined
      ? { persistedIdentities: partial.persistedIdentities }
      : {}),
    ...(partial.deprecatedIdentities !== undefined
      ? { deprecatedIdentities: partial.deprecatedIdentities }
      : {}),
    ...(partial.regenerated !== undefined ? { regenerated: partial.regenerated } : {}),
    ...(partial.preserved !== undefined ? { preserved: partial.preserved } : {}),
    ...(partial.unmappedFiles !== undefined
      ? { unmappedFiles: partial.unmappedFiles }
      : {}),
  };
}

function inventoryScreenIds(inventory: GenerationInventory): string[] {
  return inventory.screens.map((s) => s.screenId).filter(Boolean);
}

function resolveChangeAwareMappings(
  options: ResolveGenerateTestsOptions
): ChangeAwareGenerationMapping[] {
  if (options.changeAwareMappings !== undefined) {
    return options.changeAwareMappings;
  }
  if (options.changeImpactMappings !== undefined) {
    return toChangeAwareMappings(options.changeImpactMappings);
  }
  return [];
}

/**
 * Match UniqueTestCase.category or PlannedCheck.scenarioKind.
 * `edge` also matches inventory category `boundary` (scenarioKind edge alias).
 */
function uniqueCaseMatchesCategory(
  c: UniqueTestCase,
  category: GenerateTestCategory,
  scenarioKind?: string | null
): boolean {
  const cat = (c.category ?? '').toLowerCase();
  const kind = (scenarioKind ?? '').toLowerCase();
  const scenario = (c.scenario ?? '').toLowerCase();
  const wanted = category.toLowerCase();

  if (wanted === 'edge') {
    return (
      cat === 'edge' ||
      cat === 'boundary' ||
      kind === 'edge' ||
      scenario === 'edge'
    );
  }

  return cat === wanted || kind === wanted || scenario === wanted;
}

function applyFilters(
  cases: UniqueTestCase[],
  filter: GenerateTestsFilter,
  scenarioKindById: Map<string, string | undefined>
): UniqueTestCase[] {
  let kept = cases;

  if (filter.screenId) {
    const screenId = filter.screenId;
    kept = kept.filter((c) => c.screenId === screenId);
  }

  if (filter.category) {
    const category = filter.category;
    kept = kept.filter((c) =>
      uniqueCaseMatchesCategory(c, category, scenarioKindById.get(c.testCaseId))
    );
  }

  if (filter.critical) {
    // Use priority already assigned on UniqueTestCase — never upgrade unspecified.
    kept = kept.filter((c) => c.priority === 'critical');
  }

  return kept;
}

function describeFilter(filter: GenerateTestsFilter): string {
  if (filter.changed) return 'changed';
  if (filter.full) return 'full';
  const parts: string[] = [];
  if (filter.screenId) parts.push(`screen=${filter.screenId}`);
  if (filter.category) parts.push(`category=${filter.category}`);
  if (filter.critical) parts.push('critical');
  return parts.length > 0 ? parts.join(',') : 'full';
}

/**
 * Exit code for generate-tests: 0 only when inventory existed and the filter was valid
 * (including zero kept cases for a real screen with no matching category).
 * Change-aware: exit 0 for UPDATED; exit 1 for NOT_IMPLEMENTED / UNMAPPED.
 */
export function generateTestsExitCode(plan: GenerateTestsPlan): number {
  if (!plan.generateTests) return 1;
  if (plan.status === 'REQUIRES_CONFIGURATION') return 1;
  if (plan.status === 'NOT_IMPLEMENTED') return 1;
  if (plan.status === 'UNMAPPED') return 1;
  if (plan.status === 'NOT_TESTED') return 1;
  if (plan.status === 'BLOCKED') return 1;
  if (plan.status === 'FAIL') return 1;
  // UPDATED and PARTIAL → 0
  return 0;
}

/** One-line stdout summary — never claims PASS or executed. */
export function formatGenerateTestsSummary(plan: GenerateTestsPlan): string {
  if (plan.filter.changed) {
    const regen = plan.regenerated?.length ?? 0;
    const preserved = plan.preserved?.length ?? 0;
    return `${regen} regenerated, ${preserved} preserved; filter=changed; status=${plan.status}; tests not executed`;
  }
  return `${plan.kept.length} case(s) kept; filter=${describeFilter(plan.filter)}; tests not executed`;
}

function resolveChangedFilesForGeneration(
  cleaned: string[],
  options: ResolveGenerateTestsOptions
): string[] | null {
  const filesArg = parseArgValue(cleaned, 'files');
  const fromFiles =
    filesArg !== undefined
      ? filesArg
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      : undefined;
  const gitDiff = options.gitDiff;

  if (fromFiles === undefined && gitDiff === undefined) {
    return null;
  }

  if (fromFiles !== undefined) {
    return fromFiles;
  }

  // Prefer the shared parser used by analyzeChangeImpact (no divergent copy).
  return parseChangedFilesFromDiff(gitDiff ?? '');
}

const NO_CHANGED_FILES_REASON =
  'no changed files were supplied; inventory was not regenerated';
const MISSING_INVENTORY_REASON =
  'discovery inventory is missing; generation does not crawl';
const TESTS_NOT_EXECUTED_NOTE = 'tests not executed';

function resolveChangedPlan(
  cleaned: string[],
  options: ResolveGenerateTestsOptions
): GenerateTestsPlan {
  const changedFilter = emptyFilter({ changed: true });
  const changedFiles = resolveChangedFilesForGeneration(cleaned, options);
  const mappings = resolveChangeAwareMappings(options);

  if (changedFiles === null) {
    return planResult({
      status: 'NOT_IMPLEMENTED',
      reason: NO_CHANGED_FILES_REASON,
      notes: [
        'no --files / --diff-file (or empty input) — not generating and not running the suite',
        TESTS_NOT_EXECUTED_NOTE,
      ],
      filter: changedFilter,
      kept: [],
      regenerated: [],
      preserved: [],
      unmappedFiles: [],
      screenIdsInInventory: [],
    });
  }

  // Probe without cases first — UNMAPPED / NOT_IMPLEMENTED must not require inventory.
  const probe = selectCasesForChange({
    changedFiles,
    mappings,
    cases: [],
  });

  if (probe.status === 'NOT_IMPLEMENTED') {
    return planResult({
      status: 'NOT_IMPLEMENTED',
      reason: probe.reason,
      notes: [
        NO_CHANGED_FILES_REASON,
        TESTS_NOT_EXECUTED_NOTE,
      ],
      filter: changedFilter,
      kept: [],
      regenerated: [],
      preserved: [],
      unmappedFiles: probe.unmappedFiles,
      screenIdsInInventory: [],
    });
  }

  if (probe.status === 'UNMAPPED') {
    return planResult({
      status: 'UNMAPPED',
      reason: probe.reason,
      notes: [
        probe.reason,
        `unmappedFiles=${probe.unmappedFiles.join(', ') || '(none)'}`,
        'refusing to regenerate the full inventory',
        TESTS_NOT_EXECUTED_NOTE,
      ],
      filter: changedFilter,
      kept: [],
      regenerated: [],
      preserved: [],
      unmappedFiles: probe.unmappedFiles,
      screenIdsInInventory: [],
    });
  }

  // UPDATED — generate from inventory as today, then split regenerate vs preserved.
  const inventory = options.inventory;
  if (inventory == null) {
    return planResult({
      status: 'REQUIRES_CONFIGURATION',
      reason: MISSING_INVENTORY_REASON,
      notes: [
        'REQUIRES_CONFIGURATION: provide discovery/generation-inventory.json from a prior discover run',
        TESTS_NOT_EXECUTED_NOTE,
      ],
      filter: changedFilter,
      kept: [],
      regenerated: [],
      preserved: [],
      unmappedFiles: [],
      screenIdsInInventory: [],
    });
  }

  const screenIdsInInventory = inventoryScreenIds(inventory);
  const pipeline = runGenerationPipeline({
    inventory,
    ...(options.overrides !== undefined ? { overrides: options.overrides } : {}),
    ...(options.previousIdentities !== undefined
      ? { previousIdentities: options.previousIdentities }
      : {}),
    ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    ...(options.identityNow !== undefined ? { identityNow: options.identityNow } : {}),
  });

  const selection = selectCasesForChange({
    changedFiles,
    mappings,
    cases: pipeline.uniqueCases,
  });

  // Selection should still be UPDATED (probe already verified mappings).
  if (selection.status !== 'UPDATED') {
    return planResult({
      status: selection.status,
      reason: selection.reason,
      notes: [
        selection.reason,
        'tests not executed',
      ],
      filter: changedFilter,
      kept: [],
      regenerated: selection.regenerate,
      preserved: selection.preserved,
      unmappedFiles: selection.unmappedFiles,
      screenIdsInInventory,
      ...(pipeline.persistedIdentities !== undefined
        ? { persistedIdentities: pipeline.persistedIdentities }
        : {}),
      ...(pipeline.deprecatedIdentities !== undefined
        ? { deprecatedIdentities: pipeline.deprecatedIdentities }
        : {}),
    });
  }

  // Emit both lists; kept = regenerated + preserved (unaffected identities stay in registry).
  const kept = [...selection.regenerate, ...selection.preserved];
  const notes = [
    selection.reason,
    `regenerated ${selection.regenerate.length}; preserved ${selection.preserved.length}`,
    'execution stage stays NOT_EXECUTED; tests not executed',
    'does not spawn git; does not run qa:all',
  ];
  if (pipeline.persistedIdentities !== undefined) {
    notes.push(
      `identities: ${pipeline.persistedIdentities.filter((p) => p.lifecycle !== 'deprecated').length} active, ${pipeline.deprecatedIdentities?.length ?? 0} deprecated`
    );
  }

  return planResult({
    status: 'UPDATED',
    reason: selection.reason,
    notes,
    filter: changedFilter,
    kept,
    regenerated: selection.regenerate,
    preserved: selection.preserved,
    unmappedFiles: [],
    screenIdsInInventory,
    ...(pipeline.persistedIdentities !== undefined
      ? { persistedIdentities: pipeline.persistedIdentities }
      : {}),
    ...(pipeline.deprecatedIdentities !== undefined
      ? { deprecatedIdentities: pipeline.deprecatedIdentities }
      : {}),
  });
}

/**
 * Pure generate-tests resolver. Unit tests must call this with an in-memory inventory —
 * never spawn, never read last-target files, never crawl.
 */
export function resolveGenerateTestsPlan(
  argv: string[] = [],
  options: ResolveGenerateTestsOptions = {}
): GenerateTestsPlan {
  const cleaned = argv.filter((arg) => arg !== '--');

  if (!hasArgFlag(cleaned, 'generate-tests')) {
    return planResult({
      status: 'REQUIRES_CONFIGURATION',
      reason: 'missing --generate-tests',
      notes: [generateTestsUsage()],
      filter: emptyFilter(),
      kept: [],
      screenIdsInInventory: [],
    });
  }

  if (hasArgFlag(cleaned, 'mode')) {
    return planResult({
      status: 'BLOCKED',
      reason: 'generate-tests and --mode cannot be combined',
      notes: [generateTestsUsage()],
      filter: emptyFilter(),
      kept: [],
      screenIdsInInventory: [],
    });
  }

  const screenId = parseArgValue(cleaned, 'screen')?.trim() || null;
  const categoryRaw = parseArgValue(cleaned, 'category')?.trim() || null;
  const critical = hasArgFlag(cleaned, 'critical');
  const fullFlag = hasArgFlag(cleaned, 'full');
  const changed = hasArgFlag(cleaned, 'changed');

  // --changed: selectCasesForChange; do not spawn git; do not run the suite.
  // analyzeChangeImpact full-regression fallback is intentionally not used here.
  if (changed) {
    return resolveChangedPlan(cleaned, options);
  }

  const inventory = options.inventory;
  if (inventory == null) {
    return planResult({
      status: 'REQUIRES_CONFIGURATION',
      reason: MISSING_INVENTORY_REASON,
      notes: [
        'REQUIRES_CONFIGURATION: provide discovery/generation-inventory.json from a prior discover run',
        TESTS_NOT_EXECUTED_NOTE,
      ],
      filter: emptyFilter({
        screenId,
        category: null,
        critical,
        full: fullFlag || (!screenId && !categoryRaw && !critical),
      }),
      kept: [],
      screenIdsInInventory: [],
    });
  }

  const screenIdsInInventory = inventoryScreenIds(inventory);

  if (categoryRaw !== null) {
    if (!(GENERATE_TEST_CATEGORIES as readonly string[]).includes(categoryRaw)) {
      return planResult({
        status: 'BLOCKED',
        reason: `unknown category ${JSON.stringify(categoryRaw)}; allowed: ${GENERATE_TEST_CATEGORIES.join(', ')}`,
        notes: ['tests not executed'],
        filter: emptyFilter({
          screenId,
          critical,
          full: false,
        }),
        kept: [],
        screenIdsInInventory,
      });
    }
  }

  const category = categoryRaw as GenerateTestCategory | null;
  const selective = Boolean(screenId || category || critical);
  const full = fullFlag || !selective;

  const filter = emptyFilter({
    screenId: full ? null : screenId,
    category: full ? null : category,
    critical: full ? false : critical,
    full,
  });

  if (!full && screenId && !screenIdsInInventory.includes(screenId)) {
    return planResult({
      status: 'NOT_TESTED',
      reason: 'screen was not in the discovery inventory',
      notes: [
        `requested screenId=${screenId}`,
        `inventory screens: ${screenIdsInInventory.join(', ') || '(none)'}`,
        'tests not executed',
      ],
      filter: emptyFilter({ screenId, category, critical, full: false }),
      kept: [],
      screenIdsInInventory,
    });
  }

  const pipeline = runGenerationPipeline({
    inventory,
    ...(options.overrides !== undefined ? { overrides: options.overrides } : {}),
    ...(options.previousIdentities !== undefined
      ? { previousIdentities: options.previousIdentities }
      : {}),
    ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    ...(options.identityNow !== undefined ? { identityNow: options.identityNow } : {}),
  });
  const scenarioKindById = new Map<string, string | undefined>();
  for (const check of pipeline.checks) {
    if (typeof check.id === 'string' && check.id.length > 0) {
      scenarioKindById.set(check.id, check.scenarioKind);
    }
  }

  const kept = full
    ? pipeline.uniqueCases
    : applyFilters(pipeline.uniqueCases, filter, scenarioKindById);

  const notes = [
    `generated ${pipeline.uniqueCases.length} unique case(s) from inventory; kept ${kept.length}`,
    `filter=${describeFilter(filter)}`,
    'execution stage stays NOT_EXECUTED; tests not executed',
    'does not crawl; does not run qa:all',
  ];
  if (pipeline.persistedIdentities !== undefined) {
    notes.push(
      `identities: ${pipeline.persistedIdentities.filter((p) => p.lifecycle !== 'deprecated').length} active, ${pipeline.deprecatedIdentities?.length ?? 0} deprecated`
    );
  }

  return planResult({
    status: 'PARTIAL',
    reason: `generate-tests resolved (${describeFilter(filter)}); tests not executed`,
    notes,
    filter,
    kept,
    screenIdsInInventory,
    ...(pipeline.persistedIdentities !== undefined
      ? { persistedIdentities: pipeline.persistedIdentities }
      : {}),
    ...(pipeline.deprecatedIdentities !== undefined
      ? { deprecatedIdentities: pipeline.deprecatedIdentities }
      : {}),
  });
}
