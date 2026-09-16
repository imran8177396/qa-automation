import type { ClassifiedFailure, FailureClass, OwnerFailureClass } from '../failures/types';
import { HEAVY_RETEST_SOURCES, RETEST_SELECTABLE_CLASSES } from './types';

export { RETEST_SELECTABLE_CLASSES };

export interface RetestSelectOptions {
  automationOnly?: boolean;
  source?: string;
}

function asFailureRow(
  rowOrClass: ClassifiedFailure | FailureClass | string
): Pick<ClassifiedFailure, 'classification' | 'ownerClassification' | 'source'> {
  if (typeof rowOrClass === 'string') {
    return { classification: rowOrClass as FailureClass, source: '' };
  }
  return rowOrClass;
}

export function isHeavyRetestSource(source: string): boolean {
  return (HEAVY_RETEST_SOURCES as readonly string[]).includes(source);
}

export function isAutomationOnlyCandidate(
  classification: FailureClass | string,
  owner: OwnerFailureClass | string | undefined
): boolean {
  if (owner === 'AUTOMATION') return true;
  return (RETEST_SELECTABLE_CLASSES as readonly string[]).includes(classification);
}

export function isRetestCandidate(
  rowOrClass: ClassifiedFailure | FailureClass | string,
  options: RetestSelectOptions = {}
): boolean {
  const row = asFailureRow(rowOrClass);
  if (options.source && row.source && row.source !== options.source) return false;
  if (isHeavyRetestSource(row.source)) return false;
  if (options.automationOnly) {
    return isAutomationOnlyCandidate(row.classification, row.ownerClassification);
  }
  return true;
}

export function selectRetestCandidates(
  failures: ClassifiedFailure[],
  options: RetestSelectOptions = {}
): { selected: ClassifiedFailure[]; notSelected: ClassifiedFailure[] } {
  const selected: ClassifiedFailure[] = [];
  const notSelected: ClassifiedFailure[] = [];
  for (const row of failures) {
    if (options.source && row.source !== options.source) {
      notSelected.push(row);
      continue;
    }
    if (isRetestCandidate(row, options)) selected.push(row);
    else notSelected.push(row);
  }
  return { selected, notSelected };
}
