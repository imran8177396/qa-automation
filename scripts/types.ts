import type { PlaywrightBrowser } from './lib/playwright-browsers';
import type { JmeterThresholds, PerformanceProfile, PerformanceProfilePlan } from './performance/types';
import type { LighthouseThresholds } from './lighthouse/types';

export type { PlaywrightBrowser };
export type PipelineStep = 'sync' | 'api' | 'e2e' | 'load';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type PostmanRequestKind =
  | 'valid'
  | 'invalid'
  | 'missing-parameter'
  | 'invalid-parameter'
  | 'authentication'
  | 'authorization'
  | 'error';

export type JsonFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export type ExpectedHttpStatus = number | 'UNVERIFIED';

export interface PostmanAssertionFlag {
  assertion: string;
  expected: number | string;
  lastObserved?: number | string;
  flags: string[];
  note: string;
}

export interface PostmanAssertionsConfig {
  statusCode?: number;
  expectJson?: boolean;
  maxResponseTimeMs?: number;
  responseShape?: 'array' | 'object' | 'empty';
  requiredFields?: string[];
  fieldTypes?: Partial<Record<string, JsonFieldType>>;
  expectError?: boolean;
  /** Substring match against the Content-Type header (e.g. text/html). */
  contentType?: string;
  /** Assert the body looks like an HTML document. Not a JSON schema. */
  htmlDocument?: boolean;
  bodyContains?: string[];
}

export interface PostmanAuthConfig {
  /** Documented auth only. `none` means auth tests stay REQUIRES_CONFIGURATION. */
  type: 'none' | 'bearer' | 'basic' | 'apikey';
  tokenEnv?: string;
  usernameEnv?: string;
  passwordEnv?: string;
}

export interface PostmanRequestConfig {
  name: string;
  method: HttpMethod;
  path: string;
  kind?: PostmanRequestKind;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  enabled?: boolean;
  skipReason?: string;
  /**
   * Documented intended HTTP status for comparison plumbing.
   * `UNVERIFIED` (or omit on a non-nav route) excludes the request from the pass count.
   * Never used to overwrite `assertions.statusCode`.
   */
  expectedStatus?: ExpectedHttpStatus;
  /** When true and expectedStatus is omitted, documented default is 200. Collection asserts are unchanged. */
  reachableFromNavigation?: boolean;
  /** Flags for tautological, unconfirmed, or user-confirmed documented collection assertions. Values are not auto-changed. */
  assertionFlags?: PostmanAssertionFlag[];
  assertions?: PostmanAssertionsConfig;
}

export type IntegrationCheckKind =
  | 'service-to-service'
  | 'api-to-database'
  | 'api-to-redis'
  | 'api-to-queue'
  | 'service-to-external-api'
  | 'worker-to-database';

export interface IntegrationCheckConfig {
  name: string;
  kind: IntegrationCheckKind;
  /** Absolute http(s) URL — never invent a host. */
  url?: string;
  /** Env var name whose value is an http(s) URL. */
  urlEnv?: string;
}

export interface IntegrationTestsConfig {
  enabled: boolean;
  /** Optional integration probes. Default empty — never invent hosts. */
  checks?: IntegrationCheckConfig[];
}

export interface ContractFieldConfig {
  name: string;
  type?: string;
  enumValues?: string[];
  minLength?: number;
  maxLength?: number;
  format?: string;
  min?: number;
  max?: number;
}

export interface ContractDefinitionConfig {
  name: string;
  method: HttpMethod;
  path: string;
  expectedStatus: number;
  requiredFields?: string[];
  fieldTypes?: Partial<Record<string, JsonFieldType>>;
  responseShape?: 'array' | 'object' | 'empty';
  /** Expected response header name substrings. */
  headers?: string[];
  /** Simple required request-body field names — not a full JSON Schema. */
  requestSchema?: string[];
  /** Simple required error-body field names — not a full JSON Schema. */
  errorSchema?: string[];
  /** When set, FAIL if the response lacks this header. */
  versionHeader?: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  /** Field constraints — drives negative/boundary case planning via testing generators. */
  fields?: ContractFieldConfig[];
}

