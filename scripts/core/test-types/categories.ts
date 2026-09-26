/**
 * High-level buckets for the centralized test-type registry.
 * Stable string-union — used for grouping, not a second result format.
 */

export const TEST_TYPE_CATEGORIES = [
  'functional',
  'performance',
  'specialized',
  'resilience',
  'release',
  'ai',
] as const;

export type TestTypeCategory = (typeof TEST_TYPE_CATEGORIES)[number];
