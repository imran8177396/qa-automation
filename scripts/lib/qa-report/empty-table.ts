export const NOT_AVAILABLE = 'NOT_AVAILABLE';

export interface EmptyTableRow {
  cells: string[];
  reason: string;
  colSpan: number;
}

/**
 * When a table has no data rows, emit one spanning row:
 * `NOT_AVAILABLE — <reason>`
 * Never render an empty tbody / shell.
 */
export function emptyTablePlaceholder(columnCount: number, reason: string): EmptyTableRow {
  const trimmed = reason.trim() || 'no rows were available and no reason was supplied';
  const message = `${NOT_AVAILABLE} — ${trimmed}`;
  const cells = Array.from({ length: Math.max(columnCount, 1) }, (_, index) =>
    index === 0 ? message : ''
  );
  return { cells, reason: trimmed, colSpan: Math.max(columnCount, 1) };
}

export function rowsOrUnavailable(rows: string[][], columnCount: number, reason: string): string[][] {
  if (rows.length > 0) return rows;
  return [emptyTablePlaceholder(columnCount, reason).cells];
}

export function isUnavailableTableRow(row: string[] | undefined): boolean {
  return Boolean(row?.[0]?.startsWith(`${NOT_AVAILABLE} —`));
}

export class EmptyTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyTableError';
  }
}

export interface TableRenderRecord {
  headers: string[];
  dataRowCount: number;
  emptyReason?: string;
}

/** Fail the report stage if a table would render with zero rows and no reason. */
export class TableAudit {
  readonly records: TableRenderRecord[] = [];

  record(headers: string[], dataRowCount: number, emptyReason?: string): void {
    if (dataRowCount === 0 && !emptyReason) {
      throw new EmptyTableError(
        `Report stage failed: table [${headers.join(', ')}] rendered with zero rows and no reason.`
      );
    }
    this.records.push({ headers, dataRowCount, emptyReason });
  }

  emptyWithoutReason(): TableRenderRecord[] {
    return this.records.filter((row) => row.dataRowCount === 0 && !row.emptyReason);
  }
}

export function prepareTableRows(
  headers: string[],
  rows: string[][],
  audit: TableAudit,
  emptyReason: string
): { rows: string[][]; placeholder: EmptyTableRow | null } {
  if (rows.length > 0) {
    audit.record(headers, rows.length);
    return { rows, placeholder: null };
  }
  const placeholder = emptyTablePlaceholder(headers.length, emptyReason);
  audit.record(headers, 0, placeholder.reason);
  return { rows: [placeholder.cells], placeholder };
}
