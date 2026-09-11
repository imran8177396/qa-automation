import type { ClassifiedFailure, FailureClass } from '../failures/types';
import { RETEST_SELECTABLE_CLASSES } from './types';

export { RETEST_SELECTABLE_CLASSES };

export function isRetestCandidate(
  classification: FailureClass | string,
  options: { automationOnly?: boolean } = {}
): boolean {
  if (options.automationOnly) return classification === 'FLAKY';
  return (RETEST_SELECTABLE_CLASSES as readonly string[]).includes(classification);
}

export function selectRetestCandidates(
  failures: ClassifiedFailure[],
  options: { automationOnly?: boolean } = {}
): { selected: ClassifiedFailure[]; notSelected: ClassifiedFailure[] } {
  const selected: ClassifiedFailure[] = [];
  const notSelected: ClassifiedFailure[] = [];
  for (const row of failures) {
    if (isRetestCandidate(row.classification, options)) selected.push(row);
    else notSelected.push(row);
  }
  return { selected, notSelected };
}
