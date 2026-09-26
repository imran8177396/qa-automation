import type { TestTypeCategory } from './categories';

/**
 * How far an existing runner/stage covers this id.
 * PARTIAL = profile or stage exists with known gaps (auth gate, emulation-only, etc.).
 * NOT_IMPLEMENTED = registry row only — no dedicated engine.
 */
export type TestTypeImplementationStatus = 'IMPLEMENTED' | 'PARTIAL' | 'NOT_IMPLEMENTED';

/**
 * Canonical test-type ids. Every id is registered exactly once in the registry.
 * Do not invent runners for NOT_IMPLEMENTED ids.
 */
export const TEST_TYPE_IDS = [
  'functional',
  'integration',
  'contract',
  'database',
  'api',
  'ui',
  'e2e',
  'workflow',
  'unit',
  'smoke',
  'sanity',
  'regression',
  'performance',
  'baseline',
  'load',
  'stress',
  'spike',
  'endurance',
  'volume',
  'scalability',
  'security',
  'accessibility',
  'visual',
  'responsive',
  'compatibility',
  'localization',
  'reliability',
  'resilience',
  'failover',
  'recovery',
  'deployment',
  'rollback',
  'configuration',
  'ai',
  'llm',
  'rag',
  'agent',
  'ai-safety',
  'prompt-injection',
  'multi-tenant',
  'webhook',
  'queue',
  'property',
  'mutation',
  'race',
  'backup-restore',
  'privacy',
] as const;

export type TestTypeId = (typeof TEST_TYPE_IDS)[number];

export interface TestTypeDefinition {
  id: TestTypeId;
  category: TestTypeCategory;
  name: string;
  /** Short description of what this type covers. */
  description: string;
  status: TestTypeImplementationStatus;
  /** Existing npm script when a runner/stage covers this type; null when not. */
  npmScript: string | null;
  /** Optional accuracy note (auth gates, composition of other stages, etc.). */
  note?: string;
}
