/**
 * Timeout / cancel / abort helper for in-process engine work.
 * Does not spawn processes. Never maps timeout or cancel to PASS or FAIL.
 */

export type RunWithTimeoutCleanupReason = 'completed' | 'timeout' | 'cancelled' | 'aborted';

export type RunWithTimeoutResult =
  | { status: 'PASS' }
  | { status: 'TIMEOUT'; reason: string }
  | { status: 'CANCELLED'; reason: string };

export type RunWithTimeoutOptions = {
  /** Positive ms arms a timer. Omitted or 0 = no timer. Negative → throw. */
  timeoutMs?: number;
  signal?: AbortSignal;
  run: (signal: AbortSignal) => Promise<void>;
  cleanup?: (reason: RunWithTimeoutCleanupReason) => Promise<void>;
};

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'AbortError'
  );
}

function makeAbortError(message: string): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

/**
 * Classify an external AbortSignal reason into cleanup outcome + status reason text.
 * Empty / `cancel` → cancelled; `abort` / AbortError (non-timeout) → aborted.
 */
export function classifyExternalAbortReason(reason: unknown): {
  cleanup: 'cancelled' | 'aborted';
  message: string;
} {
  if (reason === undefined || reason === null || reason === '') {
    return { cleanup: 'cancelled', message: 'cancelled' };
  }
  if (reason === 'cancel') {
    return { cleanup: 'cancelled', message: 'cancelled' };
  }
  if (reason === 'abort') {
    return { cleanup: 'aborted', message: 'aborted' };
  }
  if (isAbortError(reason)) {
    const msg = (reason as Error).message || 'aborted';
    if (/timeout/i.test(msg)) {
      return { cleanup: 'cancelled', message: 'cancelled' };
    }
    return {
      cleanup: 'aborted',
      message: /abort/i.test(msg) ? msg : `aborted: ${msg}`,
    };
  }
  if (typeof reason === 'string') {
    if (/cancel/i.test(reason)) {
      return { cleanup: 'cancelled', message: reason };
    }
    if (/abort/i.test(reason)) {
      return { cleanup: 'aborted', message: reason };
    }
    return { cleanup: 'cancelled', message: `cancelled (${reason})` };
  }
  return { cleanup: 'cancelled', message: 'cancelled' };
}

async function runCleanup(
  cleanup: RunWithTimeoutOptions['cleanup'],
  reason: RunWithTimeoutCleanupReason
): Promise<unknown | undefined> {
  if (!cleanup) return undefined;
  try {
    await cleanup(reason);
    return undefined;
  } catch (error) {
    return error;
  }
}

function cancelledResult(reason: unknown): RunWithTimeoutResult {
  const classified = classifyExternalAbortReason(reason);
  return { status: 'CANCELLED', reason: classified.message };
}

/**
 * Race `run` against an optional timeout and/or external AbortSignal.
 * TIMEOUT and CANCELLED are never reported as PASS or FAIL.
 */
export async function runWithTimeout(options: RunWithTimeoutOptions): Promise<RunWithTimeoutResult> {
  const { timeoutMs, signal: externalSignal, run, cleanup } = options;

  if (timeoutMs !== undefined && timeoutMs < 0) {
    throw new Error(`timeoutMs must not be negative (got ${timeoutMs})`);
  }

  const armTimer = typeof timeoutMs === 'number' && timeoutMs > 0;

  if (externalSignal?.aborted) {
    const classified = classifyExternalAbortReason(externalSignal.reason);
    await runCleanup(cleanup, classified.cleanup);
    return { status: 'CANCELLED', reason: classified.message };
  }

  const controller = new AbortController();
  let timeoutFired = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const onExternalAbort = (): void => {
    if (timeoutFired) return;
    controller.abort(externalSignal?.reason ?? 'cancel');
  };

  if (armTimer) {
    timeoutId = setTimeout(() => {
      timeoutFired = true;
      controller.abort('timeout');
    }, timeoutMs);
  }

  externalSignal?.addEventListener('abort', onExternalAbort);

  const abortWait = new Promise<never>((_resolve, reject) => {
    if (controller.signal.aborted) {
      reject(makeAbortError(String(controller.signal.reason ?? 'aborted')));
      return;
    }
    controller.signal.addEventListener(
      'abort',
      () => {
        reject(makeAbortError(String(controller.signal.reason ?? 'aborted')));
      },
      { once: true }
    );
  });

  let bodyError: unknown;
  let outcome: RunWithTimeoutCleanupReason = 'completed';
  let cancelReason: unknown = externalSignal?.reason;

  try {
    await Promise.race([run(controller.signal), abortWait]);
    if (timeoutFired) {
      outcome = 'timeout';
    } else if (externalSignal?.aborted || controller.signal.aborted) {
      cancelReason = externalSignal?.aborted
        ? externalSignal.reason
        : controller.signal.reason;
      if (String(cancelReason) === 'timeout' || timeoutFired) {
        outcome = 'timeout';
      } else {
        outcome = classifyExternalAbortReason(cancelReason).cleanup;
      }
    } else {
      outcome = 'completed';
    }
  } catch (error) {
    if (timeoutFired || String(controller.signal.reason) === 'timeout') {
      outcome = 'timeout';
    } else if (externalSignal?.aborted || isAbortError(error)) {
      cancelReason = externalSignal?.aborted
        ? externalSignal.reason
        : controller.signal.reason ?? error;
      outcome = classifyExternalAbortReason(cancelReason).cleanup;
    } else {
      bodyError = error;
      outcome = 'completed';
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }

  const cleanupError = await runCleanup(cleanup, outcome);

  if (bodyError !== undefined) {
    throw bodyError;
  }

  if (outcome === 'timeout') {
    // cleanupError attached by intentional non-throw: TIMEOUT wins over cleanup failure.
    void cleanupError;
    return { status: 'TIMEOUT', reason: `timeout after ${timeoutMs}ms` };
  }

  if (outcome === 'cancelled' || outcome === 'aborted') {
    void cleanupError;
    return cancelledResult(cancelReason);
  }

  if (cleanupError !== undefined) {
    throw cleanupError;
  }

  return { status: 'PASS' };
}