export interface ContractTestsConfig {
  enabled: boolean;
  /** Optional explicit contracts. Missing/empty does not invent endpoints. */
  contracts?: ContractDefinitionConfig[];
  /**
   * When true, map `postman.requests` into the contract catalog.
   * Default false so `npm run test:api` remains the Postman path.
   */
  usePostmanRequests?: boolean;
  /**
   * When false (default), negative/boundary cases are listed as NOT_TESTED.
   * When true, only safe GET query mutations are executed.
   */
  executeNegative?: boolean;
}

export interface DatabaseTestsConfig {
  enabled: boolean;
  /** Env var holding the connection string. Default DATABASE_URL. */
  urlEnv?: string;
}

/**
 * Optional multi-tenant evidence checks. Default enabled false.
 * Tenant / organization / user / role values are never committed here —
 * callers supply them at runtime with captured response bodies.
 */
export interface MultiTenantTestsConfig {
  enabled: boolean;
}

/**
 * Optional webhook flow checks. Default enabled false.
 * No URLs or secrets in committed config — callers supply evidence at runtime.
 */
export interface WebhookTestsConfig {
  enabled: boolean;
}

/**
 * Optional queue/async classification. Default enabled false.
 * Generic in-memory only — no broker hosts or secrets in committed config.
 */
export interface QueueTestsConfig {
  enabled: boolean;
}

/**
 * Optional property-based sample checks. Default enabled false.
 * Builtin adapter only — fast-check is not installed; not a PBT framework.
 */
export interface PropertyTestsConfig {
  enabled: boolean;
}

/**
 * Optional in-memory mutation checks. Default enabled false.
 * Snippets and caller-supplied detection only — no file mutation, no suite re-run, no Stryker.
 */
export interface MutationTestsConfig {
  enabled: boolean;
}

/**
 * Optional deterministic in-memory race / concurrency checks. Default enabled false.
 * Caller-supplied interleavings only — no live multi-process races, no timers, no DB/HTTP.
 */
export interface RaceTestsConfig {
  enabled: boolean;
}

/**
 * Optional backup/restore infrastructure checks. Default enabled false.
 * Caller-supplied evidence only — does not take backups, restore DBs, or delete data.
 */
export interface BackupRestoreTestsConfig {
  enabled: boolean;
}

/**
 * Optional privacy checks. Default enabled false.
 * Caller-supplied evidence only — does not scan live APIs, delete data, enforce retention, or write exports.
 */
export interface PrivacyTestsConfig {
  enabled: boolean;
}

export interface SmokeDependencyConfig {
  name: string;
  /** Absolute http(s) URL — never invent a host. */
  url?: string;
  /** Env var name whose value is an http(s) URL. */
  urlEnv?: string;
}

export interface SmokeTestsConfig {
  enabled: boolean;
  /** Critical page path relative to website origin. Default `/` when a website URL exists. */
  criticalPagePath?: string;
  /** Full auth surface URL (GET only — never submits credentials). */
  authUrl?: string;
  /** Env var name holding a full auth surface URL. */
  authUrlEnv?: string;
  /** Full workflow start URL (GET only — never clicks through). */
  workflowUrl?: string;
  /** Env var name holding a workflow start URL. */
  workflowUrlEnv?: string;
  /** External dependency probes. Default []. */
  dependencies?: SmokeDependencyConfig[];
  /**
   * API path appended to the resolved API base.
   * When omitted/empty, falls back to `jmeter.path` when that is non-empty.
   */
  apiPath?: string;
}

export interface SanityCheckConfig {
  id: string;
  name?: string;
  /** Path joined to resolveWebsiteTarget() when url/urlEnv are absent. */
  path?: string;
  /** Absolute http(s) URL — never invent a host. */
  url?: string;
  /** Env var name whose value is an http(s) URL. */
  urlEnv?: string;
}

export interface SanityTestsConfig {
  enabled: boolean;
  /**
   * User-listed sanity scope. Default [] — never invent hosts.
   * Sanity is not regression and not retest of prior failures.
   */
  checks?: SanityCheckConfig[];
}

/**
 * Safe GET-only reliability probes. Disabled by default.
 * Never invents hosts; never injects faults.
 */
