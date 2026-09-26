import { makeResult, type TestResult } from '../core/engine-contract';

/**
 * Destructive fault-injection kinds. Catalog only — never executed by these runners.
 * A future injector MUST refuse to run when `destructiveAuthorized(...)` is false.
 */
export const DESTRUCTIVE_RESILIENCE_KINDS = [
  'failover',
  'fault-injection',
  'chaos',
  'network-failure',
  'database-failure',
  'queue-failure',
  'service-restart',
] as const;

export type DestructiveResilienceKind = (typeof DESTRUCTIVE_RESILIENCE_KINDS)[number];

/**
 * True only when argv contains `--authorize-destructive` OR env
 * `QA_RESILIENCE_AUTHORIZE` is the string `true`. Default false.
 * Authorization does not implement or run fault injection.
 */
export function destructiveAuthorized(
  argv: string[] = [],
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (argv.includes('--authorize-destructive')) return true;
  return env.QA_RESILIENCE_AUTHORIZE === 'true';
}

const BLOCKED_MESSAGE =
  'destructive fault injection requires --authorize-destructive or QA_RESILIENCE_AUTHORIZE';
const NOT_IMPLEMENTED_MESSAGE = 'fault injection is not implemented';

/**
 * Emit one TestResult per destructive kind. Never injects faults, kills processes,
 * restarts services, or opens raw sockets — records BLOCKED / NOT_TESTED only.
 */
export function destructiveKindResults(input: {
  testType: string;
  category: string;
  authorized: boolean;
}): TestResult[] {
  return DESTRUCTIVE_RESILIENCE_KINDS.map((kind) =>
    makeResult({
      id: `${input.testType}:${kind}`,
      testType: input.testType,
      category: input.category,
      name: `Destructive ${kind}`,
      status: input.authorized ? 'NOT_TESTED' : 'BLOCKED',
      error: {
        message: input.authorized ? NOT_IMPLEMENTED_MESSAGE : BLOCKED_MESSAGE,
      },
      metadata: {
        destructive: true,
        kind,
        authorized: input.authorized,
        reason: input.authorized ? NOT_IMPLEMENTED_MESSAGE : BLOCKED_MESSAGE,
      },
    })
  );
}
