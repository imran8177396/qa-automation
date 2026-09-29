/**
 * This pipeline consumes discovery output. It does not replace scripts/run-all.ts.
 * The pipeline does not start from a predefined test list.
 *
 * Ordered contract for Application → … → Coverage. Generators (behavior through
 * workflow) run once via generateFromInventory → buildScenarioInventory — not as
 * separate crawler/orchestrator calls. Does not write files, crawl, or spawn browsers.
 */

import {
  buildCompletenessReport,
  type CompletenessReport,
} from '../coverage/completeness-report';
import {
  buildScreenCoverageMatrix,
  type ScreenCoverageMatrixRow,
} from '../coverage/screen-coverage-matrix';
import type { GenerationInventory } from '../discovery/generation-contract';
import { resolveSafetyConfig } from '../core/safety-policy';
import {
  answerAnalystQuestions,
  type AnalystAnswer,
  type AnalystQuestionExtras,
} from './analyst-questions';
import { generateFromInventory } from './generate-ui-checks';
import {
  buildTestCaseTraces,
  type TestCaseTrace,
} from './traceability';
import {
  applyHumanOverrides,
  type OverrideDocument,
  type ApplyHumanOverridesResult,
} from './human-overrides';
import {
  reconcileTestCases,
  type PersistedTestCase,
} from './test-case-identity';
import {
  deduplicateTestCases,
  type DedupableTestCase,
  type UniqueTestCase,
} from './test-case-uniqueness';
import type { PlannedCheck } from './types';

/** Stage ids in the user-facing generation pipeline order (19 stages). */
export const GENERATION_PIPELINE_STAGES = [
  'application',
  'discovery',
  'screen-inventory',
  'element-inventory',
  'behavior-inference',
  'constraint-extraction',
  'applicability',
  'positive',
  'negative',
  'boundary',
  'security',
  'accessibility',
  'visual',
  'workflow',
  'deduplication',
  'prioritization',
  'test-case-registry',
  'execution',
  'coverage',
] as const;

export type GenerationPipelineStageId = (typeof GENERATION_PIPELINE_STAGES)[number];

export type GenerationPipelineStageStatus = 'COMPLETED' | 'NOT_EXECUTED' | 'EMPTY';

export interface GenerationPipelineStageResult {
  id: GenerationPipelineStageId;
  status: GenerationPipelineStageStatus;
  note?: string;
}

export interface GenerationPipelineExecutionResult {
  testCaseId: string;
  result: string;
}

export interface GenerationPipelineInput {
  inventory: GenerationInventory;
  projectId?: string;
  executionResults?: GenerationPipelineExecutionResult[];
  /** Human overrides applied after dedupe. Null/undefined = no overrides. */
  overrides?: OverrideDocument | null;
  /**
   * Previous identity registry. When provided (including null = empty history),
   * reconcile runs after overrides / before traces. Undefined = skip identity.
   */
  previousIdentities?: PersistedTestCase[] | null;
  /** ISO timestamp for firstSeen/lastSeen when reconciling (tests pass a fixed value). */
  identityNow?: string;
  /** Optional analyst extras (workflows, permissions, …) — never invented here. */
  analystExtras?: AnalystQuestionExtras;
}

export interface GenerationPipelineResult {
  stages: GenerationPipelineStageResult[];
  checks: PlannedCheck[];
  uniqueCases: UniqueTestCase[];
  traces: TestCaseTrace[];
  gaps: TestCaseTrace[];
  matrix: ScreenCoverageMatrixRow[];
  completeness: CompletenessReport;
  /** Analyst questions answered from inventory (+ extras); unanswered stay open. */
  analystAnswers: AnalystAnswer[];
  /** Present when overrides were supplied (including empty document). */
  humanOverrides?: Pick<ApplyHumanOverridesResult, 'excluded' | 'unmatched' | 'rejected'>;
  /** Present when previousIdentities was provided and reconcile ran. */
  persistedIdentities?: PersistedTestCase[];
  /** Present when previousIdentities was provided and reconcile ran. */
  deprecatedIdentities?: PersistedTestCase[];
}