export interface ReliabilityTestsConfig {
  enabled: boolean;
  /** Absolute http(s) health URL — never invent a host. */
  healthUrl?: string;
  /** Env var name whose value is an http(s) health URL. */
  healthUrlEnv?: string;
  /** GET timeout in ms. Default 5000; capped at 15000. */
  timeoutMs?: number;
}

/**
 * Safe GET-only resilience probes. Disabled by default.
 * Never invents hosts; never takes dependencies down or injects faults.
 */
export interface ResilienceTestsConfig {
  enabled: boolean;
  /** Absolute http(s) dependency URL — never invent a host. */
  dependencyUrl?: string;
  /** Env var name whose value is an http(s) dependency URL. */
  dependencyUrlEnv?: string;
  /** Absolute http(s) health URL for resilience:service-health. */
  healthUrl?: string;
  /** Env var name whose value is an http(s) health URL. */
  healthUrlEnv?: string;
  /** Optional GET timeout in ms. Default 5000; capped at 15000. */
  timeoutMs?: number;
}

/**
 * Safe post-deploy GET probes + required-env name checks. Disabled by default.
 * Never invents hosts; never runs deploy / migrate / rollback commands.
 */
export interface DeploymentTestsConfig {
  enabled: boolean;
  /** Absolute http(s) health URL — never invent a host. */
  healthUrl?: string;
  /** Env var name whose value is an http(s) health URL. */
  healthUrlEnv?: string;
  /** Absolute http(s) readiness URL — never invent a host. */
  readinessUrl?: string;
  /** Env var name whose value is an http(s) readiness URL. */
  readinessUrlEnv?: string;
  /** Absolute http(s) version URL for verification — never invent a host. */
  versionUrl?: string;
  /** Env var name whose value is an http(s) version URL. */
  versionUrlEnv?: string;
  /** Env var **names** that must be set (non-blank). Values are never logged. */
  requiredEnv?: string[];
}

/**
 * Intl formatter / timezone / RTL checks. Never fetches a page.
 * Live-page language stays REQUIRES_CONFIGURATION until a page URL is configured.
 */
export interface LocalizationTestsConfig {
  enabled: boolean;
  /** BCP 47 locale tags for formatter checks (e.g. en-US). Never invents app support. */
  locales?: string[];
  /** IANA time zone ids (e.g. UTC, Asia/Karachi). */
  timezones?: string[];
}

/**
 * Explicit production verification. Disabled by default; every check flag defaults false.
 * Never invents hosts. Does not authorize heavy, security, or destructive testing.
 * Unknown keys are ignored and are not treated as permission.
 */
export interface ProductionVerificationConfig {
  enabled: boolean;
  health?: boolean;
  smoke?: boolean;
  criticalApi?: boolean;
  criticalUi?: boolean;
  criticalWorkflow?: boolean;
}

