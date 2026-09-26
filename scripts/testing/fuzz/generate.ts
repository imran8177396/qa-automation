/**
 * Fuzz input generation only — does not send HTTP, open browsers, or touch a target.
 * Reuses boundary/negative generators; adds structured kinds for API/UI/form/database/security.
 */

import { buildBoundaryCases } from '../boundary-cases';
import { buildNegativeCases } from '../negative-cases';

/** Documented length of the very-long fuzz string. */
export const FUZZ_VERY_LONG_LENGTH = 10_000;

export type FuzzTarget = 'api' | 'ui' | 'form' | 'database' | 'security';

export interface FuzzInput {
  id: string;
  target: FuzzTarget | 'any';
  kind:
    | 'very-long-string'
    | 'unicode'
    | 'special-characters'
    | 'null'
    | 'empty'
    | 'unexpected-type'
    | 'large-number'
    | 'negative-number'
    | 'malformed-json'
    | 'nested-object'
    | 'array'
    | 'boundary';
  value: unknown;
  /** How a caller should apply it. Not an instruction to attack. */
  note: string;
}

const SECURITY_NOTE =
  'input generation only; not an exploit payload and not executed';

function buildSharedCatalog(): FuzzInput[] {
  const out: FuzzInput[] = [];

  const push = (
    id: string,
    kind: FuzzInput['kind'],
    value: unknown,
    note: string
  ): void => {
    out.push({ id, target: 'any', kind, value, note });
  };

  // Reuse boundary helpers for min/max/0/empty-style values.
  const boundaryCases = buildBoundaryCases({ name: 'fuzz' });
  const zeroBoundary = boundaryCases.find((c) => c.id === 'fuzz:0');
  if (zeroBoundary) {
    push(
      'boundary:zero',
      'boundary',
      zeroBoundary.value,
      `boundary zero from buildBoundaryCases (${zeroBoundary.description})`
    );
  } else {
    push('boundary:zero', 'boundary', 0, 'boundary zero');
  }

  const whitespaceBoundary = boundaryCases.find((c) => c.id === 'fuzz:whitespace');
  if (whitespaceBoundary) {
    push(
      'boundary:whitespace',
      'special-characters',
      whitespaceBoundary.value,
      `whitespace-only from buildBoundaryCases (${whitespaceBoundary.description})`
    );
  }

  // Reuse negative helpers for null / empty / wrong-type inspiration.
  const negativeCases = buildNegativeCases({ name: 'fuzz', type: 'string' });
  const nullNeg = negativeCases.find((c) => c.kind === 'null');
  const emptyNeg = negativeCases.find((c) => c.kind === 'empty');
  const wrongTypeNeg = negativeCases.find((c) => c.kind === 'wrong-type');

  push(
    'null',
    'null',
    nullNeg?.value ?? null,
    nullNeg
      ? `null from buildNegativeCases (${nullNeg.description})`
      : 'null value'
  );
  push(
    'empty',
    'empty',
    emptyNeg?.value ?? '',
    emptyNeg
      ? `empty string from buildNegativeCases (${emptyNeg.description})`
      : 'empty string'
  );

  push(
    'very-long-string',
    'very-long-string',
    'a'.repeat(FUZZ_VERY_LONG_LENGTH),
    `very long string of length ${FUZZ_VERY_LONG_LENGTH} (character a)`
  );

  push('unicode', 'unicode', 'café😀', 'non-ascii unicode including café and emoji outside BMP');

  push(
    'special-characters',
    'special-characters',
    `"'\\/\n\t`,
    'punctuation and whitespace only; not an exploit payload'
  );

  push(
    'unexpected-type:number',
    'unexpected-type',
    wrongTypeNeg?.value ?? 12345,
    wrongTypeNeg
      ? `unexpected type from buildNegativeCases (${wrongTypeNeg.description})`
      : 'number where a string is typical'
  );
  push(
    'unexpected-type:object',
    'unexpected-type',
    { unexpected: true },
    'object where a scalar is typical'
  );

  push(
    'large-number',
    'large-number',
    Number.MAX_SAFE_INTEGER,
    `large finite number Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER})`
  );

  push('negative-number', 'negative-number', -1, 'negative number -1');

  push('malformed-json:open-brace', 'malformed-json', '{', 'malformed JSON string: single open brace');
  push(
    'malformed-json:partial-object',
    'malformed-json',
    '{"a":',
    'malformed JSON string: incomplete object'
  );

  push(
    'nested-object',
    'nested-object',
    { a: { b: { c: 1 } } },
    'nested object with depth 3 (a.b.c)'
  );

  push('array', 'array', [1, 'x', null], 'heterogeneous array [1, \'x\', null]');

  return out;
}

/**
 * Unexpected values for fuzz-style checks. No exploit payloads. No network.
 * When `target` is omitted, returns the shared catalog (each item `target: 'any'`).
 * When set, returns that list tagged for the target, plus any target-specific note.
 */
export function generateFuzzInputs(target?: FuzzTarget): FuzzInput[] {
  const shared = buildSharedCatalog();

  if (!target) {
    return shared;
  }

  const tagged = shared.map((item) => ({
    ...item,
    target,
    note:
      target === 'security'
        ? `${item.note}; ${SECURITY_NOTE}`
        : item.note,
  }));

  if (target === 'api') {
    tagged.push({
      id: 'api:note',
      target: 'api',
      kind: 'unexpected-type',
      value: false,
      note: 'api-only: boolean where a string body field is typical',
    });
  }

  if (target === 'security') {
    // Ensure every security note carries the required disclaimer wording.
    for (const item of tagged) {
      if (!/not an exploit|not executed/i.test(item.note)) {
        item.note = `${item.note}; ${SECURITY_NOTE}`;
      }
    }
  }

  return tagged;
}
