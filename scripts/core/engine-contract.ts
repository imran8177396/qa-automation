import { assertRecordedOutcome, redactSecrets } from './safety-policy';
import { createExecutionId, toExecutionLog } from './platform/observability';
import { DEFAULT_PROJECT_ID } from './platform/project';
import {
  getCurrentExecutionContext,
  type ExecutionContext,
} from './platform/project-context';
import { environmentPermissions } from './platform/safety-budget';
import { versionTestCase } from './platform/versioning';
import type { QaEnvironmentName } from './platform/environment';
import type { ArtifactRef } from '../lib/artifacts';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import type { TestTypeCategory } from './test-types/categories';
import type { TestTypeId } from './test-types/types';

/**
 * Status strings new engines use. Aligned with reporting.mdc / no-skip policy.
 * SKIPPED is an explicit recorded outcome with a reason in `error.message` or
 * `metadata.reason`. It must not be used to hide a failure or to omit a check.
 * Silent omission stays forbidden.
 */
export const ENGINE_RESULT_STATUSES = [
  'PASS',
  'FAIL',
  'SKIPPED',
  'BLOCKED',
  'NOT_TESTED',
  'REQUIRES_CONFIGURATION',
  'NOT_APPLICABLE',
  'TIMEOUT',
  'CANCELLED',
  'FLAKY',
] as const;

export type EngineResultStatus = (typeof ENGINE_RESULT_STATUSES)[number];

export type EngineSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Runtime context passed to engines. URLs are resolved by callers; this module
 * never performs network I/O and never hardcodes demo targets.
 */
export interface TestContext {
  /** Resolved website base URL; empty string when not configured. */
  websiteUrl: string;
  /** Resolved API base URL; empty string when not configured. */
  apiUrl: string;
  /** Whether this engine is enabled for the current run. */
  enabled: boolean;
  /** Optional opaque config slice from the caller (e.g. qa.config subset). */
  config?: unknown;
}

/** A discoverable unit of work an engine may plan or execute. */
export interface TestItem {
  id: string;
  name: string;
  target?: string;
}

/** Planned work for one engine run. */
export interface TestPlan {
  engineId: TestTypeId;
  items: TestItem[];
}

export interface TestResultAssertion {
  expected?: unknown;
  actual?: unknown;
}

export interface TestResultError {
  message: string;
  stack?: string;
}

export interface TestResultEvidence {
  screenshot?: string;
  request?: unknown;
  response?: unknown;
  log?: string;
  /**
   * Shared artifact registry refs (scripts/lib/artifacts.ts).
   * Only written:true or source:'existing' paths are treated as captured evidence in reports.
   */
  artifacts?: ArtifactRef[];
}

/**
 * Normalized per-item result for NEW engines only.
 * Existing Playwright / Postman / JMeter runners are not rewritten to produce this.
 */
