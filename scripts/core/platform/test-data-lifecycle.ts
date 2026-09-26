import { productionActionAllowed } from './environment';
import type { QaEnvironmentName } from './environment';

/**
 * TestDataContext is the data-lifecycle context (project, environment, run).
 * Distinct from engine-contract `TestContext` (websiteUrl / apiUrl / enabled).
 */
export interface TestDataContext {
  projectId: string;
  environment: 'local' | 'development' | 'staging' | 'production';
  runId: string;
}

export type TestDataItemStatus =
  | 'PASS'
  | 'FAIL'
  | 'BLOCKED'
  | 'NOT_TESTED'
  | 'REQUIRES_CONFIGURATION';

export type TestDataItemKind = 'seed' | 'generate' | 'fixture' | 'snapshot' | 'cleanup';

export type TestDataPolicyMode = 'isolated' | 'shared' | 'read-only';

export interface TestDataPolicy {
  mode: TestDataPolicyMode;
  cleanupRequired: boolean;
}

export type TestDataPolicyStatus = 'PASS' | 'BLOCKED' | 'REQUIRES_CONFIGURATION';

export interface ResolveTestDataPolicyInput {
  environment: 'local' | 'development' | 'staging' | 'production';
  requested?: Partial<TestDataPolicy>;
  flags?: {
    authorizeDestructive?: boolean;
    authorizeDataMutation?: boolean;
  };
}

export interface ResolveTestDataPolicyResult {
  requested?: Partial<TestDataPolicy>;
  effective: TestDataPolicy;
  status: TestDataPolicyStatus;
  reason: string;
}

const VALID_POLICY_MODES: readonly TestDataPolicyMode[] = ['isolated', 'shared', 'read-only'];

const MUTATING_OPERATION_KINDS: ReadonlySet<TestDataItemKind> = new Set([
  'seed',
  'snapshot',
  'cleanup',
]);

export const POLICY_ACCEPTED_REASON = 'policy accepted; no data store was contacted';
export const PRODUCTION_DATA_MUTATION_REASON =
  'production data mutation requires explicit authorization';
export const READ_ONLY_CLEANUP_REASON = 'read-only tests cannot require cleanup';

function isPolicyMode(value: unknown): value is TestDataPolicyMode {
  return (
    typeof value === 'string' &&
    (VALID_POLICY_MODES as readonly string[]).includes(value)
  );
}

/**
 * Resolve effective test-data policy. Never creates, seeds, or deletes data.
 * Reuses `productionActionAllowed('data-mutation', …)` — no weaker production gate.
 */
export function resolveTestDataPolicy(
  input: ResolveTestDataPolicyInput
): ResolveTestDataPolicyResult {
  const requested = input.requested;

  if (requested?.mode !== undefined && !isPolicyMode(requested.mode)) {
    return {
      ...(requested !== undefined ? { requested } : {}),
      effective: { mode: 'read-only', cleanupRequired: false },
      status: 'REQUIRES_CONFIGURATION',
      reason: `Unknown test data policy mode ${JSON.stringify(requested.mode)}: expected isolated | shared | read-only (REQUIRES_CONFIGURATION)`,
    };
  }

  const mutationAllowed = productionActionAllowed('data-mutation', input.environment, {
    authorizeDataMutation: input.flags?.authorizeDataMutation === true,
    authorizeDestructive: input.flags?.authorizeDestructive === true,
  }).allowed;

  if (requested?.mode === 'read-only' && requested.cleanupRequired === true) {
    return {
      requested,
      effective: { mode: 'read-only', cleanupRequired: false },
      status: 'BLOCKED',
      reason: READ_ONLY_CLEANUP_REASON,
    };
  }

  if (input.environment === 'production' && !mutationAllowed) {
    const effective: TestDataPolicy = { mode: 'read-only', cleanupRequired: false };
    const requestedMutationMode =
      requested?.mode === 'isolated' || requested?.mode === 'shared';
    const requestedCleanup = requested?.cleanupRequired === true;
    if (requestedMutationMode || requestedCleanup) {
      return {
        ...(requested !== undefined ? { requested } : {}),
        effective,
        status: 'BLOCKED',
        reason: PRODUCTION_DATA_MUTATION_REASON,
      };
    }
    return {
      ...(requested !== undefined ? { requested } : {}),
      effective,
      status: 'PASS',
      reason: POLICY_ACCEPTED_REASON,
    };
  }

  if (input.environment === 'production' && mutationAllowed) {
    const mode: TestDataPolicyMode = isPolicyMode(requested?.mode)
      ? requested.mode
      : 'read-only';
    const cleanupRequired = requested?.cleanupRequired === true;
    if (mode === 'read-only' && cleanupRequired) {
      return {
        ...(requested !== undefined ? { requested } : {}),
        effective: { mode: 'read-only', cleanupRequired: false },
        status: 'BLOCKED',
        reason: READ_ONLY_CLEANUP_REASON,
      };
    }
    return {
      ...(requested !== undefined ? { requested } : {}),
      effective: { mode, cleanupRequired },
      status: 'PASS',
      reason: POLICY_ACCEPTED_REASON,
    };
  }

  // Non-production: omitted mode → isolated (shared must be explicit).
  const mode: TestDataPolicyMode = isPolicyMode(requested?.mode)
    ? requested.mode
    : 'isolated';
  const cleanupRequired =
    requested?.cleanupRequired !== undefined
      ? requested.cleanupRequired === true
      : mode === 'isolated';

  if (mode === 'read-only' && cleanupRequired) {
    return {
      ...(requested !== undefined ? { requested } : {}),
      effective: { mode: 'read-only', cleanupRequired: false },
      status: 'BLOCKED',
      reason: READ_ONLY_CLEANUP_REASON,
    };
  }

  return {
    ...(requested !== undefined ? { requested } : {}),
    effective: { mode, cleanupRequired },
    status: 'PASS',
    reason: POLICY_ACCEPTED_REASON,
  };
}