/** Opt-in metadata for which test categories are declared in config. Does not start runners. */
export interface TestsConfig {
  unit: { enabled: boolean };
  integration: IntegrationTestsConfig;
  contract: ContractTestsConfig;
  database: DatabaseTestsConfig;
  smoke: SmokeTestsConfig;
  sanity: SanityTestsConfig;
  regression: {
    enabled: boolean;
    /** Optional; `"selective"` is the committed default. */
    mode?: 'full' | 'selective';
    /** Optional suite include list; v1 selective/full default to `unit` when omitted. */
    include?: ('unit' | 'api' | 'e2e')[];
  };
  /**
   * Opt-in metadata only. Does not authorize heavy load and must not override
   * `jmeter` profiles, thresholds, or `allowHeavyAgainst`. Heavy profiles stay
   * disabled here (`load` / `stress` / `spike` / `endurance` enabled false).
   * `jmeter` remains the execution source of truth for performance.
   */
  performance: {
    enabled: boolean;
    load: { enabled: boolean };
    stress: { enabled: boolean };
    spike: { enabled: boolean };
    endurance: { enabled: boolean };
  };
  reliability: ReliabilityTestsConfig;
  resilience: ResilienceTestsConfig;
  /** Optional; default enabled false when present. Never deploys or migrates. */
  deployment?: DeploymentTestsConfig;
  /** Optional; formatter/timezone checks only — never claims a site is translated. */
  localization?: LocalizationTestsConfig;
  /** Optional AI QA layer — not required for web/e2e/api/jmeter. Default enabled false. */
  ai?: AiTestsConfig;
  /**
   * Optional production verification. Default enabled false; check flags default false.
   * Never authorizes heavy / security / destructive suites.
   */
  productionVerification?: ProductionVerificationConfig;
  /**
   * Optional multi-tenant evidence comparison. Default enabled false.
   * Not assumed for every application. No tenant ids in committed config.
   */
  multiTenant?: MultiTenantTestsConfig;
  /**
   * Optional webhook signature/delivery classification. Default enabled false.
   * No webhook URLs or secrets in committed config.
   */
  webhook?: WebhookTestsConfig;
  /**
   * Optional queue/async classification. Default enabled false.
   * No broker hosts or secrets in committed config.
   */
  queue?: QueueTestsConfig;
  /**
   * Optional property sample adapter. Default enabled false.
   * fast-check is not installed — not a property-testing framework.
   */
  property?: PropertyTestsConfig;
  /**
   * Optional in-memory mutation checks. Default enabled false.
   * Not part of the default PR suite. File mutation and suite re-run stay unimplemented.
   */
  mutation?: MutationTestsConfig;
  /**
   * Optional deterministic race / concurrency model. Default enabled false.
   * Not part of the default PR suite. Live multi-process races are not executed.
   */
  race?: RaceTestsConfig;
  /**
   * Optional backup/restore infrastructure checks. Default enabled false.
   * Not part of the default PR suite. Live backup/restore is not executed; production data is never deleted.
   */
  backupRestore?: BackupRestoreTestsConfig;
  /**
   * Optional privacy checks. Default enabled false.
   * Not part of the default PR suite. Live deletion, retention enforcement, and export jobs are not executed.
   */
  privacy?: PrivacyTestsConfig;
}

/**
 * Optional AI QA engine config. Disabled by default; not required for web QA.
 * Endpoint URL comes only from env[endpointEnv] — never hardcode hosts or keys.
 */
export interface AiTestsConfig {
  enabled: boolean;
  /** Env var name for the AI HTTP endpoint. Default QA_AI_ENDPOINT. Do not set the env here. */
  endpointEnv?: string;
  /** User-supplied prompt body; empty → prompt regression REQUIRES_CONFIGURATION. */
  prompt?: string;
  /** When set, prompt regression PASS requires this substring in the response body. */
  expectedSubstring?: string;
  /** Required top-level JSON field names for structured output. */
  requiredFields?: string[];
  /** Fact substrings that must appear (not a proof of truth). */
  requiredFacts?: string[];
  /** Source id/string substrings for groundedness. */
  sources?: string[];
  /** Expected chunk/source ids for RAG retrieval against response chunks/sources. */
  expectedChunkIds?: string[];
  /** Expected tool name for tool-call validation. */
  expectedTool?: string;
  /** Expected tools sequence for agent workflow. */
  workflowTools?: string[];
}

export type QaEnvironmentName = 'local' | 'development' | 'staging' | 'production';

export interface ProjectConfig {
  name: string;
  /**
   * Optional project isolation id. Default `"default"` keeps existing report roots.
   * Non-default ids namespace under `reports/projects/<id>/` (see platform/project.ts).
   */
  id?: string;
}

export interface EnvironmentConfig {
  /** Active named environment. Default `"development"`. Does not invent hosts. */
  active?: QaEnvironmentName;
}

/**
 * Optional per-environment endpoint overrides. Empty strings are valid.
 * Does not replace `urls.website` / `urls.api` — used as an additional source
 * at the config-URL tier only (see `resolveEnvironmentEndpoints`).
 */
export interface EnvironmentEndpointsConfig {
  websiteUrl?: string;
  apiUrl?: string;
}

/** Optional sibling of `environment` / `urls`. Unknown keys are ignored by the resolver. */
export type EnvironmentsConfig = Partial<Record<QaEnvironmentName, EnvironmentEndpointsConfig>>;


