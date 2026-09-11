/**
 * Exhaustive-execution policy for qa:all.
 *
 * Runnable inventory items must execute. Items that cannot run (safety, missing
 * locator, missing CLI, missing token) are recorded as BLOCKED / NOT_TESTED /
 * REQUIRES_CONFIGURATION with a reason — never dropped via test.skip, grep
 * exclusions, test.only, or a silent fixture fallback.
 */

export const NO_SKIP_POLICY_ID = 'exhaustive-execution';

export const NO_SKIP_POLICY_STATEMENT =
  'qa:all does not silently skip runnable tests, scenarios, or UI execution. ' +
  'Every planned check in the inventory runs when it is executable. ' +
  'Safety-blocked, unconfigurable, or tool-missing items are recorded as BLOCKED / NOT_TESTED / REQUIRES_CONFIGURATION with a reason — not omitted. ' +
  'Failures stay FAIL. Destructive generated actions stay unauthorized.';

export interface ExhaustiveExecutionPolicy {
  enabled: boolean;
  /** Configured Playwright engines only — do not add or drop browsers silently. */
  honorConfiguredBrowsers: boolean;
  /** UI suites hit the resolved target URL; fixture is used only when that target is loopback. */
  requireLiveUiWhenConfigured: boolean;
}

export function resolveExhaustiveExecutionPolicy(input?: {
  exhaustiveExecution?: boolean;
  noSilentSkip?: boolean;
}): ExhaustiveExecutionPolicy {
  const enabled = input?.exhaustiveExecution !== false && input?.noSilentSkip !== false;
  return {
    enabled,
    honorConfiguredBrowsers: enabled,
    requireLiveUiWhenConfigured: enabled,
  };
}

export function explicitOutcomeStatuses(): readonly string[] {
  return ['BLOCKED', 'NOT_TESTED', 'REQUIRES_CONFIGURATION', 'UNCOVERED', 'NOT_EXECUTED'];
}

export function isExplicitNonExecutionStatus(status: string): boolean {
  return explicitOutcomeStatuses().includes(status);
}
