/**
 * Screen-level visual observation plans for the existing planner.
 * Consumed only by buildScenarioInventory → planVisualForScreen — not a second planner
 * and not a second visual engine.
 *
 * Runtime screenshot comparison lives in tests/e2e/visual (npm run test:visual).
 * This module does not invoke that suite, does not write PNG/baseline files, and
 * must never import fs write APIs.
 *
 * Evidence-only: never invent demo hosts, never mark a missing screenshot PASS,
 * never create a baseline for every intermediate screen state.
 */

import type { DiscoveredScreen } from '../discovery/screens';
import type {
  CheckKind,
  CheckStatus,
  PlannedAction,
  PlannedCheck,
} from './types';

/**
 * Meaningful states that may receive visual-* baseline rows.
 * validation-error is intentionally omitted — one error visual (state=error) is enough.
 */
export const VISUAL_MEANINGFUL_STATES = new Set<string>([
  'default',
  'empty',
  'error',
  'dialog',
  'modal',
  'drawer',
  'expanded',
]);

/**
 * Intermediate / non-visual tokens — no visual-* baseline rows.
 * At most one NOT_APPLICABLE skip note per such screen.
 */
export const VISUAL_SKIPPED_STATES = new Set<string>([
  'loading',
  'dropdown-open',
  'success',
  'populated',
  'authenticated',
  'unauthenticated',
  'permission-denied',
  'disabled',
  'collapsed',
  'validation-error',
]);

export const MODAL_FAMILY_STATES = new Set<string>(['dialog', 'modal', 'drawer']);

export type VisualSubcaseId =
  | 'visual-baseline'
  | 'visual-normal'
  | 'visual-empty'
  | 'visual-error'
  | 'visual-modal'
  | 'visual-expanded'
  | 'visual-responsive'
  | 'visual-skip';

export interface VisualEvidence {
  screenId: string;
  state: string;
  /** Caller declares an existing baseline — never writes a file from planning. */
  baselineExists?: boolean;
  /** Optional comparison outcome from an external runner — never invents PASS. */
  comparisonResult?: 'match' | 'diff';
}

export interface VisualSubcasePlan {
  subcaseId: VisualSubcaseId;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  reason?: string;
  expect?: PlannedCheck['expect'];
}

export interface VisualCaseResult {
  plans: VisualSubcasePlan[];
}

export interface BuildVisualPlansInput {
  screen: DiscoveredScreen;
  /** Optional evidence for this screen — default path passes none. */
  evidence?: VisualEvidence | null;
}

const BASELINE_NOT_CREATED =
  'NOT_TESTED: screenshot baseline was not created by planning';
const BASELINE_DECLARED = 'PLANNED: existing baseline was declared';
const BASELINE_MATCHED =
  'PLANNED: baseline comparison matched; not a full visual audit';
const BASELINE_DIFF = 'FAIL: baseline comparison reported a difference';
const CAPTURE_NOT_RUN = (label: string) =>
  `NOT_TESTED: ${label} screenshot was not captured`;
const RESPONSIVE_NOT_CAPTURED =
  'NOT_TESTED: responsive screenshot was not captured; see the responsive plan (npm run test:responsive) — do not duplicate mobile/tablet/desktop screenshots here';
const SKIP_NOTE_PREFIX =
  'NOT_APPLICABLE: intermediate or non-visual state is not baselined';

export function isVisualMeaningfulState(state: string): boolean {
  return VISUAL_MEANINGFUL_STATES.has(state);
}

export function isVisualSkippedState(state: string): boolean {
  return VISUAL_SKIPPED_STATES.has(state);
}

export function isModalFamilyState(state: string): boolean {
  return MODAL_FAMILY_STATES.has(state);
}

function statusReason(status: CheckStatus, detail: string): string {
  const trimmed = detail.trim().replace(/^(NOT_TESTED|PLANNED|FAIL|NOT_APPLICABLE):\s*/i, '');
  return `${status}: ${trimmed}`;
}

function resolveBaselineRow(evidence: VisualEvidence | null | undefined): {
  status: CheckStatus;
  reason: string;
} {
  if (evidence?.comparisonResult === 'diff') {
    return { status: 'FAIL', reason: BASELINE_DIFF };
  }
  if (evidence?.comparisonResult === 'match') {
    return { status: 'PLANNED', reason: BASELINE_MATCHED };
  }
  if (evidence?.baselineExists === true) {
    return { status: 'PLANNED', reason: BASELINE_DECLARED };
  }
  return { status: 'NOT_TESTED', reason: BASELINE_NOT_CREATED };
}

