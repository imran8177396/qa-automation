import path from 'path';
import { PATHS } from '../paths';
import { writeJson } from '../../discovery/write-json';
import type { PostmanAssertionFlag, PostmanRequestConfig, QaConfig } from '../../types';

const DERIVED_FLAG = 'TAUTOLOGICAL_ASSERTION';
const DOCUMENTED_FLAGS = new Set(['DOCUMENTED_INTENDED_STATUS', 'USER_CONFIRMED']);

export type AssertionOrigin = 'derived-from-observed' | 'documented-intended-status';

export interface ClassifiedAssertion {
  name: string;
  path: string;
  assertion: string;
  expected: number | string;
  lastObserved?: number | string;
  flags: string[];
  note: string;
  origin: AssertionOrigin;
}

export interface TautologicalAssertionsArtifact {
  generatedAt: string;
  /** Only assertions whose expected value was derived from last observed. P7 counts these. */
  items: ClassifiedAssertion[];
  documentedIntendedStatus: ClassifiedAssertion[];
  count: number;
  note: string;
}

function isDocumentedIntended(flags: string[]): boolean {
  return flags.some((flag) => DOCUMENTED_FLAGS.has(flag));
}

function isDerivedFromObserved(flags: string[]): boolean {
  return flags.includes(DERIVED_FLAG) && !isDocumentedIntended(flags);
}

function classifyFlag(request: PostmanRequestConfig, flag: PostmanAssertionFlag): ClassifiedAssertion {
  const origin: AssertionOrigin = isDocumentedIntended(flag.flags)
    ? 'documented-intended-status'
    : 'derived-from-observed';
  return {
    name: request.name,
    path: request.path,
    assertion: flag.assertion,
    expected: flag.expected,
    lastObserved: flag.lastObserved,
    flags: [...flag.flags],
    note: flag.note,
    origin,
  };
}

export function classifyAssertionFlags(config: QaConfig): {
  derivedFromObserved: ClassifiedAssertion[];
  documentedIntendedStatus: ClassifiedAssertion[];
} {
  const derivedFromObserved: ClassifiedAssertion[] = [];
  const documentedIntendedStatus: ClassifiedAssertion[] = [];

  for (const request of config.postman.requests) {
    for (const flag of request.assertionFlags ?? []) {
      const classified = classifyFlag(request, flag);
      if (isDocumentedIntended(flag.flags)) {
        documentedIntendedStatus.push(classified);
      } else if (isDerivedFromObserved(flag.flags)) {
        derivedFromObserved.push(classified);
      }
    }
  }

  return { derivedFromObserved, documentedIntendedStatus };
}

export function buildTautologicalArtifact(
  config: QaConfig,
  generatedAt = new Date().toISOString()
): TautologicalAssertionsArtifact {
  const { derivedFromObserved, documentedIntendedStatus } = classifyAssertionFlags(config);
  return {
    generatedAt,
    items: derivedFromObserved,
    documentedIntendedStatus,
    count: derivedFromObserved.length,
    note: 'items[] are derived-from-observed tautological assertions for the P7 quality check. documentedIntendedStatus[] are user-confirmed intended statuses and are not derived from last observed.',
  };
}

export function writeTautologicalArtifact(config: QaConfig): TautologicalAssertionsArtifact {
  const artifact = buildTautologicalArtifact(config);
  writeJson(path.join(PATHS.reports.quality, 'tautological-assertions.json'), artifact);
  return artifact;
}
