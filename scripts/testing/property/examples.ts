/**
 * Example properties for the sample-based adapter.
 * These are not a property-testing framework — they only check supplied samples.
 */

import type { Property, PropertyRunResult, PropertyTestAdapter } from './adapter';

/**
 * Checks that sorting a copy ascending never decreases between adjacent values.
 * Note: the predicate sorts a copy of the input; it verifies the sorted result,
 * not that Array.prototype.sort mutates (or does not mutate) the original array.
 */
export function sortingAdjacentProperty(samples: number[][]): Property<number[]> {
  return {
    name: 'sorting ascending never decreases between adjacent values',
    samples,
    predicate: (value) => {
      const sorted = [...value].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i]! > sorted[i + 1]!) return false;
      }
      return true;
    },
  };
}

export function roundTripProperty(
  samples: string[],
  encode: (s: string) => string,
  decode: (s: string) => string
): Property<string> {
  return {
    name: 'encoding then decoding returns the original value',
    samples,
    predicate: (value) => decode(encode(value)) === value,
  };
}

export interface RunPropertyChecksInput {
  enabled: boolean;
  adapter: PropertyTestAdapter;
  /** Caller-supplied properties; each is run through the adapter when enabled and available. */
  properties: Property<any>[];
}

/**
 * Gate + adapter availability, then run each property.
 * Disabled → NOT_APPLICABLE. Unavailable adapter → BLOCKED (properties not run as PASS).
 */
export async function runPropertyChecks(
  input: RunPropertyChecksInput
): Promise<PropertyRunResult[]> {
  if (input.enabled !== true) {
    return [
      {
        name: 'property:not-enabled',
        status: 'NOT_APPLICABLE',
        reason: 'property-based testing is not enabled for this application',
      },
    ];
  }

  if (!input.adapter.available) {
    return [
      {
        name: 'property:adapter',
        status: 'BLOCKED',
        reason:
          input.adapter.reason ??
          'property adapter is not available',
      },
    ];
  }

  const results: PropertyRunResult[] = [];
  for (const property of input.properties) {
    results.push(await input.adapter.run(property));
  }
  return results;
}
