/**
 * Unit tests for in-memory queue flow — no broker, no sockets, no client imports.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  QUEUE_CHECK_IDS,
  InMemoryQueueAdapter,
  KafkaAdapter,
  RedisAdapter,
  RabbitMQAdapter,
  runQueueChecks,
} from './queue-flow';

const SOURCE = readFileSync(path.join(__dirname, 'queue-flow.ts'), 'utf8');

function byId(results: Awaited<ReturnType<typeof runQueueChecks>>) {
  return Object.fromEntries(results.map((r) => [r.id, r]));
}

function reasonOf(row: { metadata?: Record<string, unknown>; error?: { message?: string } }): string {
  return String(row.metadata?.reason ?? row.error?.message ?? '');
}

test('disabled → NOT_APPLICABLE', async () => {
  const results = await runQueueChecks({ enabled: false, messages: [] });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, QUEUE_CHECK_IDS.notEnabled);
  assert.equal(results[0]?.status, 'NOT_APPLICABLE');
  assert.match(reasonOf(results[0]!), /queue testing is not enabled for this application/);
});

test('empty → NOT_TESTED', async () => {
  const results = await runQueueChecks({
    enabled: true,
    messages: [],
    adapter: new InMemoryQueueAdapter(),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, 'NOT_TESTED');
  assert.match(reasonOf(results[0]!), /no messages were supplied/);
});

test('ordered acked messages → published/consumed/processing/ack/ordering PASS; retry and dead-letter NOT_TESTED; duplicate PASS', async () => {
  const results = byId(
    await runQueueChecks({
      enabled: true,
      adapter: new InMemoryQueueAdapter(),
      messages: [
        { id: 'm1', sequence: 1, acked: true },
        { id: 'm2', sequence: 2, acked: true },
      ],
    })
  );
  assert.equal(results[QUEUE_CHECK_IDS.published]?.status, 'PASS');
  assert.equal(results[QUEUE_CHECK_IDS.consumed]?.status, 'PASS');
  assert.match(reasonOf(results[QUEUE_CHECK_IDS.consumed]!), /classified from supplied messages; no worker was started/);
  assert.equal(results[QUEUE_CHECK_IDS.processing]?.status, 'PASS');
  assert.match(reasonOf(results[QUEUE_CHECK_IDS.processing]!), /classified from supplied messages; no worker was started/);
  assert.equal(results[QUEUE_CHECK_IDS.acknowledgement]?.status, 'PASS');
  assert.equal(results[QUEUE_CHECK_IDS.outOfOrder]?.status, 'PASS');
  assert.equal(results[QUEUE_CHECK_IDS.retry]?.status, 'NOT_TESTED');
  assert.equal(results[QUEUE_CHECK_IDS.deadLetter]?.status, 'NOT_TESTED');
  assert.equal(results[QUEUE_CHECK_IDS.duplicate]?.status, 'PASS');
});

test('duplicate ids → duplicate FAIL', async () => {
  const results = byId(
    await runQueueChecks({
      enabled: true,
      adapter: new InMemoryQueueAdapter(),
      messages: [
        { id: 'dup-1', sequence: 1 },
        { id: 'dup-1', sequence: 2 },
      ],
    })
  );
  assert.equal(results[QUEUE_CHECK_IDS.duplicate]?.status, 'FAIL');
  assert.match(reasonOf(results[QUEUE_CHECK_IDS.duplicate]!), /duplicate message dup-1/);
});

test('sequences 1,3,2 → out-of-order FAIL', async () => {
  const results = byId(
    await runQueueChecks({
      enabled: true,
      adapter: new InMemoryQueueAdapter(),
      messages: [
        { id: 'a', sequence: 1 },
        { id: 'b', sequence: 3 },
        { id: 'c', sequence: 2 },
      ],
    })
  );
  assert.equal(results[QUEUE_CHECK_IDS.outOfOrder]?.status, 'FAIL');
});

test('attempt 2 → retry PASS', async () => {
  const results = byId(
    await runQueueChecks({
      enabled: true,
      adapter: new InMemoryQueueAdapter(),
      messages: [{ id: 'retry-1', attempt: 2 }],
    })
  );
  assert.equal(results[QUEUE_CHECK_IDS.retry]?.status, 'PASS');
  assert.match(reasonOf(results[QUEUE_CHECK_IDS.retry]!), /retry-1/);
});

test('deadLetter true → dead-letter result mentions the id', async () => {
  const results = byId(
    await runQueueChecks({
      enabled: true,
      adapter: new InMemoryQueueAdapter(),
      messages: [{ id: 'dlq-9', deadLetter: true }],
    })
  );
  assert.equal(results[QUEUE_CHECK_IDS.deadLetter]?.status, 'PASS');
  assert.match(reasonOf(results[QUEUE_CHECK_IDS.deadLetter]!), /dead-letter message dlq-9 observed/);
});

test('KafkaAdapter.available === false; runQueueChecks → BLOCKED, mentions Kafka, does not PASS', async () => {
  const kafka = new KafkaAdapter();
  assert.equal(kafka.available, false);
  const results = await runQueueChecks({
    enabled: true,
    adapter: kafka,
    messages: [{ id: 'm1' }],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, QUEUE_CHECK_IDS.adapter);
  assert.equal(results[0]?.status, 'BLOCKED');
  assert.notEqual(results[0]?.status, 'PASS');
  assert.match(reasonOf(results[0]!), /Kafka/i);
  assert.match(reasonOf(results[0]!), /not implemented/i);
});

test('Redis and RabbitMQ available === false', () => {
  assert.equal(new RedisAdapter().available, false);
  assert.match(new RedisAdapter().reason ?? '', /redis client is not installed/i);
  assert.equal(new RabbitMQAdapter().available, false);
  assert.match(new RabbitMQAdapter().reason ?? '', /amqplib is not installed/i);
});

test('source of queue-flow.ts does not contain broker client imports or createConnection', () => {
  assert.ok(!SOURCE.includes("from 'kafkajs'"), 'must not import kafkajs');
  assert.ok(!SOURCE.includes("from 'amqplib'"), 'must not import amqplib');
  assert.ok(!SOURCE.includes("from 'redis'"), 'must not import redis');
  assert.ok(!SOURCE.includes('createConnection'), 'must not call createConnection');
});
