import { TEST_DEPENDENCIES_STATUS } from './dependencies';
import { ENVIRONMENT_MANAGEMENT_STATUS } from './environment';
import { FLAKY_DETECTION_STATUS } from './flaky';
import { EXECUTION_HISTORY_STATUS } from './history';
import { OBSERVABILITY_STATUS } from './observability';
import { PARALLEL_EXECUTION_STATUS } from './parallel';
import { PLUGIN_ARCHITECTURE_STATUS } from './plugins';
import { PROJECT_ISOLATION_STATUS } from './project';
import { RISK_PRIORITIZATION_STATUS } from './risk';
import { SAFETY_BUDGET_STATUS } from './safety-budget';
import { TEST_DATA_MANAGEMENT_STATUS } from './test-data';
import { TEST_VERSIONING_STATUS } from './versioning';
import { QUALITY_GATE_PLATFORM_STATUS } from '../../orchestrator/quality-gate';
import { TESTING_CAPABILITIES } from '../../testing/capabilities';

export type PlatformCapabilityStatus =
  | 'IMPLEMENTED'
  | 'PARTIAL'
  | 'SCAFFOLDED'
  | 'NOT_IMPLEMENTED';

export type PlatformCapabilityId =
  | 'project-isolation'
  | 'test-dependencies'
  | 'environment-management'
  | 'test-data-management'
  | 'parallel-execution'
  | 'flaky-detection'
  | 'risk-prioritization'
  | 'test-versioning'
  | 'execution-history'
  | 'plugin-architecture'
  | 'observability'
  | 'safety-budget'
  | 'quality-gate';

export interface PlatformCapability {
  id: PlatformCapabilityId;
  status: PlatformCapabilityStatus;
  module: string;
}

/**
 * Platform capabilities — not TestTypeIds.
 * Status reflects what each pure module actually implements.
 */
export const PLATFORM_CAPABILITIES: readonly PlatformCapability[] = [
  {
    id: 'project-isolation',
    status: PROJECT_ISOLATION_STATUS,
    module: 'scripts/core/platform/project.ts',
  },
  {
    id: 'test-dependencies',
    status: TEST_DEPENDENCIES_STATUS,
    module: 'scripts/core/platform/dependencies.ts',
  },
  {
    id: 'environment-management',
    status: ENVIRONMENT_MANAGEMENT_STATUS,
    module: 'scripts/core/platform/environment.ts',
  },
  {
    id: 'test-data-management',
    status: TEST_DATA_MANAGEMENT_STATUS,
    module: 'scripts/core/platform/test-data.ts',
  },
  {
    id: 'parallel-execution',
    status: PARALLEL_EXECUTION_STATUS,
    module: 'scripts/core/platform/parallel.ts',
  },
  {
    id: 'flaky-detection',
    status: FLAKY_DETECTION_STATUS,
    module: 'scripts/core/platform/flaky.ts',
  },
  {
    id: 'risk-prioritization',
    status: RISK_PRIORITIZATION_STATUS,
    module: 'scripts/core/platform/risk.ts',
  },
  {
    id: 'test-versioning',
    status: TEST_VERSIONING_STATUS,
    module: 'scripts/core/platform/versioning.ts',
  },
  {
    id: 'execution-history',
    status: EXECUTION_HISTORY_STATUS,
    module: 'scripts/core/platform/history.ts',
  },
  {
    id: 'plugin-architecture',
    status: PLUGIN_ARCHITECTURE_STATUS,
    module: 'scripts/core/platform/plugins.ts',
  },
  {
    id: 'observability',
    status: OBSERVABILITY_STATUS,
    module: 'scripts/core/platform/observability.ts',
  },
  {
    id: 'safety-budget',
    status: SAFETY_BUDGET_STATUS,
    module: 'scripts/core/platform/safety-budget.ts',
  },
  {
    id: 'quality-gate',
    status: QUALITY_GATE_PLATFORM_STATUS,
    module: 'scripts/orchestrator/quality-gate.ts',
  },
] as const;