function stateSpecificSubcase(
  state: string
): { subcaseId: VisualSubcaseId; label: string } | null {
  if (state === 'default') return { subcaseId: 'visual-normal', label: 'normal-state' };
  if (state === 'empty') return { subcaseId: 'visual-empty', label: 'empty-state' };
  if (state === 'error') return { subcaseId: 'visual-error', label: 'error-state' };
  if (isModalFamilyState(state)) return { subcaseId: 'visual-modal', label: 'modal-state' };
  if (state === 'expanded') return { subcaseId: 'visual-expanded', label: 'expanded-state' };
  return null;
}

function screenLabel(screen: DiscoveredScreen): string {
  return screen.state === 'default' ? screen.url : `${screen.url} [${screen.state}]`;
}

/**
 * Build visual plan rows for one discovered screen.
 * Meaningful states → baseline + state row + responsive (all NOT_TESTED unless evidence).
 * Skipped states → at most one NOT_APPLICABLE skip note; zero visual-* baseline rows.
 * Never writes files. Never PASS without a real comparison (and match is still not PASS).
 */
export function buildVisualPlansForScreen(input: BuildVisualPlansInput): VisualCaseResult {
  const { screen, evidence } = input;
  const state = String(screen.state || 'default');
  const label = screenLabel(screen);
  const plans: VisualSubcasePlan[] = [];

  if (!isVisualMeaningfulState(state)) {
    // Skipped / unknown non-meaningful tokens: one NOT_APPLICABLE note, zero visual-* baselines.
    plans.push({
      subcaseId: 'visual-skip',
      kind: 'visual-observation',
      title: `${screen.id} ${label} — visual skip`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      reason: statusReason(
        'NOT_APPLICABLE',
        `${SKIP_NOTE_PREFIX} (skipped tokens present: ${state})`
      ),
    });
    return { plans };
  }

  const baseline = resolveBaselineRow(evidence ?? null);
  plans.push({
    subcaseId: 'visual-baseline',
    kind: 'visual-observation',
    title: `${screen.id} ${label} — visual baseline`,
    status: baseline.status,
    action: 'observe',
    reason: baseline.reason,
    expect: {
      note: 'planning does not create or write screenshot baseline files',
    },
  });

  const specific = stateSpecificSubcase(state);
  if (specific) {
    plans.push({
      subcaseId: specific.subcaseId,
      kind: 'visual-observation',
      title: `${screen.id} ${label} — ${specific.subcaseId}`,
      status: 'NOT_TESTED',
      action: 'observe',
      reason: CAPTURE_NOT_RUN(specific.label),
      expect: {
        note: 'screenshot capture was not performed by planning',
      },
    });
  }

  plans.push({
    subcaseId: 'visual-responsive',
    kind: 'visual-observation',
    title: `${screen.id} ${label} — visual responsive`,
    status: 'NOT_TESTED',
    action: 'observe',
    reason: RESPONSIVE_NOT_CAPTURED,
    expect: {
      note: 'one responsive visual plan per meaningful screen; viewports belong to the responsive suite',
    },
  });

  return { plans };
}

/**
 * Build visual plans for every screen in the inventory list.
 * Default callers pass no evidence.
 */
export function buildVisualPlans(input: {
  screens: DiscoveredScreen[];
  evidence?: VisualEvidence[] | null;
}): VisualCaseResult & { byScreen: Map<string, VisualSubcasePlan[]> } {
  const evidenceByScreen = new Map<string, VisualEvidence>();
  for (const row of input.evidence ?? []) {
    if (row?.screenId) evidenceByScreen.set(row.screenId, row);
  }

  const plans: VisualSubcasePlan[] = [];
  const byScreen = new Map<string, VisualSubcasePlan[]>();

  for (const screen of input.screens) {
    const result = buildVisualPlansForScreen({
      screen,
      evidence: evidenceByScreen.get(screen.id) ?? null,
    });
    byScreen.set(screen.id, result.plans);
    plans.push(...result.plans);
  }

  return { plans, byScreen };
}
