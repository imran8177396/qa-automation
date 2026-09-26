/**
 * Tiny pure property checker — not a substitute for a property-based library.
 * No network. No fast-check dependency.
 *
 * Prefer scripts/testing/property (BuiltinSampleAdapter) for the sample adapter.
 * This file keeps checkProperties for existing callers and re-exports the adapter.
 */

import { makeResult, type TestResult } from '../../core/engine-contract';

export interface PropertyCase {
  name: string;
  inputs: unknown[];
  predicate: (value: unknown) => boolean;
}

/**
 * Run each case's predicate over its inputs.
 * False predicate → FAIL (expected "predicate holds", actual "false").
 */
export function checkProperties(cases: PropertyCase[]): TestResult[] {
  return cases.map((c, index) => {
    const id = `property:${index}:${c.name}`;
    if (c.inputs.length === 0) {
      return makeResult({
        id,
        testType: 'property',
        category: 'advanced',
        name: c.name,
        status: 'NOT_TESTED',
        error: { message: 'no inputs provided for property case' },
        metadata: { reason: 'no inputs provided for property case' },
      });
    }

    for (const value of c.inputs) {
      if (!c.predicate(value)) {
        return makeResult({
          id,
          testType: 'property',
          category: 'advanced',
          name: c.name,
          status: 'FAIL',
          assertion: { expected: 'predicate holds', actual: 'false' },
          error: { message: `predicate failed for input: ${summarize(value)}` },
        });
      }
    }

    return makeResult({
      id,
      testType: 'property',
      category: 'advanced',
      name: c.name,
      status: 'PASS',
      assertion: { expected: 'predicate holds', actual: 'true' },
    });
  });
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export {
  BuiltinSampleAdapter,
  FastCheckAdapter,
  type Property,
  type PropertyRunResult,
  type PropertyTestAdapter,
} from '../property/adapter';
export {
  sortingAdjacentProperty,
  roundTripProperty,
  runPropertyChecks,
  type RunPropertyChecksInput,
} from '../property/examples';

