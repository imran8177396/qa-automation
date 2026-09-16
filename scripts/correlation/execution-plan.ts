import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { ApiInventory } from '../discovery/api-observe';
import type { WorkflowInventory, WorkflowRecord } from '../discovery/workflows';
import {
  evaluateCorrelationApplicability,
  FIXTURE_SELF_CHECK_ID,
  NO_DISCOVERED_XHR_AND_NO_PAIR,
  NO_PAIR_REASON,
  type CorrelationApplicability,
} from './applicability';
import type { CorrelatedWorkflow } from './resolve';
import type { QaConfig } from '../types';

export type WorkflowExecutionStatus =
  | 'PLANNED'
  | 'UNCOVERED'
  | 'BLOCKED'
  | 'NOT_TESTED'
  | 'REQUIRES_CONFIGURATION'
  | 'NOT_APPLICABLE';

export interface WorkflowExecutionItem {
  id: string;
  name: string;
  kind: 'correlated' | 'inferred-navigation' | 'inferred-gated' | 'fixture-self-check';
  status: WorkflowExecutionStatus;
  reason?: string;
  uiPath?: string;
  apiMethod?: string;
  apiPath?: string;
}

export interface WorkflowExecutionPlan {
  correlated: CorrelatedWorkflow[];
  inferred: WorkflowRecord[];
  executable: WorkflowExecutionItem[];
  gated: WorkflowExecutionItem[];
  applicability: CorrelationApplicability;
  note: string;
}

function inferredReason(workflow: WorkflowRecord): { status: WorkflowExecutionStatus; reason: string } {
  if (workflow.kind === 'form-submit' || workflow.status === 'NOT_TESTED') {
    return {
      status: 'NOT_TESTED',
      reason:
        workflow.evidence ||
        'NOT_TESTED: inferred form-submit workflow is blocked by the safety policy — generated checks never submit.',
    };
  }
  if (workflow.kind === 'authentication' || workflow.kind === 'gated' || workflow.status === 'REQUIRES_CONFIGURATION') {
    return {
      status: 'REQUIRES_CONFIGURATION',
      reason:
        workflow.evidence ||
        'REQUIRES_CONFIGURATION: inferred authentication workflow needs documented credentials — none are assumed.',
    };
  }
  if (workflow.kind === 'api' || workflow.status === 'CANDIDATE') {
    return {
      status: 'REQUIRES_CONFIGURATION',
      reason:
        workflow.evidence ||
        'REQUIRES_CONFIGURATION: observed API calls are candidates only — no documented UI+API pair.',
    };
  }
  return {
    status: 'PLANNED',
    reason: workflow.evidence,
  };
}

export interface WorkflowPlanOptions {
  apiInventory?: ApiInventory | null;
  workflowInventory?: WorkflowInventory | null;
}

/**
 * Correlated config pairs plus discovery-inferred workflows.
 * Empty `workflows.correlated` plus 0 discovered XHR is UNCOVERED / NOT_APPLICABLE
 * with an explicit reason — the stage is not a silent skip.
 */
export function buildWorkflowExecutionPlan(
  config: QaConfig,
  options: WorkflowPlanOptions = {}
): WorkflowExecutionPlan {
  const applicability = evaluateCorrelationApplicability(config, options.apiInventory);
  const inventory =
    options.workflowInventory !== undefined
      ? options.workflowInventory
      : readJsonIfExists<WorkflowInventory>(PATHS.workflowInventoryFile);
  const inferred = inventory?.workflows ?? [];

  const executable: WorkflowExecutionItem[] = [];
  const gated: WorkflowExecutionItem[] = [];

  for (const row of applicability.validPairs) {
    executable.push({
      id: row.id,
      name: row.name,
      kind: 'correlated',
      status: 'PLANNED',
      uiPath: row.uiPath,
      apiMethod: row.apiMethod,
      apiPath: row.apiPath,
    });
  }

  for (const row of applicability.rejectedPairs) {
    gated.push({
      id: row.id,
      name: row.name,
      kind: 'inferred-gated',
      status: row.status,
      reason: row.reason,
      uiPath: row.uiPath,
      apiMethod: row.apiMethod,
      apiPath: row.apiPath,
    });
  }

  if (applicability.validPairs.length === 0) {
    gated.unshift({
      id: 'WF-CORRELATED',
      name: 'Documented UI+API correlated workflows',
      kind: 'inferred-gated',
      status: 'UNCOVERED',
      reason:
        applicability.documentedPairCount === 0
          ? `UNCOVERED: qa.config.json workflows.correlated is empty — ${NO_DISCOVERED_XHR_AND_NO_PAIR}. This is not a silent stage skip; inferred discovery workflows still execute when present.`
          : applicability.productCorrelation.reason,
    });
  }

  gated.push({
    id: 'WF-DISCOVERED-NETWORK',
    name: 'Discovered xhr/fetch/websocket correlation',
    kind: 'inferred-gated',
    status: applicability.discoveredNetwork.status,
    reason: applicability.discoveredNetwork.reason,
  });

  if (applicability.fixtureSelfCheck.status === 'APPLICABLE') {
    const pair = applicability.fixtureSelfCheck.pair;
    executable.push({
      id: pair.id,
      name: pair.name,
      kind: 'fixture-self-check',
      status: 'PLANNED',
      reason: applicability.fixtureSelfCheck.reason,
      uiPath: pair.uiPath,
      apiMethod: pair.apiMethod,
      apiPath: pair.apiPath,
    });
  } else {
    gated.push({
      id: FIXTURE_SELF_CHECK_ID,
      name: applicability.fixtureSelfCheck.pair.name,
      kind: 'fixture-self-check',
      status: 'NOT_APPLICABLE',
      reason: applicability.fixtureSelfCheck.reason,
      uiPath: applicability.fixtureSelfCheck.pair.uiPath,
      apiMethod: applicability.fixtureSelfCheck.pair.apiMethod,
      apiPath: applicability.fixtureSelfCheck.pair.apiPath,
    });
  }

  for (const workflow of inferred) {
    const outcome = inferredReason(workflow);
    const item: WorkflowExecutionItem = {
      id: workflow.id,
      name: workflow.title,
      kind: outcome.status === 'PLANNED' ? 'inferred-navigation' : 'inferred-gated',
      status: outcome.status,
      reason: outcome.reason,
      uiPath: workflow.page,
    };
    if (outcome.status === 'PLANNED') executable.push(item);
    else gated.push(item);
  }

  const noteParts = [
    applicability.validPairs.length === 0
      ? `workflows.correlated has no executable UI↔API pair (${NO_DISCOVERED_XHR_AND_NO_PAIR}).`
      : `${applicability.validPairs.length} correlated workflow(s) will execute.`,
    inferred.length > 0
      ? `${inferred.length} inferred discovery workflow(s) recorded (${executable.filter((row) => row.kind === 'inferred-navigation').length} non-destructive navigation executable).`
      : 'No inferred discovery workflows were present.',
    applicability.fixtureSelfCheck.status === 'APPLICABLE'
      ? 'Fixture self-check is APPLICABLE (framework only — not Sauce Demo coverage).'
      : 'Fixture self-check is recorded separately and is not Sauce Demo coverage.',
    'UI (test:e2e / test:ui), API (test:api), and combined (test:workflows) suites stay separate.',
  ];

  return {
    correlated: applicability.validPairs,
    inferred,
    executable,
    gated,
    applicability,
    note: noteParts.join(' '),
  };
}

export { NO_PAIR_REASON };
