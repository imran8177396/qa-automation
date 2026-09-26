/**
 * Queue message classifier only — no broker is connected.
 */

export type QueueClassification =
  | 'delayed'
  | 'duplicate'
  | 'failed'
  | 'out-of-order'
  | 'in-order';

export interface QueueMessageFlags {
  delayMs?: number;
  duplicate?: boolean;
  failed?: boolean;
  sequence?: number;
  expectedSequence?: number;
}

/**
 * Classify a message from caller-supplied flags.
 * Priority when several flags are set: failed, then duplicate, then delayed, then out-of-order.
 * (Documented order — first matching flag wins.)
 */
export function classifyQueueMessage(flags: QueueMessageFlags): QueueClassification {
  if (flags.failed === true) return 'failed';
  if (flags.duplicate === true) return 'duplicate';
  if (typeof flags.delayMs === 'number' && flags.delayMs > 0) return 'delayed';
  if (
    typeof flags.sequence === 'number' &&
    typeof flags.expectedSequence === 'number' &&
    flags.sequence !== flags.expectedSequence
  ) {
    return 'out-of-order';
  }
  return 'in-order';
}
