import type { QaEnvironmentName } from './environment';
import { DEFAULT_PROJECT_ID, projectStores } from './project';

export {
  InMemoryTestDataProvider,
  POLICY_ACCEPTED_REASON,
  PRODUCTION_DATA_MUTATION_REASON,
  READ_ONLY_CLEANUP_REASON,
  resolveTestDataPolicy,
  runTestDataLifecycle,
} from './test-data-lifecycle';
export type {
  CleanupLifecycleStatus,
  InMemoryTestDataProviderFlags,
  InMemoryTestDataProviderOptions,
  ResolveTestDataPolicyInput,
  ResolveTestDataPolicyResult,
  RunTestDataLifecycleInput,
  RunTestDataLifecycleResult,
  TestData,
  TestDataContext,
  TestDataItem,
  TestDataItemKind,
  TestDataItemStatus,
  TestDataPolicy,
  TestDataPolicyMode,
  TestDataPolicyStatus,
  TestDataProvider,
  TestDataValidateResult,
} from './test-data-lifecycle';

/** Plans only — no app database I/O; does not call clean-test-data. */
export const TEST_DATA_MANAGEMENT_STATUS = 'PARTIAL' as const;

export type TestDataPlanStatus = 'IMPLEMENTED' | 'BLOCKED' | 'NOT_TESTED';

export interface TestDataFactoryDescriptor {
  name: string;
  fields: string[];
}

export interface TestDataDescriptors {
  /** In-memory factory descriptors — no I/O. */
  factories: TestDataFactoryDescriptor[];
  /** Fixture names only. */
  fixtures: string[];
  /** Isolated directory path from projectStores(id).testData — path string only. */
  isolated: string;
}

export interface TestDataPlanRow {
  action: 'generate' | 'seed' | 'cleanup';
  status: TestDataPlanStatus;
  reason?: string;
  scope?: string;
  /** Always false in this module — planning descriptors only. */
  executes: boolean;
}

export interface PlanTestDataInput {
  environment: QaEnvironmentName;
  authorizeSeed?: boolean;
  authorizeCleanup?: boolean;
  /** Optional factory descriptors (in memory). */
  factories?: TestDataFactoryDescriptor[];
  /** Fixture names only. */
  fixtures?: string[];
  /** Project id for isolated test-data path. Default `"default"`. */
  projectId?: string;
}

export interface PlanTestDataResult {
  rows: TestDataPlanRow[];
  descriptors: TestDataDescriptors;
}

/**
 * Returns generate / seed / cleanup plan rows plus configurable descriptors.
 * Never seeds or deletes app data. Does not call `clean-test-data.ts`.
 * Does not delete `reports/history`. Never targets `reports/history` for cleanup.
 */
export function planTestData(input: PlanTestDataInput): TestDataPlanRow[] {
  return planTestDataFull(input).rows;
}

/**
 * Full plan including factories / fixtures / isolated path descriptors.
 */
export function planTestDataFull(input: PlanTestDataInput): PlanTestDataResult {
  const projectId = input.projectId ?? DEFAULT_PROJECT_ID;
  const stores = projectStores(projectId);

  const descriptors: TestDataDescriptors = {
    factories: (input.factories ?? []).map((f) => ({
      name: f.name,
      fields: [...f.fields],
    })),
    fixtures: [...(input.fixtures ?? [])],
    isolated: stores.testData,
  };

  const generate: TestDataPlanRow = {
    action: 'generate',
    status: 'IMPLEMENTED',
    scope: 'ephemeral-fixture',
    executes: false,
  };

  let seed: TestDataPlanRow;
  if (input.environment === 'production' || input.authorizeSeed !== true) {
    seed = {
      action: 'seed',
      status: 'BLOCKED',
      reason:
        input.environment === 'production'
          ? 'seed against production is not authorized'
          : 'seed is not authorized',
      executes: false,
    };
  } else {
    seed = {
      action: 'seed',
      status: 'NOT_TESTED',
      reason: 'seed execution is not implemented; plan only',
      executes: false,
    };
  }

  let cleanup: TestDataPlanRow;
  if (input.environment === 'production' || input.authorizeCleanup !== true) {
    cleanup = {
      action: 'cleanup',
      status: 'BLOCKED',
      reason:
        input.environment === 'production'
          ? 'application-data cleanup against production is not authorized'
          : 'application-data cleanup is not authorized',
      executes: false,
    };
  } else {
    cleanup = {
      action: 'cleanup',
      status: 'NOT_TESTED',
      reason:
        'application-data cleanup is planned only; this module does not delete reports/history or app data',
      executes: false,
    };
  }

  return { rows: [generate, seed, cleanup], descriptors };
}
