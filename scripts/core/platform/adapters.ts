/**
 * Tool adapter registry — extends the platform plugin architecture.
 *
 * Core Engine
 *     │
 *     ├── Playwright Adapter  (npm: test:e2e)
 *     ├── Postman Adapter     (npm: test:api)
 *     ├── JMeter Adapter      (npm: test:performance)
 *     ├── Database Adapter
 *     ├── Contract Adapter
 *     ├── Queue Adapter       (re-exports InMemory / Kafka / Redis / RabbitMQ)
 *     ├── AI Adapter
 *     └── Future Adapters     (registerAdapter)
 *
 * This module does NOT import playwright, postman/newman, jmeter, kafkajs, redis,
 * amqplib, fast-check, openai, or any AI SDK. Availability is a caller snapshot
 * or a pure probe. Default run() never shells out and never fakes PASS.
 *
 * Availability rules:
 * - REQUIRES_CONFIGURATION — chosen adapter missing a user setting in the snapshot.
 * - BLOCKED — cannot execute even with config (not wired / not implemented / driver absent).
 * - available + no execute stub → BLOCKED "execution was not performed".
 * - PASS only when an execute stub (or caller-supplied real result) returns PASS.
 */

import {
  BUILTIN_ADAPTER_IDS,
  type AdapterAvailability,
  type AdapterDefinition,
  type AdapterId,
  type AdapterRunRequest,
  type AdapterRunResult,
  type AdapterToolSnapshot,
  type BuiltinAdapterId,
} from './plugin-sdk';

export type {
  AdapterAvailability,
  AdapterAvailabilityState,
  AdapterDefinition,
  AdapterId,
  AdapterResultStatus,
  AdapterRunRequest,
  AdapterRunResult,
  AdapterToolSnapshot,
  BuiltinAdapterId,
} from './plugin-sdk';

export { BUILTIN_ADAPTER_IDS } from './plugin-sdk';

/**
 * Reason strings aligned with scripts/testing/capabilities/queue-flow.ts
 * (KafkaAdapter / RedisAdapter / RabbitMQAdapter). Callers should import those
 * classes from queue-flow (re-exported via platform/index) — this module does
 * not duplicate the adapter classes or import broker SDKs.
 */
const QUEUE_KAFKA_REASON =
  'Kafka adapter is not implemented; kafkajs is not installed';
const QUEUE_REDIS_REASON =
  'Redis adapter is not implemented; redis client is not installed';
const QUEUE_RABBITMQ_REASON =
  'RabbitMQ adapter is not implemented; amqplib is not installed';

const EXECUTION_NOT_PERFORMED = 'execution was not performed';
const ADAPTER_NOT_REGISTERED = 'adapter not registered';

const DATABASE_NOT_WIRED =
  'database adapter is not wired; no driver connection is opened';
const AI_NOT_IMPLEMENTED = 'ai adapter is not implemented';
const CONTRACT_NOT_INVOKED = 'contract execution is not invoked from the adapter';

function blocked(adapterId: AdapterId, reason: string, npmScript?: string): AdapterRunResult {
  return {
    adapterId,
    status: 'BLOCKED',
    reason,
    passed: false,
    ...(npmScript ? { npmScript } : {}),
  };
}

function requiresConfiguration(
  adapterId: AdapterId,
  reason: string,
  npmScript?: string
): AdapterRunResult {
  return {
    adapterId,
    status: 'REQUIRES_CONFIGURATION',
    reason,
    passed: false,
    ...(npmScript ? { npmScript } : {}),
  };
}

/**
 * Shared run path: honour availability, never fake PASS without execute.
 */
async function runFromAvailability(
  definition: AdapterDefinition,
  request: AdapterRunRequest
): Promise<AdapterRunResult> {
  const availability =
    request.availability ?? definition.probe(request.snapshot);

  if (availability.state === 'requires-configuration') {
    return requiresConfiguration(
      definition.id,
      availability.reason ?? 'required configuration is missing',
      definition.npmScript
    );
  }

  if (availability.state === 'blocked') {
    return blocked(
      definition.id,
      availability.reason ?? 'adapter is blocked',
      definition.npmScript
    );
  }

  // state === 'available'
  if (!request.execute) {
    return blocked(definition.id, EXECUTION_NOT_PERFORMED, definition.npmScript);
  }

  const result = await request.execute();
  return {
    ...result,
    adapterId: definition.id,
    // Never claim passed unless status is explicitly PASS from the stub/runner.
    passed: result.status === 'PASS' ? true : false,
    ...(definition.npmScript && result.npmScript === undefined
      ? { npmScript: definition.npmScript }
      : {}),
  };
}

function defineAdapter(
  partial: Omit<AdapterDefinition, 'run'> & {
    run?: AdapterDefinition['run'];
  }
): AdapterDefinition {
  const definition: AdapterDefinition = {
    ...partial,
    run: async (request) => runFromAvailability(definition, request),
  };
  return definition;
}

function probePlaywright(snapshot?: AdapterToolSnapshot): AdapterAvailability {
  if (!snapshot?.baseURL) {
    return {
      state: 'requires-configuration',
      reason: 'Playwright baseURL is missing',
    };
  }
  if (snapshot.browserBinaryPresent !== true) {
    return {
      state: 'requires-configuration',
      reason: 'Playwright browser binary is not provided in the snapshot',
    };
  }
  return { state: 'available' };
}

function probePostman(snapshot?: AdapterToolSnapshot): AdapterAvailability {
  if (snapshot?.postmanCliPresent !== true) {
    return {
      state: 'requires-configuration',
      reason: 'Postman CLI is missing',
    };
  }
  if (snapshot.collectionPathPresent !== true) {
    return {
      state: 'requires-configuration',
      reason: 'Postman collection is missing',
    };
  }
  return { state: 'available' };
}