/** Re-export optional testing capabilities (item 10) — do not duplicate implementations. */
export { TESTING_CAPABILITIES };

export {
  DEFAULT_ORCHESTRATOR_DEPENDENCY_GRAPH,
  dependentTestsToNodes,
  gateDependents,
  orderByDependencies,
  scheduleDependentTests,
  TEST_DEPENDENCIES_STATUS,
} from './dependencies';
export type {
  DependencyNode,
  DependentTest,
  GateDependentResult,
  ScheduleBlockedResult,
  ScheduleDependentTestsResult,
  TestDependency,
} from './dependencies';
export {
  DEFAULT_ENVIRONMENT,
  environmentAllowsDestructive,
  ENVIRONMENT_MANAGEMENT_STATUS,
  productionActionAllowed,
  resolveEnvironment,
  resolveEnvironmentEndpoints,
} from './environment';
export type {
  EnvironmentEndpoints,
  EnvironmentsConfig,
  ProductionAction,
  ProductionActionFlags,
  ProductionActionResult,
  QaEnvironmentName,
  ResolveEnvironmentEndpointsInput,
  ResolvedEnvironmentEndpoints,
} from './environment';
export {
  boundedRetries,
  classifyHistoricalRuns,
  classifyRetry,
  classifyStability,
  DEFAULT_MAX_EXTRA_ATTEMPTS,
  DEFAULT_RETRY_ENABLED,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  detectFlakyFromHistory,
  FLAKY_DETECTION_STATUS,
  quarantine,
  resolveRetryMaxAttemptsAllowed,
  trackFailures,
} from './flaky';
export type {
  HistoricalClassification,
  HistoricalFailureEntry,
  HistoricalRun,
  HistoricalRunEvidence,
  RetryAttemptRecord,
  RetryClassification,
  RetryPolicy,
} from './flaky';
export {
  compareExecutions,
  compareRuns,
  EXECUTION_HISTORY_STATUS,
  summarizeTrends,
} from './history';
export type {
  ExecutionComparison,
  ExecutionComparisonFailure,
  ExecutionComparisonFlaky,
  ExecutionComparisonTestRef,
  ExecutionCoverageChange,
  ExecutionPerformanceRegression,
  ExecutionRunRecord,
  RunRecordTest,
} from './history';
export {
  appendRunRecord,
  buildRunRecord,
  loadRunRecords,
  renderExecutionComparison,
  resolveRunRecordHistoryDir,
  runRecordFileName,
  runRecordFilePath,
} from './execution-history';
export type { AppendRunRecordOptions, BuildRunRecordInput } from './execution-history';
export {
  correlationHeaders,
  createExecutionId,
  formatExecutionLog,
  incrementMetric,
  logEvent,
  maskExecutionLogString,
  OBSERVABILITY_STATUS,
  resetMetrics,
  snapshotMetrics,
  toExecutionLog,
} from './observability';
export type { ExecutionLog, ExecutionLogSource, LogEvent, LogEventInput } from './observability';
export {
  PARALLEL_EXECUTION_STATUS,
  planParallel,
  runWithConcurrency,
} from './parallel';
export {
  normalizeResourceRequirements,
  packResourceCompatibleWaves,
  planResourceWaves,
  resourcesAllowShare,
  SHARED_MUTABLE_ALLOW_REASON,
  UNDECLARED_RESOURCE_WAVE_REASON,
} from './resources';
export type {
  NormalizedResources,
  PlanResourceWavesOptions,
  ResourceAwareTest,
  ResourceDeclaration,
  ResourceMode,
  ResourceName,
  ResourceRequirement,
  ResourceRequirementMap,
} from './resources';
export {
  classifyExternalAbortReason,
  runWithTimeout,
} from './cancellation';
export type {
  RunWithTimeoutCleanupReason,
  RunWithTimeoutOptions,
  RunWithTimeoutResult,
} from './cancellation';
export {
  assertSafePluginModulePath,
  loadConfiguredPlugins,
  PLUGIN_ARCHITECTURE_STATUS,
  PluginRegistry,
  AdapterRegistry,
  BUILTIN_ADAPTER_IDS,
  createAdapterRegistry,
  getDefaultAdapterRegistry,
  isBuiltinAdapterId,
  listAdapters,
  registerAdapter,
  runAdapter,
} from './plugins';
export type {
  AdapterAvailability,
  AdapterAvailabilityState,
  AdapterDefinition,
  AdapterId,
  AdapterResultStatus,
  AdapterRunRequest,
  AdapterRunResult,
  AdapterToolSnapshot,
  AssertionPlugin,
  BuiltinAdapterId,
  DiscoveryAdapter,
  ReporterPlugin,
  TestEnginePlugin,
} from './plugin-sdk';
/** Existing queue adapters — re-exported so callers do not duplicate them. */
export {
  InMemoryQueueAdapter,
  KafkaAdapter,
  RedisAdapter,
  RabbitMQAdapter,
} from '../../testing/capabilities/queue-flow';
export {
  assertValidProjectId,
  DEFAULT_PROJECT_ID,
  PROJECT_ISOLATION_STATUS,
  projectPaths,
  projectStores,
  resolveProjectId,
} from './project';
export {
  createExecutionContext,
  createProjectContext,
  getCurrentExecutionContext,
  resolveExecutionPaths,
  setCurrentExecutionContext,
} from './project-context';
export type {
  CreateExecutionContextInput,
  CreateProjectContextInput,
  ExecutionContext,
  ExecutionPaths,
  ProjectConfigSlice,
  ProjectContext,
} from './project-context';
export {
  analyzeChangeImpact,
  executeByPriority,
  mappingToOwnership,
  prioritize,
  resolveRuntimeDependencyGraph,
  resolveStaticDependencyGraph,
  RISK_PRIORITIZATION_STATUS,
  RISK_SELECTION_PROFILES,
  selectByPriority,
  summarizeDimensions,
  TEST_PRIORITIES,
} from './risk';
export type {
  ChangeImpactInput,
  ChangeImpactMapping,
  ChangeImpactResult,
  DimensionExtras,
  DimensionResultRow,
  PrioritizeInput,
  PrioritizeResult,
  PrioritizedTest,
  PriorityExecutionResult,
  PriorityExecutionRow,
  QualityDimensions,
  RiskSelectionProfile,
  RiskSelectionResult,
  RuntimeDependencyGraph,
  ServiceOwnership,
  StaticDependencyGraph,
  TestFeatureMapping,
  TestPriority,
} from './risk';
export {
  assertResourceBudget,
  environmentPermissions,
  redactSecrets,
  SAFETY_BUDGET_STATUS,
} from './safety-budget';
export {
  InMemoryTestDataProvider,
  planTestData,
  planTestDataFull,
  POLICY_ACCEPTED_REASON,
  PRODUCTION_DATA_MUTATION_REASON,
  READ_ONLY_CLEANUP_REASON,
  resolveTestDataPolicy,
  runTestDataLifecycle,
  TEST_DATA_MANAGEMENT_STATUS,
} from './test-data';
export type {
  CleanupLifecycleStatus,
  InMemoryTestDataProviderFlags,
  InMemoryTestDataProviderOptions,
  PlanTestDataInput,
  PlanTestDataResult,
  ResolveTestDataPolicyInput,
  ResolveTestDataPolicyResult,
  RunTestDataLifecycleInput,
  RunTestDataLifecycleResult,
  TestData,
  TestDataContext,
  TestDataDescriptors,
  TestDataFactoryDescriptor,
  TestDataItem,
  TestDataItemKind,
  TestDataItemStatus,
  TestDataPlanRow,
  TestDataPlanStatus,
  TestDataPolicy,
  TestDataPolicyMode,
  TestDataPolicyStatus,
  TestDataProvider,
  TestDataValidateResult,
} from './test-data';
export {
  compareVersions,
  TEST_VERSIONING_STATUS,
  versionTestCase,
} from './versioning';
export {
  evaluateReleaseGate,
  QUALITY_GATE_PLATFORM_STATUS,
} from '../../orchestrator/quality-gate';
