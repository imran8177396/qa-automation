/**
 * Property-testing adapters.
 *
 * BuiltinSampleAdapter only evaluates caller-supplied samples — it does not
 * generate random values or shrink. FastCheckAdapter is intentionally
 * unavailable (the fast-check package is not installed); it never loads that library.
 */

export interface Property<T> {
  name: string;
  /** Caller-supplied samples. The built-in adapter only checks these. It does not generate random values. */
  samples: T[];
  predicate: (value: T) => boolean;
}

export interface PropertyRunResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'NOT_TESTED' | 'BLOCKED' | 'NOT_APPLICABLE';
  reason: string;
  /** Failing sample when status is FAIL. Do not omit it. */
  counterexample?: unknown;
}

export interface PropertyTestAdapter {
  readonly kind: 'builtin-samples' | 'fast-check';
  readonly available: boolean;
  reason?: string;
  run<T>(property: Property<T>): Promise<PropertyRunResult>;
}

const FAST_CHECK_REASON =
  'fast-check is not installed; random property generation is not available';

/** Evaluates caller-supplied samples only — no generation, no shrinking. */
export class BuiltinSampleAdapter implements PropertyTestAdapter {
  readonly kind = 'builtin-samples' as const;
  readonly available = true;

  async run<T>(property: Property<T>): Promise<PropertyRunResult> {
    if (property.samples.length === 0) {
      return {
        name: property.name,
        status: 'NOT_TESTED',
        reason: 'no samples were supplied',
      };
    }

    for (const sample of property.samples) {
      if (!property.predicate(sample)) {
        return {
          name: property.name,
          status: 'FAIL',
          reason: 'property failed',
          counterexample: sample,
        };
      }
    }

    return {
      name: property.name,
      status: 'PASS',
      reason: `all ${property.samples.length} samples satisfied ${property.name}`,
    };
  }
}

/**
 * Placeholder for a fast-check-backed adapter.
 * Always unavailable — does not import or load the fast-check package.
 */
export class FastCheckAdapter implements PropertyTestAdapter {
  readonly kind = 'fast-check' as const;
  readonly available = false;
  readonly reason = FAST_CHECK_REASON;

  async run<T>(property: Property<T>): Promise<PropertyRunResult> {
    return {
      name: property.name,
      status: 'BLOCKED',
      reason: FAST_CHECK_REASON,
    };
  }
}