function probeJmeter(snapshot?: AdapterToolSnapshot): AdapterAvailability {
  if (snapshot?.jmeterBinaryPresent !== true) {
    return {
      state: 'requires-configuration',
      reason: 'JMeter binary is missing',
    };
  }
  if (snapshot.planPathPresent !== true) {
    return {
      state: 'requires-configuration',
      reason: 'JMeter plan is missing',
    };
  }
  return { state: 'available' };
}

function probeDatabase(snapshot?: AdapterToolSnapshot): AdapterAvailability {
  if (snapshot?.databaseUrlPresent !== true) {
    return {
      state: 'requires-configuration',
      reason: 'DATABASE_URL is missing',
    };
  }
  // URL present still does not open a driver connection.
  return { state: 'blocked', reason: DATABASE_NOT_WIRED };
}

function probeContract(snapshot?: AdapterToolSnapshot): AdapterAvailability {
  if (snapshot?.contractSpecPathPresent !== true) {
    return {
      state: 'requires-configuration',
      reason: 'contract spec path is missing',
    };
  }
  return { state: 'blocked', reason: CONTRACT_NOT_INVOKED };
}

function probeQueue(snapshot?: AdapterToolSnapshot): AdapterAvailability {
  const kind = snapshot?.queueKind ?? 'generic';
  if (kind === 'generic') {
    // Matches InMemoryQueueAdapter.available === true (classification only).
    return {
      state: 'available',
      reason: 'in-memory queue adapter only; no broker connection',
    };
  }
  if (kind === 'kafka') {
    return { state: 'blocked', reason: QUEUE_KAFKA_REASON };
  }
  if (kind === 'redis') {
    return { state: 'blocked', reason: QUEUE_REDIS_REASON };
  }
  return { state: 'blocked', reason: QUEUE_RABBITMQ_REASON };
}

function probeAi(_snapshot?: AdapterToolSnapshot): AdapterAvailability {
  return { state: 'blocked', reason: AI_NOT_IMPLEMENTED };
}

function createBuiltinAdapters(): AdapterDefinition[] {
  return [
    defineAdapter({
      id: 'playwright',
      npmScript: 'test:e2e',
      description:
        'Describes Playwright E2E invocation (npm run test:e2e). Does not spawn Playwright.',
      probe: probePlaywright,
    }),
    defineAdapter({
      id: 'postman',
      npmScript: 'test:api',
      description:
        'Describes Postman/API invocation (npm run test:api). Does not spawn Postman CLI.',
      probe: probePostman,
    }),
    defineAdapter({
      id: 'jmeter',
      npmScript: 'test:performance',
      description:
        'Describes JMeter performance invocation (npm run test:performance). Does not spawn JMeter.',
      probe: probeJmeter,
    }),
    defineAdapter({
      id: 'database',
      npmScript: 'test:database',
      description:
        'Database adapter is not wired; never opens a driver connection from the core.',
      probe: probeDatabase,
    }),
    defineAdapter({
      id: 'contract',
      npmScript: 'test:contract',
      description:
        'Contract adapter documents a spec path; does not invoke the contract suite.',
      probe: probeContract,
    }),
    defineAdapter({
      id: 'queue',
      npmScript: 'test:queue',
      description:
        'Queue adapter: in-memory may be available; Kafka/Redis/RabbitMQ stay blocked (existing adapters).',
      probe: probeQueue,
    }),
    defineAdapter({
      id: 'ai',
      npmScript: 'test:ai',
      description: 'AI adapter is not implemented; no AI SDK is loaded.',
      probe: probeAi,
    }),
  ];
}

/**
 * Registry map is the extension point — no switch that imports each tool.
 * Registering an adapter does not execute it.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, AdapterDefinition>();

  constructor(seedBuiltins = true) {
    if (seedBuiltins) {
      for (const adapter of createBuiltinAdapters()) {
        this.adapters.set(adapter.id, adapter);
      }
    }
  }

  register(definition: AdapterDefinition): void {
    if (this.adapters.has(definition.id)) {
      throw new Error(`Duplicate adapter id: ${definition.id}`);
    }
    this.adapters.set(definition.id, definition);
  }

  get(id: AdapterId): AdapterDefinition | undefined {
    return this.adapters.get(id);
  }

  list(): AdapterId[] {
    return [...this.adapters.keys()];
  }

  async run(request: AdapterRunRequest): Promise<AdapterRunResult> {
    const definition = this.adapters.get(request.adapterId);
    if (!definition) {
      return blocked(request.adapterId, ADAPTER_NOT_REGISTERED);
    }
    return definition.run({ ...request, adapterId: definition.id });
  }
}

/** Fresh registry with the seven built-in adapters. Prefer this in unit tests. */
export function createAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry(true);
}

const defaultRegistry = createAdapterRegistry();

/** Register a future adapter on the default registry. Does not execute. Duplicate id throws. */
export function registerAdapter(definition: AdapterDefinition): void {
  defaultRegistry.register(definition);
}

/** Built-in seven plus any adapters registered on the default registry. */
export function listAdapters(): AdapterId[] {
  return defaultRegistry.list();
}

/** Run by id on the default registry. Unknown id → BLOCKED, run not called. */
export async function runAdapter(request: AdapterRunRequest): Promise<AdapterRunResult> {
  return defaultRegistry.run(request);
}

export function getDefaultAdapterRegistry(): AdapterRegistry {
  return defaultRegistry;
}

export function isBuiltinAdapterId(id: string): id is BuiltinAdapterId {
  return (BUILTIN_ADAPTER_IDS as readonly string[]).includes(id);
}
