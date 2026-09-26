/**
 * Generic in-memory queue/async classification.
 * No broker connection. Does not import net, kafkajs, redis, or amqplib.
 */

import {
  makeResult,
  type EngineResultStatus,
  type TestResult,
} from '../../core/engine-contract';
import { classifyQueueMessage } from './queue';

export interface QueueMessage {
  id: string;
  attempt?: number;
  sequence?: number;
  duplicate?: boolean;
  acked?: boolean;
  deadLetter?: boolean;
  failed?: boolean;
}

export interface QueueObservation {
  id: string;
  published: boolean;
  consumed: boolean;
  processing: boolean;
  acknowledged: boolean;
  retry: boolean;
  deadLetter: boolean;
  duplicate: boolean;
  outOfOrder: boolean;
}

export interface QueueAdapter {
  readonly kind: 'generic' | 'kafka' | 'redis' | 'rabbitmq';
  readonly available: boolean;
  /** Why unavailable. Required when available is false. */
  reason?: string;
  /**
   * In-memory only. Must not open sockets.
   * Unavailable adapters reject or return NOT_IMPLEMENTED without I/O.
   */
  apply(messages: QueueMessage[]): Promise<QueueObservation[]>;
}

export const QUEUE_CHECK_IDS = {
  notEnabled: 'queue:not-enabled',
  adapter: 'queue:adapter',
  messages: 'queue:messages',
  published: 'queue:published',
  consumed: 'queue:consumed',
  processing: 'queue:processing',
  acknowledgement: 'queue:acknowledgement',
  retry: 'queue:retry',
  deadLetter: 'queue:dead-letter',
  duplicate: 'queue:duplicate',
  outOfOrder: 'queue:out-of-order',
} as const;

const TEST_TYPE = 'queue';
const CATEGORY = 'advanced';
const CLASSIFIED_NO_WORKER = 'classified from supplied messages; no worker was started';

function queueResult(
  id: string,
  name: string,
  status: EngineResultStatus,
  options: {
    reason?: string;
    assertion?: { expected?: unknown; actual?: unknown };
    metadata?: Record<string, unknown>;
  } = {}
): TestResult {
  const reason = options.reason;
  return makeResult({
    id,
    testType: TEST_TYPE,
    category: CATEGORY,
    name,
    status,
    ...(options.assertion ? { assertion: options.assertion } : {}),
    ...(reason
      ? { error: { message: reason }, metadata: { ...(options.metadata ?? {}), reason } }
      : options.metadata
        ? { metadata: options.metadata }
        : {}),
  });
}

function idCounts(messages: QueueMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of messages) {
    counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  }
  return counts;
}

function isDuplicateMessage(m: QueueMessage, counts: Map<string, number>): boolean {
  if ((counts.get(m.id) ?? 0) > 1) return true;
  return classifyQueueMessage({ duplicate: m.duplicate === true ? true : undefined }) === 'duplicate';
}

function isOutOfOrderAt(
  m: QueueMessage,
  prevSequence: number | undefined
): boolean {
  if (typeof m.sequence !== 'number' || prevSequence === undefined) return false;
  if (m.sequence > prevSequence) return false;
  return (
    classifyQueueMessage({
      sequence: m.sequence,
      expectedSequence: prevSequence + 1,
    }) === 'out-of-order'
  );
}

/**
 * Generic in-memory adapter — classification only, no sockets.
 */
export class InMemoryQueueAdapter implements QueueAdapter {
  readonly kind = 'generic' as const;
  readonly available = true;

  async apply(messages: QueueMessage[]): Promise<QueueObservation[]> {
    const counts = idCounts(messages);
    const out: QueueObservation[] = [];
    let prevSequence: number | undefined;

    for (const m of messages) {
      const outOfOrder = isOutOfOrderAt(m, prevSequence);
      if (typeof m.sequence === 'number') {
        prevSequence = m.sequence;
      }
      out.push({
        id: m.id,
        published: true,
        consumed: true,
        processing: true,
        acknowledged: m.acked === true,
        retry: typeof m.attempt === 'number' && m.attempt > 1,
        deadLetter: m.deadLetter === true,
        duplicate: isDuplicateMessage(m, counts),
        outOfOrder,
      });
    }
    return out;
  }
}

