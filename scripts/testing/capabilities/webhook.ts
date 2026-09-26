/**
 * Webhook HMAC verification and delivery classification only.
 * Does not open a port or call a webhook URL. Never logs secrets.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  makeResult,
  type EngineResultStatus,
  type TestResult,
} from '../../core/engine-contract';

export interface WebhookVerifyInput {
  secret: string;
  body: string;
  signature: string;
}

export interface WebhookDeliveryEvent {
  id: string;
  attempt: number;
}

/** Caller-supplied delivery evidence. No I/O — never fetched or posted. */
export interface WebhookFlowDelivery {
  id: string;
  attempt: number;
  sequence?: number;
  body: string;
  signature?: string;
  failed?: boolean;
  durationMs?: number;
}

/**
 * In-memory webhook pipeline input (Trigger → Webhook → Receiver → Validate → Retry).
 * Pure classification — no listen, no HTTP, no live receiver.
 */
export interface RunWebhookFlowInput {
  enabled: boolean;
  /** Never logged or written into reason/actual fields. */
  secret?: string;
  expectedPayload?: Record<string, unknown>;
  deliveries: WebhookFlowDelivery[];
  timeoutMs?: number;
}

export const WEBHOOK_CHECK_IDS = {
  notEnabled: 'webhook:not-enabled',
  delivery: 'webhook:delivery',
  signature: 'webhook:signature',
  payload: 'webhook:payload',
  retry: 'webhook:retry',
  duplicate: 'webhook:duplicate',
  ordering: 'webhook:ordering',
  timeout: 'webhook:timeout',
  failureRecovery: 'webhook:failure-recovery',
} as const;

const TEST_TYPE = 'webhook';
const CATEGORY = 'advanced';

