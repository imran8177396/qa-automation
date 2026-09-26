/**
 * Property-based testing adapters (sample-only builtin; fast-check not installed).
 * Re-exports the tiny capabilities predicate runner so existing imports keep working.
 */

export {
  BuiltinSampleAdapter,
  FastCheckAdapter,
  type Property,
  type PropertyRunResult,
  type PropertyTestAdapter,
} from './adapter';

export {
  sortingAdjacentProperty,
  roundTripProperty,
  runPropertyChecks,
  type RunPropertyChecksInput,
} from './examples';

export {
  checkProperties,
  type PropertyCase,
} from '../capabilities/property';