export interface ExecutionPlatformConfig {
  /** Parallel wave planning default. Default false — sequential. Does not change qa:all spawn. */
  parallel?: boolean;
  /** Extra retry attempts for flaky detection config. Default 0. Detection only — no runner loop. */
  maxExtraAttempts?: number;
  /** Max planned concurrency. Default 1. Does not change qa:all spawn order. */
  maxConcurrency?: number;
  /**
   * Optional per-item / plan timeout for dependent-plan helpers.
   * Omit or leave unset in committed qa.config.json — a committed number would change future runs.
   */
  timeoutMs?: number;
}

/**
 * Optional executor retry policy. Default enabled false — one attempt; not retest.ts.
 * maxAttempts is total attempts including the first (2 = attempt 1 + at most attempt 2).
 */
export interface RetryConfig {
  enabled?: boolean;
  maxAttempts?: number;
}

/** Optional release-gate thresholds. Default blockRelease false — does not block. */
export interface QualityGateConfig {
  blockRelease?: boolean;
  maxCriticalFailures?: number;
  minCoveragePct?: number;
  maxPerformanceP95Ms?: number;
  maxSecurityHigh?: number;
}

/**
 * Configurable quality gates over test results.
 * When `enabled` is false or omitted, the gate does not fail the run.
 * Threshold keys that are omitted are not checked. Not wired into run-all.
 */
export interface QualityGatesConfig {
  /** When false or omitted, the gate does not fail the run. */
  enabled?: boolean;
  /** Max allowed; 0 means any critical failure fails the gate. */
  criticalFailures?: number;
  maxFailedTests?: number;
  /** Percent; only compared when coverage was measured. */
  minCoverage?: number;
  maxHighSecurityFindings?: number;
}

export interface PluginConfigEntry {
  id: string;
  /** Relative path under `scripts/plugins/` only — never a remote URL. */
  modulePath: string;
}

/**
 * Optional explicit change-impact mappings. Empty / omitted does not change
 * regression behavior. Paths are repo-relative prefixes; selection is mapping-only
 * (no git, no AI inference).
 */
export interface ChangeImpactMappingConfig {
  path: string;
  module: string;
  service: string;
  feature: string;
  testIds: string[];
  /**
   * Optional generation-aware fields (item 39). When set, `--generate-tests --changed`
   * uses pathPrefix (fallback: path) plus screenIds / elementIds / testCaseIds.
   * Regression analyzeChangeImpact still uses path + testIds only.
   */
  pathPrefix?: string;
  screenIds?: string[];
  elementIds?: string[];
  testCaseIds?: string[];
}

export interface ChangeImpactConfig {
  mappings?: ChangeImpactMappingConfig[];
}

/**
 * Optional risk-based selection profile for callers of selectByPriority / executeByPriority.
 * Committed default stays `"full"` so current runs are not narrowed.
 * Not wired into run-all.ts.
 */
export type RiskSelectionProfileConfig = 'critical' | 'critical-high' | 'full';

export interface RiskConfig {
  profile?: RiskSelectionProfileConfig;
}

