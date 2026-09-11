import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { WorkflowInventory, WorkflowRecord } from '../discovery/workflows';
import { resolveCorrelatedWorkflows, type CorrelatedWorkflow } from './resolve';
import type { QaConfig } from '../types';

export type WorkflowExecutionStatus =
  | 'PLANNED'
  | 'UNCOVERED'
  | 'BLOCKED'
  | 'NOT_TESTED'
  | 'REQUIRES_CONFIGURATION';

export interface WorkflowExecutionItem {
  id: string;
  name: string;
  kind: 'correlated' | 'inferred-navigation' | 'inferred-gated';
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
  if (workflow.kind === 'authentication' || workflow.status === 'REQUIRES_CONFIGURATION') {
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

/**
 * Correlated config pairs plus discovery-inferred workflows.
 * Empty `workflows.correlated` is UNCOVERED/BLOCKED with a reason — the stage
 * still executes inferred non-destructive navigation when inventory has it.
 */
export function buildWorkflowExecutionPlan(config: QaConfig): WorkflowExecutionPlan {
  const correlated = resolveCorrelatedWorkflows(config);
  const inventory = readJsonIfExists<WorkflowInventory>(PATHS.workflowInventoryFile);
  const inferred = inventory?.workflows ?? [];

  const executable: WorkflowExecutionItem[] = [];
  const gated: WorkflowExecutionItem[] = [];

  for (const row of correlated) {
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

  if (correlated.length === 0) {
    gated.unshift({
      id: 'WF-CORRELATED',
      name: 'Documented UI+API correlated workflows',
      kind: 'inferred-gated',
      status: 'UNCOVERED',
      reason:
        'UNCOVERED: qa.config.json workflows.correlated is empty — no documented UI+API pair. This is not a silent stage skip; inferred discovery workflows still execute when present.',
    });
  }

  const noteParts = [
    correlated.length === 0
      ? 'workflows.correlated is empty (UNCOVERED — documented UI+API pair missing).'
      : `${correlated.length} correlated workflow(s) will execute.`,
    inferred.length > 0
      ? `${inferred.length} inferred discovery workflow(s) recorded (${executable.filter((row) => row.kind === 'inferred-navigation').length} non-destructive navigation executable).`
      : 'No inferred discovery workflows were present.',
  ];

  return {
    correlated,
    inferred,
    executable,
    gated,
    note: noteParts.join(' '),
  };
}