export interface TestResult {
  id: string;
  testType: TestTypeId | string;
  category: TestTypeCategory | string;
  name: string;
  status: EngineResultStatus;
  severity?: EngineSeverity;
  durationMs?: number;
  target?: string;
  assertion?: TestResultAssertion;
  error?: TestResultError;
  evidence?: TestResultEvidence;
  /**
   * Optional metadata. Cross-cutting hooks may set executionId, projectId,
   * environment, testVersion, reason, quarantine — all optional for callers.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Contract for NEW engines. Existing runners (Postman, Playwright, JMeter, …)
 * are not rewritten to implement this — optional thin adapters only when compile
 * requires them.
 */
export interface TestEngine {
  readonly id: TestTypeId;
  readonly category: TestTypeCategory | string;
  readonly name: string;
  readonly description: string;
  canRun(context: TestContext): boolean;
  discover?(context: TestContext): Promise<TestItem[]>;
  plan?(context: TestContext): Promise<TestPlan>;
  execute(context: TestContext, plan: TestPlan): Promise<TestResult[]>;
  cleanup?(context: TestContext): Promise<void>;
}

/** @deprecated Prefer TestResult — kept as an alias so early imports stay stable. */
export type NormalizedTestResult = TestResult;

export interface EngineSummarySafety {
  mode: 'read-only' | 'destructive-approved';
}

export interface EngineSummary {
  generatedAt: string;
  engine: string;
  testType: TestTypeId | string;
  /** Rollup: FAIL if any FAIL; else REQUIRES_CONFIGURATION / NOT_TESTED / BLOCKED if present; else PASS when results exist. */
  status: EngineResultStatus;
  passed: boolean;
  results: TestResult[];
  passCount: number;
  failCount: number;
  skippedCount: number;
  blockedCount: number;
  notTestedCount: number;
  requiresConfigurationCount: number;
  notApplicableCount: number;
  /** Distinct from FAIL / BLOCKED — timed-out runs only. */
  timeoutCount: number;
  /** Distinct from FAIL / BLOCKED — cancelled or aborted runs only. */
  cancelledCount: number;
  /** Distinct from PASS / FAIL — intermittent FAIL-then-PASS (or mixed) under retry. */
  flakyCount: number;
  /** Label from environmentPermissions — not a per-runner authorize gate. Always set by buildEngineSummary. */
  safety?: EngineSummarySafety;
  note?: string;
  limitations?: string[];
}

/** Optional observability args for makeResult — no disk reads, no process env secrets. */
export interface MakeResultOptions {
  executionId?: string;
  projectId?: string;
  environment?: string;
  /** When set, stamps full execution metadata (preferred over module context). */
  execution?: ExecutionContext;
}


export function isEngineResultStatus(value: string): value is EngineResultStatus {
  return (ENGINE_RESULT_STATUSES as readonly string[]).includes(value);
}

export function tallyEngineResults(results: TestResult[]): {
  passCount: number;
  failCount: number;
  skippedCount: number;
  blockedCount: number;
  notTestedCount: number;
  requiresConfigurationCount: number;
  notApplicableCount: number;
  timeoutCount: number;
  cancelledCount: number;
  flakyCount: number;
  status: EngineResultStatus;
  passed: boolean;
} {
  let passCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  let blockedCount = 0;
  let notTestedCount = 0;
  let requiresConfigurationCount = 0;
  let notApplicableCount = 0;
  let timeoutCount = 0;
  let cancelledCount = 0;
  let flakyCount = 0;

  for (const row of results) {
    switch (row.status) {
      case 'PASS':
        passCount += 1;
        break;
      case 'FAIL':
        failCount += 1;
        break;
      case 'SKIPPED':
        skippedCount += 1;
        break;
      case 'BLOCKED':
        blockedCount += 1;
        break;
      case 'NOT_TESTED':
        notTestedCount += 1;
        break;
      case 'REQUIRES_CONFIGURATION':
        requiresConfigurationCount += 1;
        break;
      case 'NOT_APPLICABLE':
        notApplicableCount += 1;
        break;
      case 'TIMEOUT':
        timeoutCount += 1;
        break;
      case 'CANCELLED':
        cancelledCount += 1;
        break;
      case 'FLAKY':
        flakyCount += 1;
        break;
      default:
        break;
    }
  }

  let status: EngineResultStatus = 'NOT_TESTED';
  if (failCount > 0) status = 'FAIL';
  else if (requiresConfigurationCount > 0) status = 'REQUIRES_CONFIGURATION';
  else if (timeoutCount > 0) status = 'TIMEOUT';
  else if (cancelledCount > 0) status = 'CANCELLED';
  else if (blockedCount > 0) status = 'BLOCKED';
  else if (flakyCount > 0) status = 'FLAKY';
  else if (passCount > 0) status = 'PASS';
  else if (skippedCount > 0 && notTestedCount === 0 && notApplicableCount === 0) status = 'SKIPPED';
  else if (notApplicableCount > 0 && notTestedCount === 0) status = 'NOT_APPLICABLE';
  else status = 'NOT_TESTED';

  return {
    passCount,
    failCount,
    skippedCount,
    blockedCount,
    notTestedCount,
    requiresConfigurationCount,
    notApplicableCount,
    timeoutCount,
    cancelledCount,
    flakyCount,
    status,
    /**
     * True only for a passing execution: at least one PASS, no FAIL, and FLAKY
     * does not count as passed. Incomplete-only tallies (NOT_TESTED / BLOCKED /
     * REQUIRES_CONFIGURATION / SKIPPED / TIMEOUT / CANCELLED) are not passed.
     * Exit policy stays in runners — do not treat this as "exit 0 allowed".
     */
    passed: passCount > 0 && failCount === 0 && flakyCount === 0,
  };
}

function resolveSummaryEnvironment(value: string | undefined): QaEnvironmentName {
  if (
    value === 'production' ||
    value === 'staging' ||
    value === 'development' ||
    value === 'local'
  ) {
    return value;
  }
  return 'development';
}

/**
 * True when the entire trimmed text is a single secret assignment (e.g. `password=s3cret`).
 * Used so reason-required statuses keep a non-secret placeholder after redaction.
 */
function isSecretOnlyText(text: string): boolean {
  return /^(password|secret|token|api[_-]?key)\s*[=:]\s*\S+$/i.test(text.trim());
}

/**
 * Redact outcome text. Blank or secret-only reasons become `"redacted"` so
 * BLOCKED / NOT_TESTED / SKIPPED / REQUIRES_CONFIGURATION / TIMEOUT / CANCELLED / FLAKY still satisfy the reason rule.
 */
function redactOutcomeText(text: string): string {
  if (isSecretOnlyText(text)) {
    return 'redacted';
  }
  const redacted = redactSecrets(text);
  const out = typeof redacted === 'string' ? redacted.trim() : '';
  return out.length > 0 ? out : 'redacted';
}

function resolveMakeResultContext(options: MakeResultOptions): {
  projectId: string;
  projectName: string;
  environment: string;
  runId: string;
  commit: string;
  branch: string;
  build: string;
  timestamp: string;
} {
  const fromArg = options.execution;
  const fromModule = getCurrentExecutionContext();
  const ctx = fromArg ?? fromModule;

  if (ctx) {
    const runId =
      options.executionId ??
      (typeof ctx.runId === 'string' && ctx.runId ? ctx.runId : createExecutionId());
    return {
      projectId: options.projectId ?? ctx.projectId,
      projectName: ctx.projectName,
      environment: options.environment ?? ctx.environment,
      runId,
      commit: ctx.commit,
      branch: ctx.branch,
      build: ctx.build,
      timestamp: ctx.timestamp,
    };
  }

  return {
    projectId: options.projectId ?? DEFAULT_PROJECT_ID,
    projectName: options.projectId ?? DEFAULT_PROJECT_ID,
    environment: options.environment ?? 'development',
    runId: options.executionId ?? createExecutionId(),
    commit: NOT_AVAILABLE,
    branch: NOT_AVAILABLE,
    build: NOT_AVAILABLE,
    timestamp: new Date().toISOString(),
  };
}

export function buildEngineSummary(input: {
  engine: string;
  testType: TestTypeId | string;
  results: TestResult[];
  note?: string;
  limitations?: string[];
  /** Defaults to development → read-only unless approveDestructive. */
  environment?: string;
  approveDestructive?: boolean;
}): EngineSummary {
  const tallied = tallyEngineResults(input.results);
  const permissions = environmentPermissions(resolveSummaryEnvironment(input.environment), {
    approveDestructive: input.approveDestructive === true,
  });
  return {
    generatedAt: new Date().toISOString(),
    engine: input.engine,
    testType: input.testType,
    status: tallied.status,
    passed: tallied.passed,
    results: input.results,
    passCount: tallied.passCount,
    failCount: tallied.failCount,
    skippedCount: tallied.skippedCount,
    blockedCount: tallied.blockedCount,
    notTestedCount: tallied.notTestedCount,
    requiresConfigurationCount: tallied.requiresConfigurationCount,
    notApplicableCount: tallied.notApplicableCount,
    timeoutCount: tallied.timeoutCount,
    cancelledCount: tallied.cancelledCount,
    flakyCount: tallied.flakyCount,
    safety: { mode: permissions.mode },
    ...(input.note ? { note: input.note } : {}),
    ...(input.limitations ? { limitations: input.limitations } : {}),
  };
}

export function makeResult(
  partial: Omit<TestResult, 'severity' | 'durationMs' | 'error' | 'evidence' | 'metadata'> &
    Partial<Pick<TestResult, 'severity' | 'durationMs' | 'error' | 'evidence' | 'metadata' | 'assertion' | 'target'>>,
  options: MakeResultOptions = {}
): TestResult {
  // quarantine === true must not flip FAIL → PASS (no retry loops here).
  const status = partial.status;

  const metadata: Record<string, unknown> = {
    ...(partial.metadata ?? {}),
  };

  const stamped = resolveMakeResultContext(options);

  // Prefer explicit options / caller metadata for the classic keys, then stamp context.
  const executionId =
    options.executionId ??
    (typeof metadata.executionId === 'string' && metadata.executionId
      ? metadata.executionId
      : stamped.runId);
  const projectId =
    options.projectId ??
    (typeof metadata.projectId === 'string' && metadata.projectId
      ? metadata.projectId
      : stamped.projectId);
  const environment =
    options.environment ??
    (typeof metadata.environment === 'string' && metadata.environment
      ? metadata.environment
      : stamped.environment);

  metadata.executionId = executionId;
  metadata.runId = executionId;
  metadata.projectId = projectId;
  metadata.projectName =
    typeof metadata.projectName === 'string' && metadata.projectName
      ? metadata.projectName
      : stamped.projectName;
  metadata.environment = environment;
  metadata.commit =
    typeof metadata.commit === 'string' && metadata.commit ? metadata.commit : stamped.commit;
  metadata.branch =
    typeof metadata.branch === 'string' && metadata.branch ? metadata.branch : stamped.branch;
  metadata.build =
    typeof metadata.build === 'string' && metadata.build ? metadata.build : stamped.build;
  metadata.timestamp =
    typeof metadata.timestamp === 'string' && metadata.timestamp
      ? metadata.timestamp
      : stamped.timestamp;

  let error = partial.error;
  if (error && typeof error.message === 'string') {
    error = {
      ...error,
      message: redactOutcomeText(error.message),
    };
  }

  if (typeof metadata.reason === 'string') {
    metadata.reason = redactOutcomeText(metadata.reason);
  }

  if (
    partial.assertion !== undefined &&
    partial.assertion.expected !== undefined &&
    metadata.testVersion === undefined
  ) {
    metadata.testVersion = versionTestCase({
      id: partial.id,
      title: partial.name,
      expected: partial.assertion.expected,
    }).version;
  }

  const result: TestResult = {
    id: partial.id,
    testType: partial.testType,
    category: partial.category,
    name: partial.name,
    status,
    ...(partial.severity !== undefined ? { severity: partial.severity } : {}),
    ...(partial.durationMs !== undefined ? { durationMs: partial.durationMs } : {}),
    ...(partial.target !== undefined ? { target: partial.target } : {}),
    ...(partial.assertion !== undefined ? { assertion: partial.assertion } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(partial.evidence !== undefined ? { evidence: partial.evidence } : {}),
    metadata,
  };
  assertRecordedOutcome(result);
  // Side-effect-free attach: structured execution log (secrets/PII already masked).
  // Does not change status, exit codes, or redaction of error/reason.
  metadata.executionLog = toExecutionLog({
    id: result.id,
    status: result.status,
    target: result.target,
    engine: typeof metadata.engine === 'string' ? metadata.engine : undefined,
    error: result.error,
    metadata,
  });
  return result;
}
