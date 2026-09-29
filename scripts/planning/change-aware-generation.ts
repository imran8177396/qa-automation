/**
 * Change-aware test generation selection (item 39).
 *
 * Explicit path-prefix mappings only — no git spawn, no filename heuristics,
 * no AI inference. When files are unmapped, preserves the full inventory
 * (does not put every case in regenerate). Distinct from analyzeChangeImpact's
 * full-regression fallback used by the regression runner.
 */

import type { UniqueTestCase } from './test-case-uniqueness';

/** Generation-specific mapping — not the regression ChangeImpactMapping shape. */
export interface ChangeAwareGenerationMapping {
  pathPrefix: string;
  screenIds?: string[];
  elementIds?: string[];
  testCaseIds?: string[];
}

export type ChangeAwareGenerationStatus =
  | 'UPDATED'
  | 'NOT_IMPLEMENTED'
  | 'UNMAPPED';

export interface SelectCasesForChangeInput {
  changedFiles: string[];
  mappings: ChangeAwareGenerationMapping[];
  cases: UniqueTestCase[];
}

export interface SelectCasesForChangeResult {
  status: ChangeAwareGenerationStatus;
  regenerate: UniqueTestCase[];
  preserved: UniqueTestCase[];
  unmappedFiles: string[];
  reason: string;
}

const UNMAPPED_REASON =
  'changed files are not mapped to screens or elements; the full inventory was not regenerated';

const NO_FILES_REASON =
  'no changed files were supplied; inventory was not regenerated';

function mappingHasSelectableIds(m: ChangeAwareGenerationMapping): boolean {
  return (
    (m.screenIds?.length ?? 0) > 0 ||
    (m.elementIds?.length ?? 0) > 0 ||
    (m.testCaseIds?.length ?? 0) > 0
  );
}

/**
 * Split unique cases into regenerate vs preserved from explicit pathPrefix mappings.
 * Does not spawn git. Does not regenerate the full inventory when unmapped.
 */
export function selectCasesForChange(
  input: SelectCasesForChangeInput
): SelectCasesForChangeResult {
  const changedFiles = [...input.changedFiles];
  const mappings = input.mappings ?? [];
  const cases = [...input.cases];

  if (changedFiles.length === 0) {
    return {
      status: 'NOT_IMPLEMENTED',
      regenerate: [],
      preserved: cases,
      unmappedFiles: [],
      reason: NO_FILES_REASON,
    };
  }

  if (mappings.length === 0) {
    return {
      status: 'UNMAPPED',
      regenerate: [],
      preserved: cases,
      unmappedFiles: [...changedFiles],
      reason: UNMAPPED_REASON,
    };
  }

  const matchedWithIds: ChangeAwareGenerationMapping[] = [];
  const unmappedFiles: string[] = [];

  for (const file of changedFiles) {
    const prefixMatches = mappings.filter((row) =>
      file.startsWith(row.pathPrefix)
    );
    if (prefixMatches.length === 0) {
      unmappedFiles.push(file);
      continue;
    }
    const withIds = prefixMatches.filter(mappingHasSelectableIds);
    // Prefix-only match (no screen/element/testCase ids) is unmapped for generation.
    if (withIds.length === 0) {
      unmappedFiles.push(file);
      continue;
    }
    for (const row of withIds) {
      if (!matchedWithIds.includes(row)) {
        matchedWithIds.push(row);
      }
    }
  }

  if (unmappedFiles.length > 0) {
    return {
      status: 'UNMAPPED',
      regenerate: [],
      preserved: cases,
      unmappedFiles,
      reason: UNMAPPED_REASON,
    };
  }

  const screenIds = new Set<string>();
  const elementIds = new Set<string>();
  const testCaseIds = new Set<string>();
  for (const row of matchedWithIds) {
    for (const id of row.screenIds ?? []) screenIds.add(id);
    for (const id of row.elementIds ?? []) elementIds.add(id);
    for (const id of row.testCaseIds ?? []) testCaseIds.add(id);
  }

  const regenerate: UniqueTestCase[] = [];
  const preserved: UniqueTestCase[] = [];
  for (const c of cases) {
    const hit =
      (c.screenId.length > 0 && screenIds.has(c.screenId)) ||
      (c.elementId != null &&
        c.elementId.length > 0 &&
        elementIds.has(c.elementId)) ||
      testCaseIds.has(c.testCaseId);
    if (hit) regenerate.push(c);
    else preserved.push(c);
  }

  const reason =
    regenerate.length === 0
      ? 'explicit mapping matched changed files but zero cases were affected; inventory was not fully regenerated'
      : `explicit mapping selected ${regenerate.length} case(s) for regeneration; ${preserved.length} preserved`;

  return {
    status: 'UPDATED',
    regenerate,
    preserved,
    unmappedFiles: [],
    reason,
  };
}

/**
 * Normalize config / option rows into generation mappings.
 * Uses pathPrefix when present, else path (regression table). Does not map
 * regression testIds onto UniqueTestCase ids — only explicit testCaseIds.
 */
export function toChangeAwareMappings(
  rows: ReadonlyArray<{
    pathPrefix?: string;
    path?: string;
    screenIds?: string[];
    elementIds?: string[];
    testCaseIds?: string[];
  }>
): ChangeAwareGenerationMapping[] {
  const out: ChangeAwareGenerationMapping[] = [];
  for (const row of rows) {
    const pathPrefix = (row.pathPrefix ?? row.path ?? '').trim();
    if (!pathPrefix) continue;
    out.push({
      pathPrefix,
      ...(row.screenIds !== undefined ? { screenIds: row.screenIds } : {}),
      ...(row.elementIds !== undefined ? { elementIds: row.elementIds } : {}),
      ...(row.testCaseIds !== undefined ? { testCaseIds: row.testCaseIds } : {}),
    });
  }
  return out;
}
