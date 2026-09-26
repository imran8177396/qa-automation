/**
 * Advanced testing capabilities registry.
 *
 * SaaS note: multi-tenant isolation, idempotency, and webhook verification are the
 * capabilities intended for SaaS apps; they compare caller-supplied evidence and do
 * not call the target.
 */

import { generateFuzzInputs } from './fuzz';
import {
  checkProperties,
  BuiltinSampleAdapter,
  FastCheckAdapter,
  sortingAdjacentProperty,
  roundTripProperty,
  runPropertyChecks,
} from './property';
import {
  planMutation,
  mutateSnippet,
  planFileMutation,
  runMutationChecks,
} from './mutation';
import {
  planRace,
  runRaceChecks,
  formatInterleavingEvidence,
  findWaitForCycle,
  applyInterleaving,
  sequentializeByActor,
} from './race';
import { compareTenantIsolation } from './tenant-isolation';
import { runMultiTenantChecks } from './multi-tenant';
import { compareIdempotentResponses } from './idempotency';
import {
  signWebhook,
  verifyWebhook,
  classifyWebhookDelivery,
  duplicateEventIds,
  runWebhookFlow,
  runWebhookChecks,
} from './webhook';
import { classifyQueueMessage } from './queue';
import {
  runQueueFlow,
  runQueueChecks,
  InMemoryQueueAdapter,
  KafkaAdapter,
  RedisAdapter,
  RabbitMQAdapter,
} from './queue-flow';
import {
  planBackupRestore,
  runBackupRestoreChecks,
  firstDifferingPath,
} from './backup-restore';
import { scanSensitiveKeys, planPrivacyRetention, runPrivacyChecks, classifyPrivacyEvidence } from './privacy';

export type CapabilityImplStatus = 'IMPLEMENTED' | 'PARTIAL' | 'NOT_IMPLEMENTED';

export interface TestingCapability {
  id: string;
  purpose: string;
  status: CapabilityImplStatus;
  /** One-line limitation / honesty note. */
  limitation: string;
}

/**
 * Catalog of testing capabilities. None are IMPLEMENTED against a live system;
 * PARTIAL means a pure check or generator runs and live execution is refused.
 * NOT_IMPLEMENTED means only a reason is returned.
 */
export const TESTING_CAPABILITIES: readonly TestingCapability[] = [
  {
    id: 'fuzz',
    purpose: 'Generate unexpected inputs for fuzz-style checks',
    status: 'PARTIAL',
    limitation:
      'input generation only via scripts/testing/fuzz generateFuzzInputs; not executed against a target',
  },
  {
    id: 'property',
    purpose: 'Adapter over caller-supplied samples (builtin); fast-check not installed',
    status: 'PARTIAL',
    limitation:
      'adapter over caller-supplied samples; fast-check is not installed; this is not a property-testing framework',
  },
  {
    id: 'mutation',
    purpose: 'Optional in-memory mutants with caller-supplied detection',
    status: 'PARTIAL',
    limitation:
      'in-memory snippets and caller-supplied detection only; file mutation and suite re-run are not implemented; not part of the default PR suite',
  },

  {
    id: 'race',
    purpose: 'Optional deterministic in-memory concurrency model with caller-supplied interleavings',
    status: 'PARTIAL',
    limitation:
      'architecture + deterministic in-memory model; live multi-process races are not executed; does not prove absence of races in production',
  },
  {
    id: 'tenant-isolation',
    purpose: 'Compare caller-supplied bodies for cross-tenant id leakage',
    status: 'PARTIAL',
    limitation: 'compares caller-supplied evidence only; does not call the target',
  },
  {
    id: 'idempotency',
    purpose: 'Compare two captured responses for idempotent resource ids',
    status: 'PARTIAL',
    limitation: 'live repeated requests are not sent because they can create duplicate operations',
  },
  {
    id: 'webhook',
    purpose: 'Optional local signature and delivery classification (no live receiver)',
    status: 'PARTIAL',
    limitation: 'local crypto and in-memory flow only; does not open a port or call a webhook URL',
  },
  {
    id: 'queue',
    purpose: 'Generic in-memory queue classification; Kafka/Redis/RabbitMQ adapters not implemented',
    status: 'PARTIAL',
    limitation: 'generic in-memory only; no queue broker is connected; kafkajs/redis/amqplib not installed',
  },
  {
    id: 'backup-restore',
    purpose: 'Optional evidence-only backup/restore infrastructure checks',
    status: 'PARTIAL',
    limitation:
      'caller evidence only; live backup/restore is not executed; production data is never deleted; does not take a backup, restore a database, or prove a production backup is valid',
  },
  {
    id: 'privacy',
    purpose: 'Optional evidence-only privacy checks (PII keys, sensitive API fields, secret/password logs, deletion, retention, export)',
    status: 'PARTIAL',
    limitation:
      'caller evidence only; live deletion, retention enforcement, and export jobs are not executed; key-name checks are not a full privacy audit; does not scan a live API',
  },
] as const;