function readOnlyBlockReason(
  environment: QaEnvironmentName,
  kind: TestDataItemKind
): string {
  if (environment === 'production') {
    return PRODUCTION_DATA_MUTATION_REASON;
  }
  return `read-only policy blocks ${kind}`;
}

function shouldInvokeProviderCleanup(
  policy: ResolveTestDataPolicyResult | undefined,
  environment: QaEnvironmentName,
  flags: ResolveTestDataPolicyInput['flags'] | undefined
): boolean {
  if (policy === undefined) {
    // No policy supplied — preserve legacy cleanup-in-finally behavior.
    return true;
  }
  if (policy.status === 'BLOCKED' || policy.status === 'REQUIRES_CONFIGURATION') {
    return false;
  }
  const { effective } = policy;
  if (effective.mode === 'read-only' || !effective.cleanupRequired) {
    return false;
  }
  if (environment === 'production') {
    return productionActionAllowed('data-mutation', environment, {
      authorizeDataMutation: flags?.authorizeDataMutation === true,
      authorizeDestructive: flags?.authorizeDestructive === true,
    }).allowed;
  }
  return true;
}

/** Generic evidence for the data lifecycle — not application product records. */
export interface TestDataItem {
  kind: TestDataItemKind;
  id: string;
  status: TestDataItemStatus;
  reason?: string;
  payload?: unknown;
}

export interface TestData {
  projectId: string;
  runId: string;
  items: TestDataItem[];
}

export interface TestDataProvider {
  prepare(context: TestDataContext): Promise<TestData>;
  cleanup?(context: TestDataContext, data: TestData): Promise<void>;
  /**
   * Optional planned operations. When present, read-only policy can record
   * BLOCKED for seed/snapshot/cleanup without invoking `prepare` for those ops.
   */
  plannedOperations?(): TestDataItemKind[];
}

export interface InMemoryTestDataProviderFlags {
  authorizeSeed?: boolean;
  authorizeDestructive?: boolean;
  authorizeDataMutation?: boolean;
}

export interface InMemoryTestDataProviderOptions {
  operations?: TestDataItemKind[];
  fixtureName?: string;
  fields?: Record<string, unknown>;
  flags?: InMemoryTestDataProviderFlags;
}

/** Validation may return a status-bearing result or a simple ok/reason pair. */
export type TestDataValidateResult =
  | { ok: boolean; reason?: string }
  | { status: TestDataItemStatus; reason?: string; [key: string]: unknown };

export type CleanupLifecycleStatus = 'ran' | 'skipped' | 'failed';

export interface RunTestDataLifecycleInput {
  context: TestDataContext;
  provider: TestDataProvider;
  execute: (data: TestData) => Promise<unknown>;
  validate: (data: TestData, output: unknown) => Promise<TestDataValidateResult>;
  /** When omitted, legacy prepare → execute → validate → cleanup behavior is unchanged. */
  policy?: Partial<TestDataPolicy>;
  flags?: {
    authorizeDestructive?: boolean;
    authorizeDataMutation?: boolean;
  };
}

export interface RunTestDataLifecycleResult {
  data: TestData;
  output: unknown;
  validation: TestDataValidateResult;
  cleanup: CleanupLifecycleStatus;
  cleanupReason?: string;
  cleanupError?: unknown;
  policy?: ResolveTestDataPolicyResult;
}

function isDataMutationAllowed(
  environment: QaEnvironmentName,
  flags: InMemoryTestDataProviderFlags | undefined
): boolean {
  return productionActionAllowed('data-mutation', environment, {
    authorizeDataMutation: flags?.authorizeDataMutation === true,
    authorizeDestructive: flags?.authorizeDestructive === true,
  }).allowed;
}