const COMBINED_PLANNER_NOTE = 'executed inside generateFromInventory';

function requireInventory(inventory: unknown): GenerationInventory {
  if (inventory == null || typeof inventory !== 'object') {
    throw new Error('generation pipeline requires a discovery inventory');
  }
  return inventory as GenerationInventory;
}

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
    elementType: check.purpose,
    controlLabel:
      typeof check.expect?.accessibleName === 'string' ? check.expect.accessibleName : undefined,
  };
}

function resolveCheckCaseId(check: PlannedCheck): string {
  return typeof check.id === 'string' && check.id.trim().length > 0 ? check.id.trim() : 'unspecified';
}

function countByScenario(
  checks: PlannedCheck[],
  match: (c: PlannedCheck) => boolean
): number {
  return checks.filter(match).length;
}

function kindOrCategory(c: PlannedCheck, kind: string, category?: string): boolean {
  if (c.scenarioKind === kind) return true;
  if (category != null && c.category === category) return true;
  return false;
}

/**
 * Run the generation pipeline against a supplied GenerationInventory.
 * Does not crawl, write files, or execute browsers.
 * Generation still calls generateFromInventory only — analyst answers do not invent cases.
 */
export function runGenerationPipeline(input: GenerationPipelineInput): GenerationPipelineResult {
  const inventory = requireInventory(input?.inventory);

  if (!Array.isArray(inventory.screens)) {
    throw new Error('generation pipeline requires a discovery inventory');
  }

  const screens = inventory.screens;
  const elementCount = screens.reduce((n, s) => n + (s.elements?.length ?? 0), 0);

  // Analyst contract: derive questions from discovery inventory, not a predefined test catalog.
  const analystAnswers = answerAnalystQuestions(inventory, input.analystExtras);

  const stages: GenerationPipelineStageResult[] = [];

  stages.push({
    id: 'application',
    status: inventory.version === '1' ? 'COMPLETED' : 'EMPTY',
    note:
      inventory.version === '1'
        ? 'inventory.version is 1'
        : `inventory.version is ${String((inventory as { version?: unknown }).version)}`,
  });

  stages.push({
    id: 'discovery',
    status: 'COMPLETED',
    note: 'inventory supplied; crawl not repeated',
  });

  stages.push({
    id: 'screen-inventory',
    status: 'COMPLETED',
    note: `${screens.length} screen(s) read`,
  });

  stages.push({
    id: 'element-inventory',
    status: 'COMPLETED',
    note: `${elementCount} element(s) read`,
  });

  const safety = resolveSafetyConfig();
  // No discovered screens → empty checks (do not invent a login form or catalog cases).
  // Generation still goes through generateFromInventory only when inventory has screens.
  const checks =
    screens.length === 0 ? [] : generateFromInventory(inventory, safety);

  const positiveCount = countByScenario(checks, (c) => kindOrCategory(c, 'positive', 'positive'));
  const negativeCount = countByScenario(checks, (c) => kindOrCategory(c, 'negative', 'negative'));
  const boundaryCount = countByScenario(checks, (c) => kindOrCategory(c, 'edge', 'boundary'));
  const securityCount = countByScenario(
    checks,
    (c) => kindOrCategory(c, 'security', 'security') || c.scenarioKind === 'security-context'
  );
  const a11yCount = countByScenario(
    checks,
    (c) =>
      kindOrCategory(c, 'accessibility', 'accessibility') ||
      c.scenarioKind === 'usability-accessibility'
  );
  const visualCount = countByScenario(checks, (c) => kindOrCategory(c, 'visual', 'visual'));
  const workflowCount = countByScenario(checks, (c) => c.scenarioKind === 'workflow');

  for (const id of [
    'behavior-inference',
    'constraint-extraction',
    'applicability',
  ] as const) {
    stages.push({
      id,
      status: 'COMPLETED',
      note: COMBINED_PLANNER_NOTE,
    });
  }

  stages.push({
    id: 'positive',
    status: 'COMPLETED',
    note: `${COMBINED_PLANNER_NOTE}; ${positiveCount} positive check(s)`,
  });
  stages.push({
    id: 'negative',
    status: 'COMPLETED',
    note: `${COMBINED_PLANNER_NOTE}; ${negativeCount} negative check(s)`,
  });
  stages.push({
    id: 'boundary',
    status: 'COMPLETED',
    note: `${COMBINED_PLANNER_NOTE}; ${boundaryCount} boundary/edge check(s)`,
  });
  stages.push({
    id: 'security',
    status: 'COMPLETED',
    note: `${COMBINED_PLANNER_NOTE}; ${securityCount} security check(s)`,
  });
  stages.push({
    id: 'accessibility',
    status: 'COMPLETED',
    note: `${COMBINED_PLANNER_NOTE}; ${a11yCount} accessibility check(s)`,
  });
  stages.push({
    id: 'visual',
    status: 'COMPLETED',
    note: `${COMBINED_PLANNER_NOTE}; ${visualCount} visual check(s)`,
  });
  stages.push({
    id: 'workflow',
    status: 'COMPLETED',
    note: `${COMBINED_PLANNER_NOTE}; ${workflowCount} workflow check(s)`,
  });

  const dedupables = checks.map(plannedCheckToDedupable);
  const { kept: dedupedCases, removed, keptIndexes } = deduplicateTestCases(dedupables);
  const uniquePlannedChecks = keptIndexes.map((i) => checks[i]!);

  stages.push({
    id: 'deduplication',
    status: 'COMPLETED',
    note: `kept ${dedupedCases.length}, removed ${removed}`,
  });

  // Human overrides apply AFTER dedupe, before the registry is treated as final.
  // planned-checks.json (raw audit) is not rewritten here.
  let uniqueCases = dedupedCases;
  let humanOverrides: GenerationPipelineResult['humanOverrides'];
  if (input.overrides !== undefined && input.overrides !== null) {
    const applied = applyHumanOverrides(dedupedCases, input.overrides);
    uniqueCases = applied.cases;
    humanOverrides = {
      excluded: applied.excluded,
      unmatched: applied.unmatched,
      rejected: applied.rejected,
    };
  }

  // Stable identities: after overrides / dedupe, before traces.
  // Overrides match planner ids (pre-identity); reconcile then assigns/replaces stable TC-* ids.
  // Excluded cases remain in uniqueCases and reconcile as updated when still present.
  let persistedIdentities: PersistedTestCase[] | undefined;
  let deprecatedIdentities: PersistedTestCase[] | undefined;
  if (input.previousIdentities !== undefined) {
    const projectId =
      typeof input.projectId === 'string' && input.projectId.trim().length > 0
        ? input.projectId.trim()
        : 'default';
    const stamped = uniqueCases.map((c) => ({
      ...c,
      projectId: c.projectId ?? projectId,
      behavior: c.behavior ?? (c.category.trim().length > 0 ? c.category : 'unspecified'),
    }));
    const now =
      typeof input.identityNow === 'string' && input.identityNow.trim().length > 0
        ? input.identityNow.trim()
        : new Date().toISOString();
    // Match order is intentional: applyHumanOverrides ran on planner ids above.
    const reconciled = reconcileTestCases({
      current: stamped,
      previous: input.previousIdentities,
      now,
    });
    uniqueCases = reconciled.cases;
    persistedIdentities = reconciled.persisted;
    deprecatedIdentities = reconciled.deprecated;
  }

  const unspecifiedPriority = uniqueCases.filter((c) => c.priority === 'unspecified').length;
  stages.push({
    id: 'prioritization',
    status: 'COMPLETED',
    note: `${unspecifiedPriority} of ${uniqueCases.length} remain unspecified; priorities not invented`,
  });

  const identityNote =
    persistedIdentities !== undefined
      ? `; identities ${persistedIdentities.filter((p) => p.lifecycle !== 'deprecated').length} active, ${deprecatedIdentities?.length ?? 0} deprecated`
      : '';
  stages.push({
    id: 'test-case-registry',
    status: 'COMPLETED',
    note: `${uniqueCases.length} unique case(s) registered${identityNote}`,
  });

  const executionResults = input.executionResults ?? [];
  const resultById = new Map<string, string>();
  for (const row of executionResults) {
    if (typeof row?.testCaseId === 'string' && row.testCaseId.trim().length > 0) {
      resultById.set(row.testCaseId.trim(), String(row.result));
    }
  }
  const hasExecutionResults = resultById.size > 0;

  stages.push({
    id: 'execution',
    status: hasExecutionResults ? 'COMPLETED' : 'NOT_EXECUTED',
    note: hasExecutionResults
      ? `${resultById.size} execution result(s) supplied; unmatched cases stay NOT_EXECUTED`
      : 'no executionResults supplied; cases remain NOT_EXECUTED',
  });

  const screensForMatrix = screens.map((s) => ({
    screenId: s.screenId,
    url: s.url,
    title: s.title,
    elements: (s.elements ?? []).map((el) => ({
      elementId: el.elementId,
      type: el.type,
    })),
  }));

  const matrixResult = buildScreenCoverageMatrix({
    screens: screensForMatrix,
    checks: uniquePlannedChecks,
  });

  const testCaseScreenIds = uniquePlannedChecks
    .map((c) => c.screenId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const testCaseElementIds = uniquePlannedChecks
    .map((c) => c.targetElementId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const completeness = buildCompletenessReport({
    screens: screensForMatrix.map((s) => ({ screenId: s.screenId })),
    elements: screensForMatrix.flatMap((s) =>
      (s.elements ?? []).map((el) => ({
        elementId: el.elementId,
        screenId: s.screenId,
      }))
    ),
    testCaseScreenIds,
    testCaseElementIds,
    generatedTestCases: uniqueCases.length,
    rawGeneratedTestCases: checks.length,
  });

  stages.push({
    id: 'coverage',
    status: 'COMPLETED',
    note: `matrix ${matrixResult.rows.length} row(s); ${completeness.generatedTestCases} unique case(s); not a pass-rate %`,
  });

  const traceChecks = uniquePlannedChecks.map((c, i) => {
    const caseId = resolveCheckCaseId(c);
    const uc = uniqueCases[i];
    const excluded = uc?.excluded === true;
    // Excluded cases never count as executed passes — force NOT_EXECUTED.
    const supplied = excluded ? undefined : resultById.get(caseId);
    const exclusionNote =
      excluded && uc?.exclusionReason
        ? `excluded by human override: ${uc.exclusionReason}`
        : excluded
          ? 'excluded by human override'
          : null;
    const baseNote = typeof c.expect?.note === 'string' ? c.expect.note : undefined;
    const expectNote =
      exclusionNote != null
        ? baseNote
          ? `${baseNote}; ${exclusionNote}`
          : exclusionNote
        : baseNote;
    const expect =
      expectNote !== undefined
        ? { ...(c.expect ?? {}), note: expectNote }
        : c.expect;
    return {
      id: c.id,
      screenId: c.screenId,
      targetElementId: c.targetElementId,
      scenarioKind: c.scenarioKind,
      category: c.category,
      status: c.status,
      expect,
      ...(supplied !== undefined ? { executionResult: supplied } : {}),
    };
  });

  // Also match UniqueTestCase.testCaseId when it differs from PlannedCheck.id
  // (dedupe keeps first id; callers may pass that registry id).
  for (let i = 0; i < uniqueCases.length; i++) {
    const uc = uniqueCases[i]!;
    if (uc.excluded === true) continue;
    const supplied = resultById.get(uc.testCaseId);
    if (supplied === undefined) continue;
    const row = traceChecks[i];
    if (row && row.executionResult === undefined) {
      row.executionResult = supplied;
    }
  }

  const { traces, gaps } = buildTestCaseTraces({
    projectId: input.projectId,
    screens: screensForMatrix,
    checks: traceChecks,
  });

  return {
    stages,
    checks,
    uniqueCases,
    traces,
    gaps,
    matrix: matrixResult.rows,
    completeness,
    analystAnswers,
    ...(humanOverrides !== undefined ? { humanOverrides } : {}),
    ...(persistedIdentities !== undefined ? { persistedIdentities } : {}),
    ...(deprecatedIdentities !== undefined ? { deprecatedIdentities } : {}),
  };
}