export class KafkaAdapter implements QueueAdapter {
  readonly kind = 'kafka' as const;
  readonly available = false;
  readonly reason = 'Kafka adapter is not implemented; kafkajs is not installed';

  async apply(_messages: QueueMessage[]): Promise<QueueObservation[]> {
    return [];
  }
}

export class RedisAdapter implements QueueAdapter {
  readonly kind = 'redis' as const;
  readonly available = false;
  readonly reason = 'Redis adapter is not implemented; redis client is not installed';

  async apply(_messages: QueueMessage[]): Promise<QueueObservation[]> {
    return [];
  }
}

export class RabbitMQAdapter implements QueueAdapter {
  readonly kind = 'rabbitmq' as const;
  readonly available = false;
  readonly reason = 'RabbitMQ adapter is not implemented; amqplib is not installed';

  async apply(_messages: QueueMessage[]): Promise<QueueObservation[]> {
    return [];
  }
}

export interface RunQueueFlowInput {
  enabled: boolean;
  messages?: QueueMessage[];
  /** Defaults to InMemoryQueueAdapter when omitted. */
  adapter?: QueueAdapter;
}

function checkPublished(observations: QueueObservation[]): TestResult {
  const all = observations.every((o) => o.published);
  return queueResult(QUEUE_CHECK_IDS.published, 'published', all ? 'PASS' : 'FAIL', {
    reason: all ? 'every supplied message was published' : 'not every message was published',
    assertion: { expected: true, actual: all },
  });
}

function checkConsumed(observations: QueueObservation[]): TestResult {
  const all = observations.every((o) => o.consumed);
  return queueResult(QUEUE_CHECK_IDS.consumed, 'consumed', all ? 'PASS' : 'FAIL', {
    reason: CLASSIFIED_NO_WORKER,
    assertion: { expected: true, actual: all },
  });
}

function checkProcessing(observations: QueueObservation[]): TestResult {
  const all = observations.every((o) => o.processing);
  return queueResult(QUEUE_CHECK_IDS.processing, 'processing', all ? 'PASS' : 'FAIL', {
    reason: CLASSIFIED_NO_WORKER,
    assertion: { expected: true, actual: all },
  });
}

function checkAcknowledgement(messages: QueueMessage[]): TestResult {
  const anySet = messages.some((m) => m.acked !== undefined);
  if (!anySet) {
    return queueResult(QUEUE_CHECK_IDS.acknowledgement, 'acknowledgement', 'NOT_TESTED', {
      reason: 'acknowledgement was not configured',
    });
  }
  if (messages.some((m) => m.acked === false)) {
    const ids = messages.filter((m) => m.acked === false).map((m) => m.id);
    return queueResult(QUEUE_CHECK_IDS.acknowledgement, 'acknowledgement', 'FAIL', {
      reason: `message not acknowledged (${ids.join(', ')})`,
      assertion: { expected: true, actual: false },
      metadata: { ids },
    });
  }
  if (messages.every((m) => m.acked === true)) {
    return queueResult(QUEUE_CHECK_IDS.acknowledgement, 'acknowledgement', 'PASS', {
      reason: 'all messages acknowledged',
    });
  }
  return queueResult(QUEUE_CHECK_IDS.acknowledgement, 'acknowledgement', 'FAIL', {
    reason: 'acknowledgement incomplete across supplied messages',
  });
}

function checkRetry(messages: QueueMessage[], observations: QueueObservation[]): TestResult {
  const retried = observations.filter((o) => o.retry);
  if (retried.length === 0) {
    return queueResult(QUEUE_CHECK_IDS.retry, 'retry', 'NOT_TESTED', {
      reason: 'no retry was supplied',
    });
  }
  const ids = retried.map((o) => o.id);
  return queueResult(QUEUE_CHECK_IDS.retry, 'retry', 'PASS', {
    reason: `retry observed for ${ids.join(', ')}`,
    metadata: { ids },
    assertion: {
      expected: 'attempt > 1',
      actual: messages.filter((m) => typeof m.attempt === 'number' && m.attempt > 1).map((m) => m.id),
    },
  });
}

