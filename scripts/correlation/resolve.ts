import type { QaConfig } from '../types';

export interface CorrelatedWorkflow {
  id: string;
  name: string;
  uiPath: string;
  apiMethod: string;
  apiPath: string;
  expectedStatus?: number;
  requiredFields?: string[];
  uiAction?: string;
  uiResult?: string;
}

export function resolveCorrelatedWorkflows(config: QaConfig): CorrelatedWorkflow[] {
  return (config.workflows?.correlated ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    uiPath: row.uiPath,
    apiMethod: row.apiMethod,
    apiPath: row.apiPath,
    expectedStatus: row.expectedStatus,
    requiredFields: row.requiredFields,
    uiAction: row.uiAction,
    uiResult: row.uiResult,
  }));
}