export {
  generateFuzzInputs,
  checkProperties,
  BuiltinSampleAdapter,
  FastCheckAdapter,
  sortingAdjacentProperty,
  roundTripProperty,
  runPropertyChecks,
  planMutation,
  mutateSnippet,
  planFileMutation,
  runMutationChecks,
  planRace,
  runRaceChecks,
  formatInterleavingEvidence,
  findWaitForCycle,
  applyInterleaving,
  sequentializeByActor,
  compareTenantIsolation,
  runMultiTenantChecks,
  compareIdempotentResponses,
  signWebhook,
  verifyWebhook,
  classifyWebhookDelivery,
  duplicateEventIds,
  runWebhookFlow,
  runWebhookChecks,
  classifyQueueMessage,
  runQueueFlow,
  runQueueChecks,
  InMemoryQueueAdapter,
  KafkaAdapter,
  RedisAdapter,
  RabbitMQAdapter,
  planBackupRestore,
  runBackupRestoreChecks,
  firstDifferingPath,
  scanSensitiveKeys,
  planPrivacyRetention,
  runPrivacyChecks,
  classifyPrivacyEvidence,
};

export type {
  Property,
  PropertyRunResult,
  PropertyTestAdapter,
  RunPropertyChecksInput,
} from './property';
export type {
  MutationCase,
  MutationReport,
  FileMutationPlan,
  RunMutationChecksInput,
} from './mutation';
export type {
  RaceScenario,
  RaceStep,
  RaceInvariant,
  RaceWaitForEdge,
  RaceModelOptions,
  RunRaceChecksInput,
  RaceScenarioKind,
} from './race';
export { RACE_CHECK_IDS, RACE_SCENARIO_KINDS } from './race';
export type {
  TenantIdentity,
  MultiTenantCase,
  RunMultiTenantChecksInput,
} from './multi-tenant';
export { MULTI_TENANT_CHECK_IDS } from './multi-tenant';
export type {
  WebhookFlowDelivery,
  RunWebhookFlowInput,
} from './webhook';
export { WEBHOOK_CHECK_IDS } from './webhook';
export type {
  QueueMessage,
  QueueAdapter,
  QueueObservation,
  RunQueueFlowInput,
} from './queue-flow';
export { QUEUE_CHECK_IDS } from './queue-flow';
export type {
  BackupRestoreEvidence,
  IsolatedTargetDescriptor,
  RunBackupRestoreChecksInput,
  BackupRestoreHooks,
} from './backup-restore';
export {
  BACKUP_RESTORE_CHECK_IDS,
  ISOLATED_BACKUP_ENVIRONMENTS,
} from './backup-restore';
export type {
  PrivacyEvidence,
  PrivacyLogEntry,
  PrivacyHooks,
  RunPrivacyChecksInput,
} from './privacy';
export {
  PRIVACY_CHECK_IDS,
  PII_FIELD_KEYS,
  SENSITIVE_API_FIELD_KEYS,
} from './privacy';

export function getCapability(id: string): TestingCapability | undefined {
  return TESTING_CAPABILITIES.find((c) => c.id === id);
}