function buildSeedItem(
  context: TestDataContext,
  flags: InMemoryTestDataProviderFlags | undefined,
  id: string
): TestDataItem {
  if (context.environment === 'production') {
    if (!isDataMutationAllowed(context.environment, flags)) {
      return {
        kind: 'seed',
        id,
        status: 'BLOCKED',
        reason: 'seed is not authorized',
      };
    }
    return {
      kind: 'seed',
      id,
      status: 'NOT_TESTED',
      reason: 'database seed is not executed; no driver is invoked',
    };
  }

  if (flags?.authorizeSeed !== true) {
    return {
      kind: 'seed',
      id,
      status: 'BLOCKED',
      reason: 'seed is not authorized',
    };
  }

  return {
    kind: 'seed',
    id,
    status: 'NOT_TESTED',
    reason: 'database seed is not executed; no driver is invoked',
  };
}

function buildCleanupItem(
  context: TestDataContext,
  flags: InMemoryTestDataProviderFlags | undefined,
  id: string
): TestDataItem {
  if (context.environment === 'production' && !isDataMutationAllowed(context.environment, flags)) {
    return {
      kind: 'cleanup',
      id,
      status: 'BLOCKED',
      reason: 'cleanup is not authorized',
    };
  }

  return {
    kind: 'cleanup',
    id,
    status: 'NOT_TESTED',
    reason: 'application cleanup is not executed',
  };
}

function buildOperationItem(
  kind: TestDataItemKind,
  context: TestDataContext,
  options: InMemoryTestDataProviderOptions,
  index: number
): TestDataItem {
  const id = `${kind}-${index}`;
  switch (kind) {
    case 'generate':
      return {
        kind: 'generate',
        id,
        status: 'PASS',
        payload: options.fields ?? {},
      };
    case 'fixture': {
      const name = options.fixtureName ?? '';
      if (name.trim() === '') {
        return {
          kind: 'fixture',
          id,
          status: 'REQUIRES_CONFIGURATION',
          reason: 'fixture name is required',
          payload: { name },
        };
      }
      return {
        kind: 'fixture',
        id,
        status: 'PASS',
        payload: { name },
      };
    }
    case 'seed':
      return buildSeedItem(context, options.flags, id);
    case 'snapshot':
      return {
        kind: 'snapshot',
        id,
        status: 'NOT_TESTED',
        reason: 'snapshot capture is not executed',
      };
    case 'cleanup':
      return buildCleanupItem(context, options.flags, id);
    default: {
      const _exhaustive: never = kind;
      return {
        kind: _exhaustive,
        id,
        status: 'BLOCKED',
        reason: `unknown operation: ${String(kind)}`,
      };
    }
  }
}

/**
 * In-memory provider — records lifecycle decisions only.
 * Never connects to a database, never writes under reports/, never deletes files.
 */
export class InMemoryTestDataProvider implements TestDataProvider {
  private readonly options: InMemoryTestDataProviderOptions;

  constructor(options: InMemoryTestDataProviderOptions = {}) {
    this.options = options;
  }

  plannedOperations(): TestDataItemKind[] {
    return [...(this.options.operations ?? ['generate'])];
  }

  /** Clone with a different operations list — same flags/fields/fixture. */
  withOperations(operations: TestDataItemKind[]): InMemoryTestDataProvider {
    return new InMemoryTestDataProvider({
      ...this.options,
      operations: [...operations],
    });
  }

  async prepare(context: TestDataContext): Promise<TestData> {
    const operations = this.options.operations ?? ['generate'];
    const items = operations.map((kind, index) =>
      buildOperationItem(kind, context, this.options, index)
    );
    return {
      projectId: context.projectId,
      runId: context.runId,
      items,
    };
  }

  async cleanup(context: TestDataContext, data: TestData): Promise<void> {
    const id = `cleanup-${data.items.length}`;
    data.items.push(buildCleanupItem(context, this.options.flags, id));
  }
}

/**
 * Prepare under read-only policy: allow generate/fixture only.
 * Mutating ops (seed/snapshot/cleanup) are recorded as BLOCKED without calling prepare for them.
 */
