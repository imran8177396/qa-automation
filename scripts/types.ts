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

export interface QaConfig {
  project: {
    name: string;
  };
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
    baseURL: string;
    browser?: PlaywrightBrowser;
    browsers?: PlaywrightBrowser[];
    headless: boolean;
    /** Parallel workers for local (non-CI) runs. Unset uses Playwright's own default (~half the CPU count). */
    workers?: number;
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
