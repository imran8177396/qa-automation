/**
 * Timeouts used for classification only. Values match playwright.config.ts
 * defaults (test 60s, navigation 35s, action 15s, expect 10s). This module
 * does not import Playwright config — another agent owns those files.
 */
export const DEFAULT_CLASSIFICATION_TIMEOUTS_MS = {
  testTimeoutMs: 60_000,
  navigationTimeoutMs: 35_000,
  actionTimeoutMs: 15_000,
  expectTimeoutMs: 10_000,
} as const;

/** A duration within this fraction of a configured timeout is a timeout class. */
export const TIMEOUT_PROXIMITY_RATIO = 0.05;

export type ClassificationTimeoutKey = keyof typeof DEFAULT_CLASSIFICATION_TIMEOUTS_MS;

export interface NearTimeoutMatch {
  key: ClassificationTimeoutKey;
  timeoutMs: number;
  deltaRatio: number;
}

export function isDurationNearTimeout(
  durationMs: number,
  timeoutMs: number,
  ratio: number = TIMEOUT_PROXIMITY_RATIO
): boolean {
  if (!Number.isFinite(durationMs) || durationMs < 0) return false;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return false;
  return Math.abs(durationMs - timeoutMs) / timeoutMs <= ratio;
}

export function nearestConfiguredTimeout(
  durationMs: number,
  timeouts: typeof DEFAULT_CLASSIFICATION_TIMEOUTS_MS = DEFAULT_CLASSIFICATION_TIMEOUTS_MS,
  ratio: number = TIMEOUT_PROXIMITY_RATIO
): NearTimeoutMatch | null {
  let best: NearTimeoutMatch | null = null;
  for (const [key, timeoutMs] of Object.entries(timeouts) as Array<
    [ClassificationTimeoutKey, number]
  >) {
    if (!isDurationNearTimeout(durationMs, timeoutMs, ratio)) continue;
    const deltaRatio = Math.abs(durationMs - timeoutMs) / timeoutMs;
    if (!best || deltaRatio < best.deltaRatio) {
      best = { key, timeoutMs, deltaRatio };
    }
  }
  return best;
}

const TIMEOUT_IN_MESSAGE = /timeout(?: of)? (\d+)ms/i;

/** Timeout value mentioned in Playwright error text, if present. */
export function timeoutMsFromErrorText(text: string): number | null {
  const match = text.match(TIMEOUT_IN_MESSAGE);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}