export interface QaConfig {
  project: ProjectConfig;
  /**
   * Named environment only (`local` | `development` | `staging` | `production`).
   * Optional; absent → platform helpers default to development. No hosts here.
   * Selector for optional `environments` map — committed default remains `"development"`.
   */
  environment?: EnvironmentConfig;
  /**
   * Optional per-environment website/api URL overrides. Empty strings are valid.
   * Does not replace `urls`. Resolved only at the config-URL tier after CLI/env/last-target.
   * Never invent hosts — leave blank until a real target is configured.
   */
  environments?: EnvironmentsConfig;
  /**
   * Platform execution planning defaults. Optional; absent → parallel false, maxExtraAttempts 0, maxConcurrency 1.
   * Does not change existing runner spawn order.
   */
  execution?: ExecutionPlatformConfig;
  /**
   * Optional dependent-plan retry. Default `{ enabled: false, maxAttempts: 2 }`.
   * Committed config stays disabled — callers may pass enabled true into the executor.
   */
  retry?: RetryConfig;
  /**
   * Optional release-gate thresholds. Default `blockRelease: false` — never blocks when omitted.
   */
  qualityGate?: QualityGateConfig;
  /**
   * Optional configurable quality gates. Default `{ enabled: false }` — does not fail the run.
   * Thresholds are caller-supplied when enabling; not wired into run-all.
   */
  qualityGates?: QualityGatesConfig;
  /**
   * Optional plugin entries. Default empty — loads nothing. Paths must be under scripts/plugins/.
   */
  plugins?: PluginConfigEntry[];
  /**
   * Optional change-impact mapping table. Default `{ mappings: [] }` — empty must not
   * change regression's current behavior. Consumed by platform risk helpers only.
   */
  changeImpact?: ChangeImpactConfig;
  /**
   * Optional risk-based priority profile. Committed value is `"full"` — does not
   * narrow current runs. Consumed by platform risk helpers only; not wired into run-all.
   */
  risk?: RiskConfig;
  urls: {
    website: string;
    api: string;
    login?: string;
  };
  credentials?: {
    username: string;
    password: string;
  };
  pipeline: {
    steps: PipelineStep[];
    failFast: boolean;
    /**
     * When true (default), qa:all must execute every runnable suite/scenario/UI
     * check. Disabled modules and safety-blocked items are recorded explicitly —
     * never dropped via skip/grep/only/fixture fallback.
     */
    exhaustiveExecution?: boolean;
    /** Alias of exhaustiveExecution. */
    noSilentSkip?: boolean;
  };
  /** Optional so older configs without `tests` still typecheck. */
  tests?: TestsConfig;
  postman: {
    enabled: boolean;
    collectionName: string;
    assertions?: PostmanAssertionsConfig;
    auth?: PostmanAuthConfig;
    /**
     * How `expectedStatus` is derived. Collection `assertions.statusCode` is never
     * auto-flipped from this policy.
     */
    expectationPolicy?: {
      navReachableDefault: number;
      undocumented: 'UNVERIFIED';
      note?: string;
    };
    requests: PostmanRequestConfig[];
  };
  playwright: {
    enabled: boolean;
    /**
     * Optional loopback-only fixture override (127.0.0.1 / localhost / ::1).
     * Not a general live-site / product URL — use CLI `--url`, `QA_PLAYWRIGHT_BASE_URL`,
     * `QA_WEBSITE_URL`, last-target, or `urls.website` for that. Non-loopback values
     * are ignored by `resolveWebsiteTarget`.
     */
    baseURL?: string;
    browser?: PlaywrightBrowser;
    browsers?: PlaywrightBrowser[];
    headless: boolean;
    /** Parallel workers for local (non-CI) runs. Unset uses Playwright's own default (~half the CPU count). */
    workers?: number;
    /**
     * Retry attempts for a failing test. Unset keeps the defaults (2 on CI, 0 locally).
     * Retries never convert a FAIL into a PASS — a test that fails every attempt stays FAIL,
     * and one that only passes on retry is reported as flaky.
     */
    retries?: number;
    /** Attribute `getByTestId()` resolves against. Unset uses Playwright's own default, `data-testid`. */
    testIdAttribute?: string;
    /**
     * Extra cross-browser targets (real devices / cloud). Local engines still
     * come from `browsers`. Extra targets are never claimed as tested unless
     * that environment actually ran.
     */
    crossBrowser?: {
      targets?: Array<{
        id: string;
        kind: 'engine' | 'real-device' | 'cloud-browser';
        project?: PlaywrightBrowser;
        provider?: string;
        enabled?: boolean;
      }>;
    };
  };
  jmeter: {
    enabled: boolean;
    threads: number;
    rampUpSeconds: number;
    loopCount: number;
    path: string;
    /** Default is liveness. Heavy profiles are never implied. `smoke` is an alias of liveness. */
    defaultProfile?: PerformanceProfile;
    /**
     * Optional acceptance limits. Keys may exist with null values.
     * Null / omitted values stay NOT_AVAILABLE — never invent numeric SLAs.
     * Liveness always records RECORDED, never PASS.
     */
    thresholds?: JmeterThresholds | null;
    /** Hostnames (or absolute URLs) that may receive authorized heavy profiles. Loopback is always allowed. */
    allowHeavyAgainst?: string[];
    profiles?: Partial<Record<PerformanceProfile, PerformanceProfilePlan>>;
  };
  /**
   * Lighthouse / Core Web Vitals. Separate from JMeter.
   * Threshold keys may be null until the project sets SLAs.
   */
  lighthouse?: {
    enabled?: boolean;
    thresholds?: LighthouseThresholds | null;
  };
  github: {
    branches: string[];
    runOnPullRequest: boolean;
  };
  report?: {
    enabled: boolean;
    format: string;
    autoGenerateAfterTests: boolean;
    /** Previous dated packs are retained; each run writes a new timestamp folder. */
    retention?: {
      keepHistoricalTimestampFolders?: boolean;
      updateLatestManifest?: boolean;
      note?: string;
    };
    signOff?: {
      preparerName?: string;
      preparerRole?: string;
      reviewerName?: string;
      reviewerRole?: string;
      approvalDate?: string;
      distribution?: string;
      confidentiality?: string;
    };
    revisionHistory?: Array<{ version: string; date: string; author: string; summary: string }>;
    criteria?: {
      entry?: string[];
      exit?: string[];
      severity?: Record<string, string>;
      releaseBlocking?: string[];
    };
  };
  /**
   * Hand-written UI+API workflows. Each entry must name a documented Postman
   * path — correlation never invents endpoints. Omitted or empty means no
   * combined workflows are configured.
   */
  workflows?: {
    correlated?: CorrelatedWorkflowConfig[];
  };
  safety?: SafetyConfig;
  discovery?: DiscoveryConfig;
  /**
   * QA-level security baseline. Not a pentest. Omit or set enabled true to allow
   * `npm run test:security`. Set enabled false to skip.
   */
  security?: {
    enabled?: boolean;
  };
  /**
   * Dependency & secrets QA — npm audit advisories plus a pattern-based
   * secret scan of tracked source files. Not a full SCA/license audit. Omit
   * or set enabled true to allow `npm run test:dependencies`.
   * failOnSeverity sets the minimum npm-audit severity that fails the stage
   * (default 'high'); findings below that stay recorded as NOTE, never dropped.
   */
  dependencies?: {
    enabled?: boolean;
    failOnSeverity?: 'critical' | 'high' | 'medium';
  };
  /**
   * Automated technical SEO. Not a ranking audit. Omit or set enabled true to
   * allow `npm run test:seo`. Set enabled false to skip.
   */
  seo?: {
    enabled?: boolean;
    missingPath?: string;
    expectedRedirects?: Array<{ from: string; to?: string; status?: number }>;
  };
  /**
   * Structural content QA. Does not fact-check business claims unless
   * expectedValues are provided. Set enabled false to skip `npm run test:content`.
   */
  content?: {
    enabled?: boolean;
    expectedValues?: Array<{ claim: string; expected: string }>;
  };
  /**
   * Evidence-based failure classification. Omit or set enabled true to run
   * `npm run analyze:failures` (also invoked before enterprise report generation).
   */
  failureAnalysis?: {
    enabled?: boolean;
  };
  /**
   * Controlled retest. Omit or set enabled true to allow `npm run retest`.
   * The engine never hides failures or changes expected results.
   */
  retest?: {
    enabled?: boolean;
  };
}

export interface CorrelatedWorkflowConfig {
  id: string;
  name: string;
  uiPath: string;
  apiMethod: HttpMethod;
  apiPath: string;
  expectedStatus: number;
  requiredFields?: string[];
  /** Optional locator that triggers the documented API. Never a destructive control. */
  uiAction?: string;
  /** Optional locator asserted after the API response. */
  uiResult?: string;
}

export interface SafetyConfig {
  enabled?: boolean;
  dangerKeywords?: string[];
  allowlist?: Array<{ url: string; selector: string; reason: string }>;
}

export interface DiscoveryConfig {
  enabled?: boolean;
  maxPages?: number;
  maxDepth?: number;
  sameOriginOnly?: boolean;
  additionalHosts?: string[];
  respectRobotsTxt?: boolean;
  useSitemap?: boolean;
  concurrency?: number;
  /** Glob or /regex/ patterns matched against the URL and pathname. */
  excludePatterns?: string[];
}