function checkDeadLetter(observations: QueueObservation[]): TestResult {
  const dlq = observations.filter((o) => o.deadLetter);
  if (dlq.length === 0) {
    return queueResult(QUEUE_CHECK_IDS.deadLetter, 'dead-letter', 'NOT_TESTED', {
      reason: 'no dead-letter message was supplied',
    });
  }
  const id = dlq[0]!.id;
  return queueResult(QUEUE_CHECK_IDS.deadLetter, 'dead-letter', 'PASS', {
    reason: `dead-letter message ${id} observed`,
    metadata: { ids: dlq.map((o) => o.id) },
  });
}

function checkDuplicate(observations: QueueObservation[]): TestResult {
  const dups = [...new Set(observations.filter((o) => o.duplicate).map((o) => o.id))];
  if (dups.length > 0) {
    const id = dups[0]!;
    return queueResult(QUEUE_CHECK_IDS.duplicate, 'duplicate', 'FAIL', {
      reason: `duplicate message ${id}`,
      assertion: { expected: 'unique ids', actual: dups },
      metadata: { duplicates: dups },
    });
  }
  return queueResult(QUEUE_CHECK_IDS.duplicate, 'duplicate', 'PASS', {
    reason: 'no duplicate message ids',
  });
}

function checkOutOfOrder(messages: QueueMessage[], observations: QueueObservation[]): TestResult {
  const anySequence = messages.some((m) => m.sequence !== undefined);
  if (!anySequence) {
    return queueResult(QUEUE_CHECK_IDS.outOfOrder, 'out-of-order', 'NOT_TESTED', {
      reason: 'no sequence was supplied',
    });
  }
  const ordered = observations.some((o) => o.outOfOrder);
  if (ordered) {
    const sequences = messages.map((m) => m.sequence);
    return queueResult(QUEUE_CHECK_IDS.outOfOrder, 'out-of-order', 'FAIL', {
      reason: `message sequences are not strictly increasing (${sequences.join(', ')})`,
      assertion: { expected: 'strictly increasing sequences', actual: sequences },
    });
  }
  return queueResult(QUEUE_CHECK_IDS.outOfOrder, 'out-of-order', 'PASS', {
    reason: 'message sequences are strictly increasing',
    assertion: {
      expected: 'strictly increasing sequences',
      actual: messages.map((m) => m.sequence),
    },
  });
}

/**
 * In-memory queue flow checks. No broker I/O.
 * When disabled → single NOT_APPLICABLE. Unavailable adapters → single BLOCKED.
 */
export async function runQueueFlow(input: RunQueueFlowInput): Promise<TestResult[]> {
  if (!input.enabled) {
    return [
      queueResult(QUEUE_CHECK_IDS.notEnabled, 'Queue testing', 'NOT_APPLICABLE', {
        reason: 'queue testing is not enabled for this application',
      }),
    ];
  }

  const adapter = input.adapter ?? new InMemoryQueueAdapter();

  if (!adapter.available) {
    const reason =
      adapter.reason ??
      `${adapter.kind} adapter is not implemented`;
    return [
      queueResult(QUEUE_CHECK_IDS.adapter, 'Queue adapter', 'BLOCKED', {
        reason,
        metadata: { kind: adapter.kind, available: false },
      }),
    ];
  }

  if (adapter.kind !== 'generic') {
    return [
      queueResult(QUEUE_CHECK_IDS.adapter, 'Queue adapter', 'BLOCKED', {
        reason: 'driver is installed but no broker connection is configured',
        metadata: { kind: adapter.kind, available: adapter.available },
      }),
    ];
  }

  const messages = input.messages ?? [];
  if (messages.length === 0) {
    return [
      queueResult(QUEUE_CHECK_IDS.messages, 'Queue messages', 'NOT_TESTED', {
        reason: 'no messages were supplied',
      }),
    ];
  }

  const observations = await adapter.apply(messages);
  return [
    checkPublished(observations),
    checkConsumed(observations),
    checkProcessing(observations),
    checkAcknowledgement(messages),
    checkRetry(messages, observations),
    checkDeadLetter(observations),
    checkDuplicate(observations),
    checkOutOfOrder(messages, observations),
  ];
}

/** Alias for CLI / callers — same pure checks as `runQueueFlow`. */
export async function runQueueChecks(input: RunQueueFlowInput): Promise<TestResult[]> {
  return runQueueFlow(input);
}