async function prepareUnderReadOnlyPolicy(
  provider: TestDataProvider,
  context: TestDataContext,
  blockReasonFor: (kind: TestDataItemKind) => string
): Promise<TestData> {
  const planned = provider.plannedOperations?.();
  if (planned === undefined) {
    return provider.prepare(context);
  }

  const safeOps = planned.filter((kind) => !MUTATING_OPERATION_KINDS.has(kind));
  const blockedOps = planned.filter((kind) => MUTATING_OPERATION_KINDS.has(kind));

  let data: TestData;
  if (safeOps.length === 0) {
    data = {
      projectId: context.projectId,
      runId: context.runId,
      items: [],
    };
  } else if (provider instanceof InMemoryTestDataProvider) {
    // Never invoke the original prepare when mutating ops were planned —
    // only generate/fixture run via a filtered clone.
    data = await provider.withOperations(safeOps).prepare(context);
  } else if (blockedOps.length === 0) {
    data = await provider.prepare(context);
  } else {
    // Generic provider advertised mutating ops: do not call prepare
    // (would run seed/snapshot/cleanup). Record BLOCKED rows only below.
    data = {
      projectId: context.projectId,
      runId: context.runId,
      items: [],
    };
  }

  for (let index = 0; index < blockedOps.length; index += 1) {
    const kind = blockedOps[index]!;
    data.items.push({
      kind,
      id: `${kind}-readonly-${index}`,
      status: 'BLOCKED',
      reason: blockReasonFor(kind),
    });
  }

  return data;
}

function attachCleanupError(primary: unknown, cleanupError: unknown): never {
  if (primary instanceof Error) {
    Object.defineProperty(primary, 'cleanupError', {
      value: cleanupError,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    throw primary;
  }
  const wrapped = new Error(String(primary));
  Object.defineProperty(wrapped, 'cleanupError', {
    value: cleanupError,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(wrapped, 'cause', {
    value: primary,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  throw wrapped;
}

/**
 * Runs prepare → execute → validate → cleanup.
 * Cleanup always runs in `finally` when prepare returned data (unless a supplied
 * policy forbids cleanup). Original execute/validate failures are never swallowed
 * or coerced to PASS. When `policy` is omitted, behavior matches the legacy path.
 *
 * Never seeds a database, never deletes under reports/, never calls clean-test-data.
 */
export async function runTestDataLifecycle(
  input: RunTestDataLifecycleInput
): Promise<RunTestDataLifecycleResult> {
  const { context, provider, execute, validate } = input;

  const policyResult =
    input.policy !== undefined
      ? resolveTestDataPolicy({
          environment: context.environment,
          requested: input.policy,
          flags: input.flags,
        })
      : undefined;

  if (
    policyResult !== undefined &&
    (policyResult.status === 'BLOCKED' || policyResult.status === 'REQUIRES_CONFIGURATION')
  ) {
    return {
      data: {
        projectId: context.projectId,
        runId: context.runId,
        items: [],
      },
      output: undefined,
      validation: {
        status: policyResult.status,
        reason: policyResult.reason,
      },
      cleanup: 'skipped',
      cleanupReason: 'policy blocked',
      policy: policyResult,
    };
  }

  let data: TestData | undefined;
  let output: unknown;
  let validation: TestDataValidateResult | undefined;
  let primaryError: unknown;
  let cleanup: CleanupLifecycleStatus = 'skipped';
  let cleanupReason: string | undefined = 'prepare did not return data';
  let cleanupError: unknown;
  const invokeCleanup = shouldInvokeProviderCleanup(
    policyResult,
    context.environment,
    input.flags
  );

  try {
    if (policyResult?.effective.mode === 'read-only') {
      data = await prepareUnderReadOnlyPolicy(provider, context, (kind) =>
        readOnlyBlockReason(context.environment, kind)
      );
    } else {
      data = await provider.prepare(context);
    }
    output = await execute(data);
    validation = await validate(data, output);
  } catch (error) {
    primaryError = error;
  } finally {
    if (data !== undefined && invokeCleanup) {
      if (typeof provider.cleanup === 'function') {
        try {
          await provider.cleanup(context, data);
          cleanup = 'ran';
          cleanupReason = undefined;
        } catch (error) {
          cleanup = 'failed';
          cleanupReason = error instanceof Error ? error.message : String(error);
          cleanupError = error;
        }
      } else {
        cleanup = 'skipped';
        cleanupReason = 'provider has no cleanup';
      }
    } else if (data !== undefined && !invokeCleanup) {
      cleanup = 'skipped';
      cleanupReason =
        policyResult?.effective.mode === 'read-only'
          ? 'read-only policy skips cleanup'
          : policyResult !== undefined && !policyResult.effective.cleanupRequired
            ? 'cleanupRequired is false'
            : 'cleanup not permitted by policy';
    } else {
      cleanup = 'skipped';
      cleanupReason = 'prepare did not return data';
    }
  }

  if (primaryError !== undefined) {
    if (cleanupError !== undefined) {
      attachCleanupError(primaryError, cleanupError);
    }
    throw primaryError;
  }

  if (cleanupError !== undefined) {
    throw cleanupError;
  }

  // prepare + execute + validate succeeded
  return {
    data: data as TestData,
    output,
    validation: validation as TestDataValidateResult,
    cleanup,
    ...(cleanupReason !== undefined ? { cleanupReason } : {}),
    ...(policyResult !== undefined ? { policy: policyResult } : {}),
  };
}