function webhookResult(
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

function isSuccessful(d: WebhookFlowDelivery): boolean {
  return d.failed !== true;
}

/** Same id + same attempt → duplicate (retries use increasing attempt). */
function duplicateIdAttemptIds(deliveries: WebhookFlowDelivery[]): string[] {
  const counts = new Map<string, number>();
  for (const d of deliveries) {
    const key = `${d.id}\0${d.attempt}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ids = new Set<string>();
  for (const [key, n] of counts) {
    if (n > 1) ids.add(key.split('\0')[0]!);
  }
  return [...ids];
}

export type SignWebhookResult =
  | { status: 'PASS'; signature: string }
  | { status: 'REQUIRES_CONFIGURATION'; reason: string };

/**
 * HMAC-SHA256 hex digest of body with secret.
 * Blank secret → REQUIRES_CONFIGURATION. Does not log the secret.
 */
export function signWebhook(secret: string, body: string): SignWebhookResult {
  if (!(secret ?? '').trim()) {
    return { status: 'REQUIRES_CONFIGURATION', reason: 'webhook secret is required' };
  }
  return {
    status: 'PASS',
    signature: createHmac('sha256', secret).update(body, 'utf8').digest('hex'),
  };
}

/**
 * Verify HMAC-SHA256 signature. Blank secret → REQUIRES_CONFIGURATION.
 * Does not log the secret.
 */
export function verifyWebhook(input: WebhookVerifyInput): TestResult {
  const secret = input.secret ?? '';
  if (!secret.trim()) {
    const reason = 'webhook secret is required';
    return makeResult({
      id: 'webhook:verify',
      testType: 'webhook',
      category: 'advanced',
      name: 'Webhook signature verification',
      status: 'REQUIRES_CONFIGURATION',
      error: { message: reason },
      metadata: { reason },
    });
  }

  const expected = createHmac('sha256', secret).update(input.body ?? '', 'utf8').digest('hex');
  const actual = (input.signature ?? '').trim();
  let match = false;
  try {
    match =
      actual.length === expected.length &&
      timingSafeEqual(Buffer.from(actual, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    match = false;
  }

  if (!match) {
    return makeResult({
      id: 'webhook:verify',
      testType: 'webhook',
      category: 'advanced',
      name: 'Webhook signature verification',
      status: 'FAIL',
      assertion: { expected: 'matching HMAC-SHA256 signature', actual: 'mismatch' },
      error: { message: 'webhook signature does not match' },
    });
  }

  return makeResult({
    id: 'webhook:verify',
    testType: 'webhook',
    category: 'advanced',
    name: 'Webhook signature verification',
    status: 'PASS',
    assertion: { expected: 'matching HMAC-SHA256 signature', actual: 'match' },
  });
}

/** List event ids that appear more than once. */
export function duplicateEventIds(events: WebhookDeliveryEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

/**
 * Classify delivery evidence: duplicates (same id would be processed as new) and retries
 * (later attempt of the same id). Pure data — not end-to-end delivery.
 */
export function classifyWebhookDelivery(events: WebhookDeliveryEvent[]): {
  duplicates: string[];
  retries: WebhookDeliveryEvent[];
  results: TestResult[];
} {
  const duplicates = duplicateEventIds(events);
  const retries: WebhookDeliveryEvent[] = [];
  const seenAttempt = new Map<string, number>();

  for (const e of events) {
    const prev = seenAttempt.get(e.id);
    if (prev !== undefined && e.attempt > prev) {
      retries.push(e);
    }
    seenAttempt.set(e.id, Math.max(prev ?? 0, e.attempt));
  }

  const results: TestResult[] = [];
  if (duplicates.length > 0) {
    results.push(
      makeResult({
        id: 'webhook:duplicate',
        testType: 'webhook',
        category: 'advanced',
        name: 'duplicate',
        status: 'FAIL',
        assertion: {
          expected: 'unique event ids',
          actual: duplicates,
        },
        error: {
          message: 'duplicate event id; a second delivery would be processed as new',
        },
        metadata: { duplicates, retries },
      })
    );
  } else {
    results.push(
      makeResult({
        id: 'webhook:duplicate',
        testType: 'webhook',
        category: 'advanced',
        name: 'duplicate',
        status: 'PASS',
        assertion: { expected: 'unique event ids', actual: [] },
        metadata: { duplicates, retries },
      })
    );
  }

  return { duplicates, retries, results };
}

function checkDelivery(deliveries: WebhookFlowDelivery[]): TestResult {
  if (deliveries.length === 0) {
    return webhookResult(WEBHOOK_CHECK_IDS.delivery, 'delivery', 'NOT_TESTED', {
      reason: 'no deliveries were supplied',
    });
  }
  const ok = deliveries.some(isSuccessful);
  if (!ok) {
    return webhookResult(WEBHOOK_CHECK_IDS.delivery, 'delivery', 'FAIL', {
      reason: 'no successful delivery',
      assertion: { expected: 'at least one successful delivery', actual: 'none' },
    });
  }
  return webhookResult(WEBHOOK_CHECK_IDS.delivery, 'delivery', 'PASS', {
    assertion: { expected: 'at least one successful delivery', actual: 'present' },
  });
}

function checkSignature(
  secret: string | undefined,
  deliveries: WebhookFlowDelivery[]
): TestResult {
  if (!(secret ?? '').trim()) {
    return webhookResult(WEBHOOK_CHECK_IDS.signature, 'signature', 'REQUIRES_CONFIGURATION', {
      reason: 'webhook secret is required',
    });
  }

  for (const d of deliveries) {
    let signature = d.signature;
    if (signature === undefined || signature === '') {
      const signed = signWebhook(secret!, d.body);
      if (signed.status !== 'PASS') {
        return webhookResult(WEBHOOK_CHECK_IDS.signature, 'signature', 'REQUIRES_CONFIGURATION', {
          reason: signed.reason,
        });
      }
      signature = signed.signature;
    }
    const verified = verifyWebhook({ secret: secret!, body: d.body, signature });
    if (verified.status !== 'PASS') {
      return webhookResult(WEBHOOK_CHECK_IDS.signature, 'signature', 'FAIL', {
        reason: 'webhook signature does not match',
        assertion: {
          expected: 'matching HMAC-SHA256 signature',
          actual: 'mismatch',
        },
      });
    }
  }

  return webhookResult(WEBHOOK_CHECK_IDS.signature, 'signature', 'PASS', {
    assertion: { expected: 'matching HMAC-SHA256 signature', actual: 'match' },
  });
}

function checkPayload(
  expectedPayload: Record<string, unknown> | undefined,
  deliveries: WebhookFlowDelivery[]
): TestResult {
  if (expectedPayload === undefined) {
    return webhookResult(WEBHOOK_CHECK_IDS.payload, 'payload', 'NOT_TESTED', {
      reason: 'payload expectations were not configured',
    });
  }

  const successful = deliveries.find(isSuccessful);
  if (!successful) {
    return webhookResult(WEBHOOK_CHECK_IDS.payload, 'payload', 'FAIL', {
      reason: 'no successful delivery',
      assertion: { expected: expectedPayload, actual: undefined },
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(successful.body);
  } catch {
    return webhookResult(WEBHOOK_CHECK_IDS.payload, 'payload', 'FAIL', {
      reason: 'payload is not JSON',
      assertion: { expected: expectedPayload, actual: 'invalid JSON' },
    });
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return webhookResult(WEBHOOK_CHECK_IDS.payload, 'payload', 'FAIL', {
      reason: 'payload is not JSON',
      assertion: { expected: expectedPayload, actual: parsed },
    });
  }

  const actual = parsed as Record<string, unknown>;
  for (const [key, expected] of Object.entries(expectedPayload)) {
    if (actual[key] !== expected) {
      return webhookResult(WEBHOOK_CHECK_IDS.payload, 'payload', 'FAIL', {
        reason: `payload key "${key}" mismatch`,
        assertion: { expected: expectedPayload, actual },
      });
    }
  }

  return webhookResult(WEBHOOK_CHECK_IDS.payload, 'payload', 'PASS', {
    assertion: { expected: expectedPayload, actual },
  });
}

function checkRetry(deliveries: WebhookFlowDelivery[]): TestResult {
  const classified = classifyWebhookDelivery(
    deliveries.map((d) => ({ id: d.id, attempt: d.attempt }))
  );
  if (classified.retries.length === 0) {
    return webhookResult(WEBHOOK_CHECK_IDS.retry, 'retry', 'NOT_TESTED', {
      reason: 'no retry was supplied',
    });
  }

  const attemptNumbers = [
    ...new Set(
      deliveries
        .filter((d) => classified.retries.some((r) => r.id === d.id))
        .map((d) => d.attempt)
    ),
  ].sort((a, b) => a - b);

  return webhookResult(WEBHOOK_CHECK_IDS.retry, 'retry', 'PASS', {
    reason: `retry attempts recorded: ${attemptNumbers.join(', ')}`,
    metadata: { attempts: attemptNumbers, retries: classified.retries },
  });
}

function checkDuplicate(deliveries: WebhookFlowDelivery[]): TestResult {
  const dups = duplicateIdAttemptIds(deliveries);
  if (dups.length > 0) {
    return webhookResult(WEBHOOK_CHECK_IDS.duplicate, 'duplicate', 'FAIL', {
      reason: `duplicate delivery would be processed as new (${dups.join(', ')})`,
      assertion: { expected: 'unique id+attempt', actual: dups },
      metadata: { duplicates: dups },
    });
  }
  return webhookResult(WEBHOOK_CHECK_IDS.duplicate, 'duplicate', 'PASS', {
    reason: 'no duplicate delivery ids',
    assertion: { expected: 'unique id+attempt', actual: [] },
  });
}

function checkOrdering(deliveries: WebhookFlowDelivery[]): TestResult {
  const anySequence = deliveries.some((d) => d.sequence !== undefined);
  if (!anySequence) {
    return webhookResult(WEBHOOK_CHECK_IDS.ordering, 'ordering', 'NOT_TESTED', {
      reason: 'ordering was not configured',
    });
  }

  const successful = deliveries.filter(isSuccessful).filter((d) => d.sequence !== undefined);
  for (let i = 1; i < successful.length; i++) {
    const prev = successful[i - 1]!.sequence!;
    const curr = successful[i]!.sequence!;
    if (!(curr > prev)) {
      return webhookResult(WEBHOOK_CHECK_IDS.ordering, 'ordering', 'FAIL', {
        reason: `successful delivery sequences are not strictly increasing (${successful
          .map((d) => d.sequence)
          .join(', ')})`,
        assertion: {
          expected: 'strictly increasing sequences',
          actual: successful.map((d) => d.sequence),
        },
      });
    }
  }

  return webhookResult(WEBHOOK_CHECK_IDS.ordering, 'ordering', 'PASS', {
    assertion: {
      expected: 'strictly increasing sequences',
      actual: successful.map((d) => d.sequence),
    },
  });
}

function checkTimeout(
  timeoutMs: number | undefined,
  deliveries: WebhookFlowDelivery[]
): TestResult {
  if (timeoutMs === undefined) {
    return webhookResult(WEBHOOK_CHECK_IDS.timeout, 'timeout', 'NOT_TESTED', {
      reason: 'timeout was not configured',
    });
  }

  for (const d of deliveries) {
    if (typeof d.durationMs === 'number' && d.durationMs > timeoutMs) {
      return webhookResult(WEBHOOK_CHECK_IDS.timeout, 'timeout', 'TIMEOUT', {
        reason: `timeout after ${timeoutMs}ms`,
        assertion: { expected: `durationMs <= ${timeoutMs}`, actual: d.durationMs },
        metadata: { timeoutMs, durationMs: d.durationMs, deliveryId: d.id },
      });
    }
  }

  return webhookResult(WEBHOOK_CHECK_IDS.timeout, 'timeout', 'PASS', {
    assertion: { expected: `durationMs <= ${timeoutMs}`, actual: 'within limit' },
    metadata: { timeoutMs },
  });
}

function checkFailureRecovery(deliveries: WebhookFlowDelivery[]): TestResult {
  const failed = deliveries.filter((d) => d.failed === true);
  if (failed.length === 0) {
    return webhookResult(WEBHOOK_CHECK_IDS.failureRecovery, 'failure recovery', 'NOT_TESTED', {
      reason: 'no failed delivery was supplied',
    });
  }

  for (const f of failed) {
    const recovered = deliveries.find(
      (d) => d.id === f.id && d.attempt > f.attempt && d.failed !== true
    );
    if (recovered) {
      const reason = `attempt ${f.attempt} failed; attempt ${recovered.attempt} recovered`;
      return webhookResult(WEBHOOK_CHECK_IDS.failureRecovery, 'failure recovery', 'PASS', {
        reason,
        metadata: {
          attempts: [
            { id: f.id, attempt: f.attempt, failed: true },
            { id: recovered.id, attempt: recovered.attempt, failed: false },
          ],
          reason,
        },
      });
    }
  }

  return webhookResult(WEBHOOK_CHECK_IDS.failureRecovery, 'failure recovery', 'FAIL', {
    reason: 'delivery did not recover',
    metadata: {
      attempts: failed.map((f) => ({ id: f.id, attempt: f.attempt, failed: true })),
    },
  });
}

/**
 * In-memory webhook flow checks. No port, no URL call, never logs `secret`.
 * When disabled → single NOT_APPLICABLE result (no crypto).
 */
export function runWebhookFlow(input: RunWebhookFlowInput): TestResult[] {
  if (!input.enabled) {
    return [
      webhookResult(WEBHOOK_CHECK_IDS.notEnabled, 'Webhook testing', 'NOT_APPLICABLE', {
        reason: 'webhook testing is not enabled for this application',
      }),
    ];
  }

  const deliveries = input.deliveries ?? [];
  return [
    checkDelivery(deliveries),
    checkSignature(input.secret, deliveries),
    checkPayload(input.expectedPayload, deliveries),
    checkRetry(deliveries),
    checkDuplicate(deliveries),
    checkOrdering(deliveries),
    checkTimeout(input.timeoutMs, deliveries),
    checkFailureRecovery(deliveries),
  ];
}

/** Alias for CLI / callers — same pure checks as `runWebhookFlow`. */
export function runWebhookChecks(input: RunWebhookFlowInput): TestResult[] {
  return runWebhookFlow(input);
}
