import type { RetestOutcomeStatus, StabilityVerdict } from './types';

export function stabilityVerdictFor(retestStatus: RetestOutcomeStatus): StabilityVerdict {
  if (retestStatus === 'PASS') return 'FAIL → PASS (unstable)';
  if (retestStatus === 'FAIL') return 'FAIL → FAIL (reproduced)';
  return 'FAIL → NOT_EXECUTED';
}

export function runCountFor(retestStatus: RetestOutcomeStatus): number {
  return retestStatus === 'NOT_EXECUTED' ? 1 : 2;
}
