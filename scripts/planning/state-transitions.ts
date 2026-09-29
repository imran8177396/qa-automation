/**
 * Business / component state-transition plans for the existing planner.
 * Consumed only by buildScenarioInventory when options supply machines or status labels.
 * UI screen states (default, loading, dialog, …) are NOT a business state machine.
 * Never invents Order/Pending/Paid/Processing/Completed. Never clicks. Never marks unknown PASS.
 */

import type {
  CheckKind,
  CheckStatus,
  PlannedAction,
  PlannedCheck,
} from './types';

export interface StateMachineSpec {
  componentId: string;
  initial: string;
  /** Observed or configured states. */
  states: string[];
  /** Allowed edges. */
  transitions: { from: string; to: string; action?: string }[];
}

export type StateTransitionSubcaseId =
  | 'state-transition-none'
  | 'state-observed'
  | 'state-initial'
  | 'state-actions'
  | 'state-invalid-unconfigured'
  | 'state-initial-missing'
  | `state-allowed-${string}`
  | `state-invalid-${string}`;

export interface StateTransitionPlan {
  subcaseId: string;
  componentId?: string;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  reason?: string;
  expect?: PlannedCheck['expect'];
  /** Never true — plans are observe/specification only; never click to change state. */
  executable: false;
  metadata?: {
    representedStates?: string[];
    from?: string;
    to?: string;
    transitionAction?: string;
  };
}

export interface BuildStateTransitionPlansInput {
  machines?: StateMachineSpec[] | null;
  /** Status-indicator / badge accessible names already on the screen. */
  observedStatusLabels?: string[] | null;
  /**
   * When false (default), invalid pairs are PLANNED as specification-only rows.
   * When true, still never performed — rows stay NOT_TESTED / BLOCKED.
   */
  executeInvalid?: boolean;
}

const NONE_REASON =
  'NOT_TESTED: state machine was not represented in discovery or configuration';
const INITIAL_UNKNOWN_REASON = 'NOT_TESTED: initial state was not identified';
const ACTIONS_UNKNOWN_REASON = 'NOT_TESTED: actions that cause transitions were not recorded';
const INVALID_UNKNOWN_REASON =
  'NOT_TESTED: allowed transitions were not configured, so invalid transitions cannot be judged';
const INITIAL_NOT_IN_STATES_REASON =
  'NOT_TESTED: initial state is not in the represented states';
const ALLOWED_REASON = 'PLANNED: allowed transition is configured; it is not executed';
const INVALID_SPEC_REASON =
  'PLANNED: invalid transition is specified as disallowed; it is not performed';
const INVALID_EXECUTE_REASON =
  'NOT_TESTED: attempting invalid transitions is not authorized';
const INVALID_CAP_REASON = 'NOT_TESTED: additional invalid pairs were not expanded';

/** Max invalid (from,to) pairs expanded per machine, including self-transitions. */
export const MAX_INVALID_PAIRS = 12;

