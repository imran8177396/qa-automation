import type { QaConfig } from '../types';

export interface CorrelatedWorkflow {
  id: string;
  name: string;
  uiPath: string;
  apiMethod: string;
  apiPath: string;
}

export function resolveCorrelatedWorkflows(config: QaConfig): CorrelatedWorkflow[] {
  return (config.workflows?.correlated ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    uiPath: row.uiPath,
    apiMethod: row.apiMethod,
    apiPath: row.apiPath,
  }));
}
