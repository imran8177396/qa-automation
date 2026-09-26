import { createHash } from 'crypto';

/** Content hashing only — no git writes. */
export const TEST_VERSIONING_STATUS = 'PARTIAL' as const;

export interface VersionableTestCase {
  id: string;
  title: string;
  expected: unknown;
  /** Optional baseline included in the hashed payload. */
  baseline?: unknown;
}

export interface VersionedTestCase {
  id: string;
  version: string;
}

export type VersionCompareResult = 'unchanged' | 'changed' | 'new';

export type VersionChangedField = 'expected' | 'baseline' | 'title';

export interface VersionCompareDetail {
  result: VersionCompareResult;
  changedFields: VersionChangedField[];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function isVersionableCase(value: unknown): value is VersionableTestCase {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'title' in value &&
    'expected' in value
  );
}

/**
 * Version = sha256 hex of stable JSON of `{ id, title, expected, baseline }`.
 */
export function versionTestCase(input: VersionableTestCase): VersionedTestCase {
  const payload = stableStringify({
    id: input.id,
    title: input.title,
    expected: input.expected,
    baseline: input.baseline,
  });
  const version = createHash('sha256').update(payload).digest('hex');
  return { id: input.id, version };
}

function detectChangedFields(
  previous: VersionableTestCase,
  next: VersionableTestCase
): VersionChangedField[] {
  const fields: VersionChangedField[] = [];
  if (previous.title !== next.title) fields.push('title');
  if (stableStringify(previous.expected) !== stableStringify(next.expected)) {
    fields.push('expected');
  }
  if (stableStringify(previous.baseline) !== stableStringify(next.baseline)) {
    fields.push('baseline');
  }
  return fields;
}

/**
 * Compare version strings. `previous === null` → `new`.
 * When both arguments are VersionableTestCase objects, also returns `changedFields`.
 */
export function compareVersions(previous: string | null, next: string): VersionCompareResult;
export function compareVersions(
  previous: VersionableTestCase | null,
  next: VersionableTestCase
): VersionCompareDetail;
export function compareVersions(
  previous: string | null | VersionableTestCase,
  next: string | VersionableTestCase
): VersionCompareResult | VersionCompareDetail {
  if (isVersionableCase(next) && (previous === null || isVersionableCase(previous))) {
    if (previous === null) {
      return { result: 'new', changedFields: [] };
    }
    const prevVersion = versionTestCase(previous).version;
    const nextVersion = versionTestCase(next).version;
    if (prevVersion === nextVersion) {
      return { result: 'unchanged', changedFields: [] };
    }
    return {
      result: 'changed',
      changedFields: detectChangedFields(previous, next),
    };
  }

  const prevStr = previous as string | null;
  const nextStr = next as string;
  if (prevStr === null) return 'new';
  return prevStr === nextStr ? 'unchanged' : 'changed';
}
