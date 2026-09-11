import {
  ADVANCED_DIMENSIONS,
  type CoverageRecord,
  type DimensionCoverage,
  type InventoryItem,
  type InventoryKind,
} from './types';
import { emptyByStatus, isCoveredStatus, percent } from './status';

export function calculateDimensions(items: InventoryItem[], records: CoverageRecord[]): DimensionCoverage[] {
  const byId = new Map(records.map((row) => [row.id, row]));

  return ADVANCED_DIMENSIONS.map((dimension) => {
    const dimItems = items.filter((item) =>
      (dimension.kinds as readonly InventoryKind[]).includes(item.kind)
    );
    const testable = dimItems.filter((item) =>
      item.applicableScenarios.some((scenario) => scenario.disposition === 'executable')
    );
    const dimRecords = dimItems.map((item) => byId.get(item.id)).filter((row): row is CoverageRecord => Boolean(row));
    const covered = dimRecords.filter((row) => isCoveredStatus(row.status)).length;
    const byStatus = emptyByStatus();
    for (const row of dimRecords) byStatus[row.status] += 1;

    return {
      id: dimension.id,
      label: dimension.label,
      discovered: dimItems.length,
      testable: testable.length,
      covered,
      uncovered: dimRecords.filter((row) => row.status === 'UNCOVERED').length,
      coveragePercent: percent(covered, testable.length),
      byStatus,
    };
  }).filter((row) => row.discovered > 0);
}