function distinctLabels(labels: string[] | null | undefined): string[] {
  if (!labels || labels.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = typeof raw === 'string' ? raw.trim() : '';
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

function slugToken(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'state';
}

function edgeKey(from: string, to: string): string {
  return `${from}\0${to}`;
}

function basePlan(
  partial: Omit<StateTransitionPlan, 'executable' | 'kind' | 'action'> & {
    kind?: CheckKind;
    action?: PlannedAction;
  }
): StateTransitionPlan {
  return {
    executable: false,
    kind: partial.kind ?? 'toggle-state',
    action: partial.action ?? 'none',
    subcaseId: partial.subcaseId,
    componentId: partial.componentId,
    title: partial.title,
    status: partial.status,
    reason: partial.reason,
    expect: partial.expect,
    metadata: partial.metadata,
  };
}

function planNone(): StateTransitionPlan[] {
  return [
    basePlan({
      subcaseId: 'state-transition-none',
      title: 'state transitions — not represented',
      status: 'NOT_TESTED',
      reason: NONE_REASON,
    }),
  ];
}

function planObservedLabelsOnly(states: string[]): StateTransitionPlan[] {
  return [
    basePlan({
      subcaseId: 'state-observed',
      title: `state transitions — observed status labels (${states.join(', ')})`,
      status: 'NOT_TESTED',
      reason:
        'NOT_TESTED: status labels were observed; a state machine and transitions were not configured',
      expect: { note: `represented states: ${states.join(', ')}` },
      metadata: { representedStates: states },
    }),
    basePlan({
      subcaseId: 'state-initial',
      title: 'state transitions — initial state',
      status: 'NOT_TESTED',
      reason: INITIAL_UNKNOWN_REASON,
      metadata: { representedStates: states },
    }),
    basePlan({
      subcaseId: 'state-actions',
      title: 'state transitions — possible actions',
      status: 'NOT_TESTED',
      reason: ACTIONS_UNKNOWN_REASON,
      metadata: { representedStates: states },
    }),
    basePlan({
      subcaseId: 'state-invalid-unconfigured',
      title: 'state transitions — invalid transitions',
      status: 'NOT_TESTED',
      reason: INVALID_UNKNOWN_REASON,
      metadata: { representedStates: states },
    }),
  ];
}

function allowedEdgeSet(
  transitions: StateMachineSpec['transitions']
): Set<string> {
  const set = new Set<string>();
  for (const edge of transitions) {
    if (!edge?.from || !edge?.to) continue;
    set.add(edgeKey(edge.from, edge.to));
  }
  return set;
}

function planMachine(
  machine: StateMachineSpec,
  executeInvalid: boolean
): StateTransitionPlan[] {
  const componentId = machine.componentId?.trim() || 'component';
  const states = [...new Set((machine.states ?? []).map((s) => s.trim()).filter(Boolean))];
  const initial = (machine.initial ?? '').trim();
  const transitions = (machine.transitions ?? []).filter(
    (t) => typeof t?.from === 'string' && typeof t?.to === 'string' && t.from.trim() && t.to.trim()
  );

  if (!initial || !states.includes(initial)) {
    return [
      basePlan({
        subcaseId: 'state-initial-missing',
        componentId,
        title: `${componentId} — initial state is not in the represented states`,
        status: 'NOT_TESTED',
        reason: INITIAL_NOT_IN_STATES_REASON,
        metadata: { representedStates: states },
      }),
    ];
  }

  const plans: StateTransitionPlan[] = [];
  const allowed = allowedEdgeSet(transitions);

  for (const edge of transitions) {
    const from = edge.from.trim();
    const to = edge.to.trim();
    const fromSlug = slugToken(from);
    const toSlug = slugToken(to);
    plans.push(
      basePlan({
        subcaseId: `state-allowed-${fromSlug}-${toSlug}`,
        componentId,
        title: `${componentId}: ${from} → ${to} (allowed)`,
        status: 'PLANNED',
        action: 'none',
        reason: ALLOWED_REASON,
        expect: {
          note: edge.action
            ? `allowed: ${from} → ${to} via ${edge.action}; not executed`
            : `allowed: ${from} → ${to}; not executed`,
        },
        metadata: {
          representedStates: states,
          from,
          to,
          transitionAction: edge.action,
        },
      })
    );
  }

  const invalidCandidates: { from: string; to: string }[] = [];
  const sortedStates = [...states].sort((a, b) => a.localeCompare(b));
  for (const from of sortedStates) {
    for (const to of sortedStates) {
      if (allowed.has(edgeKey(from, to))) continue;
      invalidCandidates.push({ from, to });
    }
  }

  let expanded = 0;
  for (const pair of invalidCandidates) {
    if (expanded >= MAX_INVALID_PAIRS) {
      plans.push(
        basePlan({
          subcaseId: 'state-invalid-cap',
          componentId,
          title: `${componentId} — additional invalid pairs were not expanded`,
          status: 'NOT_TESTED',
          reason: INVALID_CAP_REASON,
          metadata: { representedStates: states },
        })
      );
      break;
    }
    expanded += 1;
    const fromSlug = slugToken(pair.from);
    const toSlug = slugToken(pair.to);
    const asSpec = executeInvalid !== true;
    plans.push(
      basePlan({
        subcaseId: `state-invalid-${fromSlug}-${toSlug}`,
        componentId,
        title: `${componentId}: ${pair.from} → ${pair.to} (invalid)`,
        status: asSpec ? 'PLANNED' : 'NOT_TESTED',
        action: 'none',
        reason: asSpec ? INVALID_SPEC_REASON : INVALID_EXECUTE_REASON,
        expect: {
          note: `disallowed: ${pair.from} → ${pair.to}; not performed`,
        },
        metadata: {
          representedStates: states,
          from: pair.from,
          to: pair.to,
        },
      })
    );
  }

  return plans;
}

/**
 * Build state-transition inventory rows from configured machines and/or observed labels.
 * Empty input → one NOT_TESTED none row. Never invents demo Order states.
 */
export function buildStateTransitionPlans(
  input: BuildStateTransitionPlansInput = {}
): StateTransitionPlan[] {
  const machines = input.machines;
  const labels = distinctLabels(input.observedStatusLabels ?? null);
  const hasMachines = Array.isArray(machines) && machines.length > 0;

  if (!hasMachines && labels.length < 2) {
    return planNone();
  }

  if (!hasMachines) {
    return planObservedLabelsOnly(labels);
  }

  const executeInvalid = input.executeInvalid === true;
  const plans: StateTransitionPlan[] = [];
  for (const machine of machines!) {
    plans.push(...planMachine(machine, executeInvalid));
  }
  return plans;
}
