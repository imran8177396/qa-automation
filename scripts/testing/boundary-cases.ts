/**
 * Pure boundary-case generators for contract / form engines.
 * Data-only — no I/O. Importable by future UI/form engines.
 */

export interface BoundaryFieldSpec {
  name: string;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
}

export interface BoundaryCase {
  id: string;
  description: string;
  value: unknown;
}

/**
 * Build boundary cases for one field.
 * When min/max (or length bounds) are omitted, still emits 0, -1, null, empty,
 * whitespace, large, special, and unicode cases.
 */
export function buildBoundaryCases(field: BoundaryFieldSpec): BoundaryCase[] {
  const { name } = field;
  const cases: BoundaryCase[] = [];

  const numericMin = field.min ?? field.minLength;
  const numericMax = field.max ?? field.maxLength;
  const useLength = field.minLength !== undefined || field.maxLength !== undefined;

  if (numericMin !== undefined) {
    cases.push({
      id: `${name}:min`,
      description: `Minimum boundary for "${name}"`,
      value: useLength && field.min === undefined ? 'x'.repeat(numericMin) : numericMin,
    });
    cases.push({
      id: `${name}:min-1`,
      description: `Just below minimum for "${name}"`,
      value:
        useLength && field.min === undefined
          ? 'x'.repeat(Math.max(0, numericMin - 1))
          : numericMin - 1,
    });
    cases.push({
      id: `${name}:min+1`,
      description: `Just above minimum for "${name}"`,
      value:
        useLength && field.min === undefined ? 'x'.repeat(numericMin + 1) : numericMin + 1,
    });
  }

  if (numericMax !== undefined) {
    cases.push({
      id: `${name}:max`,
      description: `Maximum boundary for "${name}"`,
      value: useLength && field.max === undefined ? 'x'.repeat(numericMax) : numericMax,
    });
    cases.push({
      id: `${name}:max-1`,
      description: `Just below maximum for "${name}"`,
      value:
        useLength && field.max === undefined
          ? 'x'.repeat(Math.max(0, numericMax - 1))
          : numericMax - 1,
    });
    cases.push({
      id: `${name}:max+1`,
      description: `Just above maximum for "${name}"`,
      value:
        useLength && field.max === undefined ? 'x'.repeat(numericMax + 1) : numericMax + 1,
    });
  }

  cases.push(
    {
      id: `${name}:0`,
      description: `Zero for "${name}"`,
      value: 0,
    },
    {
      id: `${name}:-1`,
      description: `Negative one for "${name}"`,
      value: -1,
    },
    {
      id: `${name}:null`,
      description: `Null boundary for "${name}"`,
      value: null,
    },
    {
      id: `${name}:empty`,
      description: `Empty string boundary for "${name}"`,
      value: '',
    },
    {
      id: `${name}:whitespace`,
      description: `Whitespace-only boundary for "${name}"`,
      value: '   ',
    },
    {
      id: `${name}:large`,
      description: `Large value for "${name}"`,
      value: 'L'.repeat(10_000),
    },
    {
      id: `${name}:special-chars`,
      description: `Special characters for "${name}"`,
      value: `!@#$%^&*()_+[]{};:'",.<>/?\\\`~`,
    },
    {
      id: `${name}:unicode`,
      description: `Unicode characters for "${name}"`,
      value: '边界テスト🚀café',
    }
  );

  return cases;
}
